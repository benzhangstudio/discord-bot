import { randomBytes } from "node:crypto";
import { PermissionFlagsBits } from "discord.js";
import { eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config, loginReady, setPublicUrl } from "../config.js";
import { db } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { decryptToken, encryptToken } from "./tokenCrypto.js";

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_COOKIE = "n1_session";
const STATE_COOKIE = "n1_oauth_state";

/**
 * The address the visitor used to reach the dashboard (e.g. https://number-one.wispbyte.app).
 * Wispbyte's HTTPS proxy passes the original address along, so nothing needs configuring.
 */
export function requestOrigin(request: FastifyRequest) {
  return `${request.protocol}://${request.host}`;
}

function isPublicHost(host: string) {
  return !/^(localhost|127\.|0\.0\.0\.0|\[::1\]|\d+\.\d+\.\d+\.\d+)/.test(host);
}

/** Remembers the dashboard's public address the first time someone opens it. */
export function learnPublicUrl(request: FastifyRequest) {
  if (!config.publicUrl && request.protocol === "https" && isPublicHost(request.host)) {
    setPublicUrl(requestOrigin(request), "dashboard visit");
  }
}

export type Session = typeof sessions.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

function cookieOptions(request: FastifyRequest, maxAgeSeconds: number) {
  const secure = request.protocol === "https";
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure, signed: true, maxAge: maxAgeSeconds };
}

/** Looks up the logged-in user from their cookie, if any. */
export async function loadSession(request: FastifyRequest): Promise<Session | undefined> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;
  const session = await db.select().from(sessions).where(eq(sessions.id, unsigned.value)).get();
  if (!session || session.expiresAt.getTime() < Date.now()) return;
  return session;
}

/** Route guard: rejects requests from people who aren't logged in. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const session = await loadSession(request);
  if (!session) return reply.code(401).send({ error: "Not logged in" });
  request.session = session;
}

/**
 * Permissions Number One asks for when it's added to a server: what moderation, auto-moderation, onboarding
 * and reaction roles need, and no more. Add to this list when a new feature needs another permission.
 */
const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ManageGuild, // auto-moderation creates Discord AutoMod rules
].reduce((all, p) => all | p, 0n);

export function registerAuthRoutes(app: FastifyInstance) {
  // "Add to Discord" on the landing page: sends the visitor to Discord's add-bot screen.
  app.get("/invite", async (_request, reply) => {
    if (!config.clientId) return reply.redirect("/?error=invite_not_configured");
    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: "bot applications.commands",
      permissions: INVITE_PERMISSIONS.toString(),
    });
    return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get("/auth/login", async (request, reply) => {
    if (!loginReady()) return reply.redirect("/?error=login_not_configured");
    const state = randomBytes(16).toString("hex");
    reply.setCookie(STATE_COOKIE, state, cookieOptions(request, 600));
    const params = new URLSearchParams({
      client_id: config.clientId!,
      response_type: "code",
      redirect_uri: `${requestOrigin(request)}/auth/callback`,
      scope: "identify guilds",
      state,
      prompt: "none",
    });
    return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/callback", async (request, reply) => {
    if (!loginReady()) return reply.redirect("/?error=login_not_configured");
    const { code, state } = request.query;
    const savedState = request.cookies[STATE_COOKIE] && request.unsignCookie(request.cookies[STATE_COOKIE]);
    reply.clearCookie(STATE_COOKIE, { path: "/" });
    if (!code || !state || !savedState || !savedState.valid || savedState.value !== state) {
      return reply.redirect("/?error=login_failed");
    }

    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${requestOrigin(request)}/auth/callback`,
      }),
    });
    if (!tokenRes.ok) {
      request.log.warn({ status: tokenRes.status }, "Discord token exchange failed");
      return reply.redirect("/?error=login_failed");
    }
    const token = (await tokenRes.json()) as { access_token: string; expires_in: number };

    const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userRes.ok) return reply.redirect("/?error=login_failed");
    const user = (await userRes.json()) as { id: string; username: string; global_name?: string; avatar: string | null };

    const id = randomBytes(32).toString("hex");
    const ttlSeconds = Math.min(token.expires_in, 7 * 24 * 60 * 60);
    await db.insert(sessions)
      .values({
        id,
        userId: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar,
        accessToken: encryptToken(token.access_token),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      })
      .run();
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run(); // tidy up old logins

    reply.setCookie(SESSION_COOKIE, id, cookieOptions(request, ttlSeconds));
    return reply.redirect("/servers");
  });

  app.post("/auth/logout", async (request, reply) => {
    const session = await loadSession(request);
    if (session) await db.delete(sessions).where(eq(sessions.id, session.id)).run();
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}

/** Calls the Discord API on behalf of the logged-in user. */
export async function discordUserFetch<T>(session: Session, path: string): Promise<T> {
  const accessToken = decryptToken(session.accessToken);
  if (!accessToken) throw Object.assign(new Error("Stored login can't be read"), { status: 401 }); // log in again
  const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw Object.assign(new Error(`Discord API ${path} returned ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}
