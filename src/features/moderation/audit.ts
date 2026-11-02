import { AuditLogEvent, type Guild, type GuildAuditLogsEntry, type User } from "discord.js";
import { onEvent } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { moderationFeature } from "../../shared/features.js";
import type { CaseAction } from "../../shared/moderation.js";
import { getSettings, recordExternal } from "./actions.js";

/**
 * Picks up bans, unbans, kicks and timeouts that staff did directly in Discord (right-click → Ban, etc.)
 * and records them as cases too, so every member's history is complete.
 * Actions Number One took itself are skipped: those are already cases.
 */

function timeoutChange(entry: GuildAuditLogsEntry): { action: CaseAction; durationMs: number | null } | null {
  const change = entry.changes.find((c) => c.key === "communication_disabled_until");
  if (!change) return null;
  const until = change.new ? new Date(change.new as string).getTime() : 0;
  if (until > Date.now()) return { action: "timeout", durationMs: until - Date.now() };
  return { action: "untimeout", durationMs: null };
}

async function resolveUser(guild: Guild, id: string | null, known: unknown): Promise<User | null> {
  if (known && typeof known === "object" && "username" in known && "id" in known) return known as User;
  if (!id) return null;
  return guild.client.users.fetch(id).catch(() => null);
}

export const auditEvent = onEvent("guildAuditLogEntryCreate", async (entry, guild) => {
  if (!entry.executorId || entry.executorId === guild.client.user.id) return;

  let action: CaseAction;
  let durationMs: number | null = null;
  switch (entry.action) {
    case AuditLogEvent.MemberBanAdd:
      action = "ban";
      break;
    case AuditLogEvent.MemberBanRemove:
      action = "unban";
      break;
    case AuditLogEvent.MemberKick:
      action = "kick";
      break;
    case AuditLogEvent.MemberUpdate: {
      const t = timeoutChange(entry);
      if (!t) return;
      ({ action, durationMs } = t);
      break;
    }
    default:
      return;
  }

  if (!(await isFeatureEnabled(guild.id, moderationFeature))) return;
  const settings = await getSettings(guild.id);
  if (!settings.trackExternal) return;

  const [user, executor] = await Promise.all([
    resolveUser(guild, entry.targetId, entry.target),
    resolveUser(guild, entry.executorId, entry.executor),
  ]);
  if (!user) return;
  await recordExternal(guild, settings, {
    action,
    user,
    moderator: { id: entry.executorId, tag: executor?.tag ?? "Unknown" },
    reason: entry.reason ?? "",
    durationMs,
  });
});
