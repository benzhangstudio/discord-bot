import { DiscordAPIError, type Guild, type GuildMember, RESTJSONErrorCodes, type User } from "discord.js";
import { getFeatureState } from "../../server/settings.js";
import { moderationFeature } from "../../shared/features.js";
import {
  type CaseAction,
  type EscalationStep,
  MAX_TEMPBAN_MS,
  MAX_TIMEOUT_MS,
  type ModerationSettings,
  formatDuration,
} from "../../shared/moderation.js";
import { ModError, checkCanAct, checkReason } from "./checks.js";
import { dmMember, postToLog } from "./messages.js";
import * as store from "./store.js";

const log = (...args: unknown[]) => console.warn("[moderation]", ...args);

export async function getSettings(guildId: string): Promise<ModerationSettings> {
  return (await getFeatureState(guildId, moderationFeature)).settings as ModerationSettings;
}

/** Who is acting. `member` is null when Number One acts by itself. */
export interface Moderator {
  id: string;
  tag: string;
  member: GuildMember | null;
}

export interface ActionRequest {
  action: CaseAction;
  user: User;
  /** The target's membership, when they're in the server. Looked up if left out. */
  member?: GuildMember | null;
  moderator: Moderator;
  reason: string;
  /** Timeout length, or ban length for a temporary ban. */
  durationMs?: number | null;
  /** Bans only: how much of their recent message history to delete. */
  deleteMessageSeconds?: number;
  /** Number One acted by itself (warning steps, a temporary ban running out). */
  auto?: boolean;
}

export interface ActionResult {
  case: store.CaseRow;
  /** Cases made automatically because of this one (e.g. a timeout after the third warning). */
  followUps: store.CaseRow[];
}

/** Text for Discord's audit log, so it shows which moderator used Number One. */
const auditReason = (m: Moderator, reason: string) => `${m.tag}: ${reason || "No reason given"}`.slice(0, 512);

/** Turns Discord errors into plain words. */
function explain(err: unknown, action: CaseAction): never {
  if (err instanceof DiscordAPIError) {
    if (err.code === RESTJSONErrorCodes.MissingPermissions) {
      throw new ModError("Discord didn't let me do that. Check that my role is high enough and has the right permissions.");
    }
    if (err.code === RESTJSONErrorCodes.UnknownBan) throw new ModError("That user isn't banned.");
    if (err.code === RESTJSONErrorCodes.UnknownMember) throw new ModError("That member isn't in the server anymore.");
  }
  log(`${action} failed:`, err);
  throw new ModError("Discord didn't accept that action. Please try again.");
}

/**
 * Carries out one moderation action from start to finish:
 * checks, DM, the Discord action itself, the case record, the mod log, and any automatic follow-up steps.
 * Throws a ModError with a plain-language explanation when it can't be done.
 */
