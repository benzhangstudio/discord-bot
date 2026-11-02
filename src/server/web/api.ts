import { PermissionFlagsBits, type Guild } from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { type DashboardGuild, type DashboardUser, categoryIds, getFeatureInfo } from "../../shared/features.js";
import { features } from "../../features/index.js";
import { client } from "../bot/client.js";
import { config, loginReady } from "../config.js";
import { getAccessState } from "../../features/onboarding/access.js";
import { deleteGuildData } from "../guildData.js";
import { applySetup, getAllFeatureStates, getFeatureState, getSetup, saveFeatureState } from "../settings.js";
import { type Session, discordUserFetch, requireSession } from "./auth.js";

const MANAGE_GUILD = PermissionFlagsBits.ManageGuild;
const ADMINISTRATOR = PermissionFlagsBits.Administrator;

// Discord limits how often we can list a user's servers, so remember the answer briefly.
const guildListCache = new Map<string, { at: number; guilds: DashboardGuild[] }>();
const GUILD_CACHE_MS = 30_000;

async function listManageableGuilds(session: Session): Promise<DashboardGuild[]> {
  const cached = guildListCache.get(session.id);
  if (cached && Date.now() - cached.at < GUILD_CACHE_MS) return cached.guilds;

  const raw = await discordUserFetch<{ id: string; name: string; icon: string | null; owner: boolean; permissions: string }[]>(
    session,
    "/users/@me/guilds",
  );
  const guilds = raw
    .filter((g) => {
      const perms = BigInt(g.permissions);
      return g.owner || (perms & MANAGE_GUILD) === MANAGE_GUILD || (perms & ADMINISTRATOR) === ADMINISTRATOR;
    })
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon, botPresent: client.guilds.cache.has(g.id) }))
    .sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));

  guildListCache.set(session.id, { at: Date.now(), guilds });
  return guilds;
}

/**
 * Confirms, using the bot's live view of the server, that the user still has Manage Server.
 * This is the security check every per-server route goes through.
 */
async function requireManagedGuild(request: FastifyRequest<{ Params: { guildId: string } }>, reply: FastifyReply) {
  const guild = client.guilds.cache.get(request.params.guildId);
  if (!guild) return reply.code(404).send({ error: "Number One isn't in that server" });
  const member = await guild.members.fetch(request.session!.userId).catch(() => null);
  if (!member || !member.permissions.has(MANAGE_GUILD)) {
    return reply.code(403).send({ error: "You need the Manage Server permission in that server" });
  }
}

function guildSummary(guild: Guild) {
  const botTop = guild.members.me?.roles.highest.position ?? 0;
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    memberCount: guild.memberCount,
    // Every channel and category (pickers filter by type), in the order Discord shows them.
    channels: guild.channels.cache
      .filter((c) => !c.isThread())
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId ?? null,
        position: "rawPosition" in c ? c.rawPosition : 0,
      }))
      .sort((a, b) => a.position - b.position),
    roles: guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        // Whether the bot's own role is high enough to give this role out.
        assignable: botTop > r.position,
      }))
      .sort((a, b) => b.position - a.position),
    emojis: guild.emojis.cache
      .filter((e) => e.available !== false)
      .map((e) => ({ id: e.id, name: e.name ?? "emoji", animated: Boolean(e.animated), text: e.toString() })),
  };
}

const featureUpdateBody = z.object({ enabled: z.boolean(), settings: z.record(z.string(), z.unknown()) });

export function registerApiRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => ({
    clientId: config.clientId ?? client.application?.id ?? null,
    loginReady: loginReady(),
    botReady: client.isReady(),
  }));

  app.register(async (api) => {
    api.addHook("preHandler", requireSession);

    api.get("/api/me", async (request): Promise<DashboardUser> => {
      const s = request.session!;
      return { id: s.userId, username: s.username, avatar: s.avatar };
    });

    api.get("/api/guilds", async (request, reply) => {
      try {
        return await listManageableGuilds(request.session!);
      } catch (err) {
        if ((err as { status?: number }).status === 401) return reply.code(401).send({ error: "Please log in again" });
        throw err;
      }
    });

    api.register(async (guildApi) => {
      guildApi.addHook("preHandler", requireManagedGuild);

      guildApi.get<{ Params: { guildId: string } }>("/api/guilds/:guildId", async (request) => {
        const guild = client.guilds.cache.get(request.params.guildId)!;
        return {
          guild: guildSummary(guild),
          features: await getAllFeatureStates(guild.id),
          setup: await getSetup(guild.id),
          isOwner: guild.ownerId === request.session!.userId,
        };
      });

      // Owner only: deletes everything stored about the server and removes the bot (Discord Developer Terms 5(b)).
      guildApi.delete<{ Params: { guildId: string } }>("/api/guilds/:guildId/data", async (request, reply) => {
        const guild = client.guilds.cache.get(request.params.guildId)!;
        if (guild.ownerId !== request.session!.userId) {
          return reply.code(403).send({ error: "Only the server owner can delete the server's data." });
        }
        // The access gate changed channel permissions; its saved data is what puts them back, so it must go first.
        const access = await getAccessState(guild.id);
        if (access.privateMode || Object.keys(access.managed).length > 0) {
          return reply.code(409).send({
            error: "Turn off the access gate in Onboarding first, so your channels go back to how they were. Then try again.",
          });
        }
        await guild.leave();
        await deleteGuildData(guild.id);
        guildListCache.clear(); // so the server list shows the bot is gone
        return { ok: true };
      });

      guildApi.put<{ Params: { guildId: string; featureId: string } }>(
        "/api/guilds/:guildId/features/:featureId",
        async (request, reply) => {
          const feature = getFeatureInfo(request.params.featureId);
          if (!feature) return reply.code(404).send({ error: "Unknown feature" });
          if (feature.workInProgress) {
            return reply.code(400).send({ error: `${feature.name} is still being worked on and can't be changed yet.` });
          }

          const body = featureUpdateBody.safeParse(request.body);
          if (!body.success) return reply.code(400).send({ error: "Invalid request" });
          const settings = feature.settings.safeParse(body.data.settings);
          if (!settings.success) {
            return reply.code(400).send({ error: "Invalid settings", issues: settings.error.issues });
          }

          await saveFeatureState(
            request.params.guildId,
            feature,
            { enabled: body.data.enabled, settings: settings.data },
            request.session!.userId,
          );
          const bot = features.find((f) => f.info.id === feature.id);
          await bot?.onToggle?.(request.params.guildId, body.data.enabled).catch((err) => request.log.warn(err));
          return getFeatureState(request.params.guildId, feature);
        },
      );

      // The dashboard's version of /setup: same categories, same result.
      guildApi.put<{ Params: { guildId: string } }>("/api/guilds/:guildId/setup", async (request, reply) => {
        const body = z.object({ categories: z.array(z.enum(categoryIds)).min(1, "Pick at least one") }).safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request" });
        const turnedOn = await applySetup(request.params.guildId, body.data.categories, request.session!.userId);
        return {
          turnedOn: turnedOn.map((f) => f.id),
          setup: await getSetup(request.params.guildId),
          features: await getAllFeatureStates(request.params.guildId),
        };
      });

      // Feature-specific dashboard routes (e.g. the reaction-role messages list).
      for (const feature of features) feature.registerApi?.(guildApi);
    });
  });
}
