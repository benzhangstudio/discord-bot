import { type Guild, PermissionFlagsBits } from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { moderationFeature } from "../../shared/features.js";
import {
  type CaseAction,
  type CaseListResponse,
  type CaseView,
  MAX_REASON,
  type ModerationResponse,
  type ModerationSettings,
  caseActions,
  moderationSettings,
} from "../../shared/moderation.js";
import { getSettings, runAction } from "./actions.js";
import { auditEvent } from "./audit.js";
import { ModError, setupProblems } from "./checks.js";
import { moderationCommands } from "./commands.js";
import { caseUrl, refreshLog } from "./messages.js";
import * as store from "./store.js";
import { startBanTimers } from "./timers.js";

type Req = FastifyRequest<{ Params: { guildId: string; caseNumber?: string }; Querystring: Record<string, string | undefined> }>;

const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

function toView(c: store.CaseRow): CaseView {
  return {
    caseNumber: c.caseNumber,
    action: c.action as CaseAction,
    userId: c.userId,
    userTag: c.userTag,
    moderatorId: c.moderatorId,
    moderatorTag: c.moderatorTag,
    reason: c.reason,
    durationMs: c.durationMs,
    expiresAt: c.expiresAt?.getTime() ?? null,
    active: c.active,
    auto: c.auto,
    external: c.external,
    dmSent: c.dmSent,
    createdAt: c.createdAt.getTime(),
    logUrl: caseUrl(c),
  };
}

async function respond(guild: Guild, settings: ModerationSettings): Promise<ModerationResponse> {
  return { settings, status: { ...(await store.stats(guild.id)), problems: setupProblems(guild, settings) } };
}

function validate(guild: Guild, s: ModerationSettings) {
  if (s.logChannelId) {
    const channel = guild.channels.cache.get(s.logChannelId);
    if (!channel || !channel.isTextBased() || channel.isThread()) throw new ModError("The mod log channel no longer exists. Pick another one.");
  }
  const seen = new Set<number>();
  for (const step of s.escalation) {
    if (seen.has(step.warnings)) throw new ModError(`There are two automatic steps for ${step.warnings} warnings. Keep one.`);
    seen.add(step.warnings);
    if (step.action === "timeout" && (step.durationMinutes < 1 || step.durationMinutes > 28 * 24 * 60)) {
      throw new ModError(`The timeout at ${step.warnings} warnings must last between 1 minute and 28 days.`);
    }
  }
  s.escalation.sort((a, b) => a.warnings - b.warnings);
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ModError) return reply.code(400).send({ error: err.message.replace(/\*\*/g, "") });
    throw err;
  }
}

async function findCase(request: Req) {
  const number = Number(request.params.caseNumber);
  const found = Number.isInteger(number) ? await store.getCase(request.params.guildId, number) : undefined;
  if (!found) throw new ModError("That case doesn't exist anymore.");
  return found;
}

const reasonBody = z.object({ reason: z.string().trim().max(MAX_REASON) });

export const moderation: BotFeature = {
  info: moderationFeature,
  commands: moderationCommands,
  events: [auditEvent],
  setup: startBanTimers,

  registerApi(api) {
    api.get("/api/guilds/:guildId/moderation", async (request: Req) => {
      const guild = guildOf(request);
      return respond(guild, await getSettings(guild.id));
    });

    api.put("/api/guilds/:guildId/moderation", async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = moderationSettings.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
        validate(guild, parsed.data);
        const state = await getFeatureState(guild.id, moderationFeature);
        await saveFeatureState(guild.id, moderationFeature, { enabled: state.enabled, settings: parsed.data }, request.session!.userId);
        return respond(guild, parsed.data);
      }),
    );

    api.get("/api/guilds/:guildId/moderation/cases", async (request: Req): Promise<CaseListResponse> => {
      const { q = "", action, before } = request.query;
      const query = q.trim().slice(0, 100);
      const userId = /^\d{17,20}$/.test(query) ? query : undefined;
      const limit = 25;
      const cases = await store.listCases(request.params.guildId, {
        userId,
        search: userId ? undefined : query || undefined,
        actions: action && (caseActions as readonly string[]).includes(action) ? [action as CaseAction] : undefined,
        before: before ? Number(before) || undefined : undefined,
        limit,
      });
      return { cases: cases.map(toView), nextBefore: cases.length === limit ? cases[cases.length - 1].caseNumber : null };
    });

    api.patch("/api/guilds/:guildId/moderation/cases/:caseNumber", async (request: Req, reply) =>
      guarded(reply, async () => {
        const body = reasonBody.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: `Reasons can be up to ${MAX_REASON} characters.` });
        const found = await findCase(request);
        found.reason = body.data.reason;
        await store.updateCase(found.id, { reason: found.reason });
        await refreshLog(guildOf(request), found);
        return toView(found);
      }),
    );

    api.delete("/api/guilds/:guildId/moderation/cases/:caseNumber", async (request: Req, reply) =>
      guarded(reply, async () => {
        const found = await findCase(request);
        await store.deleteCase(found.id);
        await refreshLog(guildOf(request), found, { deletedBy: request.session!.username });
        return { ok: true };
      }),
    );

    /** Ends an active temporary ban or timeout early, as the dashboard user. */
    api.post("/api/guilds/:guildId/moderation/cases/:caseNumber/lift", async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        if (!(await isFeatureEnabled(guild.id, moderationFeature))) throw new ModError("Turn on Moderation first.");
        const found = await findCase(request);
        if (!found.active || (found.action !== "ban" && found.action !== "timeout")) {
          throw new ModError("This case has already ended.");
        }
        const moderator = await guild.members.fetch(request.session!.userId).catch(() => null);
        if (!moderator) throw new ModError("You're no longer a member of this server.");
        const user = await client.users.fetch(found.userId).catch(() => null);
        if (!user) throw new ModError("That user no longer exists on Discord.");
        const action = found.action === "ban" ? "unban" : "untimeout";
        if (action === "unban" && !moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
          throw new ModError("You need the Ban Members permission to lift a ban.");
        }
        try {
          const result = await runAction(guild, {
            action,
            user,
            moderator: { id: moderator.id, tag: moderator.user.tag, member: moderator },
            reason: `Lifted case #${found.caseNumber} from the dashboard`,
          });
          return toView(result.case);
        } catch (err) {
          // Already lifted in Discord: just mark the case as ended.
          if (err instanceof ModError && /isn't (banned|timed out)/.test(err.message)) {
            await store.deactivate(guild.id, found.userId, found.action as "ban" | "timeout");
            throw new ModError("They were already let back in, so the case is now marked as ended.");
          }
          throw err;
        }
      }),
    );
  },
};
