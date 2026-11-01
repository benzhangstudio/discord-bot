import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { sessions } from "../db/schema.js";

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_COOKIE = "n1_session";
const STATE_COOKIE = "n1_oauth_state";
const REDIRECT_URI = `${config.publicUrl}/auth/callback`;
const secureCookies = Boolean(config.publicUrl?.startsWith("https://"));

export type Session = typeof sessions.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

function cookieOptions(maxAgeSeconds: number) {
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: secureCookies, signed: true, maxAge: maxAgeSeconds };
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

export function registerAuthRoutes(app: FastifyInstance) {
  app.get("/auth/login", async (_request, reply) => {
    if (!config.loginReady) return reply.redirect("/?error=login_not_configured");
    const state = randomBytes(16).toString("hex");
    reply.setCookie(STATE_COOKIE, state, cookieOptions(600));
    const params = new URLSearchParams({
      client_id: config.clientId!,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "identify guilds",
      state,
      prompt: "none",
    });
    return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/callback", async (request, reply) => {
    if (!config.loginReady) return reply.redirect("/?error=login_not_configured");
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
        redirect_uri: REDIRECT_URI,
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
        accessToken: token.access_token,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      })
      .run();
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run(); // tidy up old logins

    reply.setCookie(SESSION_COOKIE, id, cookieOptions(ttlSeconds));
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
  const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (!res.ok) throw Object.assign(new Error(`Discord API ${path} returned ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}