export async function runAction(guild: Guild, req: ActionRequest, settings?: ModerationSettings): Promise<ActionResult> {
  settings ??= await getSettings(guild.id);
  const { action, user, moderator } = req;
  const reason = req.reason.trim();
  const member = req.member !== undefined ? req.member : await guild.members.fetch(user.id).catch(() => null);

  if (!req.auto) checkReason(settings, reason);
  checkCanAct(guild, action, moderator.member, { user, member });

  let durationMs = req.durationMs ?? null;
  if (action === "timeout") {
    if (!durationMs) throw new ModError("Give a timeout length, like `10m`, `1h` or `1d`.");
    if (durationMs > MAX_TIMEOUT_MS) throw new ModError("Timeouts can be at most 28 days.");
    if (durationMs < 60_000) throw new ModError("Timeouts must be at least 1 minute.");
  }
  if (action === "ban" && durationMs) {
    if (durationMs > MAX_TEMPBAN_MS) throw new ModError("Temporary bans can be at most 1 year. Leave the duration empty for a permanent ban.");
    if (durationMs < 60_000) throw new ModError("Temporary bans must be at least 1 minute.");
  }
  if (!["timeout", "ban"].includes(action)) durationMs = null;

  if (action === "unban") {
    const ban = await guild.bans.fetch({ user: user.id, force: true }).catch(() => null);
    if (!ban) throw new ModError(`**${user.username}** isn't banned.`);
  }

  // Kicked and banned members can't be messaged afterwards, so their DM goes first.
  // If the action then fails, the DM is taken back.
  const dmFirst = (action === "kick" || action === "ban") && member;
  const details = { reason, durationMs, moderatorTag: moderator.tag };
  const earlyDm = dmFirst ? await dmMember(guild, user, action, settings, details) : null;

  const audit = auditReason(moderator, reason);
  try {
    switch (action) {
      case "timeout":
        await member!.timeout(durationMs!, audit);
        break;
      case "untimeout":
        await member!.timeout(null, audit);
        break;
      case "kick":
        await member!.kick(audit);
        break;
      case "ban":
        await guild.bans.create(user.id, { reason: audit, deleteMessageSeconds: req.deleteMessageSeconds ?? settings.banDeleteDays * 86_400 });
        break;
      case "unban":
        await guild.bans.remove(user.id, audit);
        break;
    }
  } catch (err) {
    await earlyDm?.delete().catch(() => {});
    explain(err, action);
  }

  // A new timeout or ban replaces the old one; lifting ends it.
  if (action === "timeout" || action === "untimeout") await store.deactivate(guild.id, user.id, "timeout");
  if (action === "ban" || action === "unban") await store.deactivate(guild.id, user.id, "ban");

  const lateDm = !dmFirst && member ? await dmMember(guild, user, action, settings, details) : null;

  const now = new Date();
  const row = await store.createCase({
    guildId: guild.id,
    action,
    userId: user.id,
    userTag: user.tag,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
    durationMs,
    expiresAt: durationMs ? new Date(now.getTime() + durationMs) : null,
    active: Boolean(durationMs && (action === "timeout" || action === "ban")),
    auto: Boolean(req.auto),
    external: false,
    dmSent: Boolean(earlyDm ?? lateDm),
    createdAt: now,
  });
  await postToLog(guild, settings, row);

  const followUps = action === "warn" ? await escalate(guild, settings, user, member) : [];
  return { case: row, followUps };
}

/** The automatic step for a member's warning count, if one matches exactly. */
export function stepFor(settings: ModerationSettings, warnings: number): EscalationStep | undefined {
  return settings.escalation.find((s) => s.warnings === warnings);
}

/** After a warning: takes the automatic step the server set for this many warnings. */
async function escalate(guild: Guild, settings: ModerationSettings, user: User, member: GuildMember | null): Promise<store.CaseRow[]> {
  if (!settings.escalation.length) return [];
  const count = await store.activeWarningCount(guild.id, user.id, settings.warnExpiryDays);
  const step = stepFor(settings, count);
  if (!step) return [];
  // Timeouts and kicks need them in the server; bans work either way.
  if (!member && step.action !== "ban") return [];

  const me = guild.members.me!;
  const durationMs = step.action === "kick" ? null : step.durationMinutes * 60_000 || null;
  const reason = `Automatic: reached ${count} warning${count === 1 ? "" : "s"}`;
  try {
    const result = await runAction(
      guild,
      {
        action: step.action,
        user,
        member,
        moderator: { id: me.id, tag: me.user.tag, member: null },
        reason: durationMs ? `${reason} (${formatDuration(durationMs)})` : reason,
        durationMs: step.action === "timeout" ? (durationMs ?? 60 * 60_000) : durationMs,
        auto: true,
      },
      settings,
    );
    return [result.case];
  } catch (err) {
    log(`automatic ${step.action} in ${guild.name} (${guild.id}) failed:`, (err as Error).message);
    return [];
  }
}

/**
 * Records an action someone took directly in Discord (seen in the audit log), without doing anything.
 * Keeps temporary bans in step: a manual unban ends one, so it won't be lifted twice.
 */
export async function recordExternal(
  guild: Guild,
  settings: ModerationSettings,
  values: { action: CaseAction; user: User; moderator: { id: string; tag: string }; reason: string; durationMs: number | null },
) {
  const { action, user } = values;
  if (action === "ban" || action === "unban") await store.deactivate(guild.id, user.id, "ban");
  if (action === "timeout" || action === "untimeout") await store.deactivate(guild.id, user.id, "timeout");
  const now = new Date();
  const row = await store.createCase({
    guildId: guild.id,
    action,
    userId: user.id,
    userTag: user.tag,
    moderatorId: values.moderator.id,
    moderatorTag: values.moderator.tag,
    reason: values.reason,
    durationMs: values.durationMs,
    expiresAt: values.durationMs ? new Date(now.getTime() + values.durationMs) : null,
    active: action === "timeout" && Boolean(values.durationMs),
    auto: false,
    external: true,
    dmSent: false,
    createdAt: now,
  });
  await postToLog(guild, settings, row);
  return row;
}
