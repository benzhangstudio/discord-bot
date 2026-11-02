import { EmbedBuilder, type Guild, type GuildMember, PermissionFlagsBits, type User } from "discord.js";
import { getFeatureState } from "../../server/settings.js";
import { type AutomodRuleKey, type AutomodSettings, ruleInfo } from "../../shared/automod.js";
import { automodFeature } from "../../shared/features.js";
import { formatDuration } from "../../shared/moderation.js";
import { runAction } from "../moderation/actions.js";
import { ModError } from "../moderation/checks.js";

const log = (...args: unknown[]) => console.warn("[automod]", ...args);

/* ------------------------------------------------------------ settings cache */

/** Settings are read on every message, so they're kept for a short while instead of hitting the database each time. */
const cache = new Map<string, { at: number; enabled: boolean; settings: AutomodSettings }>();
const CACHE_MS = 30_000;

export async function getState(guildId: string): Promise<{ enabled: boolean; settings: AutomodSettings }> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const state = await getFeatureState(guildId, automodFeature);
  const entry = { at: Date.now(), enabled: state.enabled, settings: state.settings as AutomodSettings };
  cache.set(guildId, entry);
  return entry;
}

/** Call after settings change so the next message uses them. */
export const forgetState = (guildId: string) => cache.delete(guildId);

/* ------------------------------------------------------------ counters */

const caught = new Map<string, number>();
export const caughtCount = (guildId: string) => caught.get(guildId) ?? 0;
export const countCatch = (guildId: string) => caught.set(guildId, caughtCount(guildId) + 1);

/* ------------------------------------------------------------ who's skipped */

/** Mirrors Discord's AutoMod: admins and people who can manage the server are never filtered. */
export function isExempt(member: GuildMember): boolean {
  return (
    member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/** Whether a filter skips this channel (directly, through its category, or as a thread of a skipped channel). */
export function channelIgnored(ignored: string[], channel: { id: string; parentId: string | null; parent?: { parentId: string | null } | null; isThread(): boolean }) {
  if (!ignored.length) return false;
  const ids = [channel.id, channel.parentId];
  if (channel.isThread()) ids.push(channel.parent?.parentId ?? null);
  return ids.some((id) => id && ignored.includes(id));
}

export const roleIgnored = (ignored: string[], member: GuildMember) => ignored.some((id) => member.roles.cache.has(id));

/* ------------------------------------------------------------ follow-up steps */

/**
 * Stops one burst of spam from causing a pile of cases: after acting on someone for a filter,
 * further catches by the same filter within this window only delete the message.
 */
const recentActions = new Map<string, number>();
const COOLDOWN_MS = 30_000;

/**
 * Takes the filter's follow-up step (warn, time out or kick) through Moderation, so it gets a case,
 * a mod log entry, a DM and counts towards automatic warning steps, exactly like a moderator's action.
 */
export async function followUp(guild: Guild, user: User, key: AutomodRuleKey, settings: AutomodSettings) {
  const rule = settings[key];
  if (rule.action === "delete") return;

  const id = `${guild.id}:${user.id}:${key}`;
  const last = recentActions.get(id) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  recentActions.set(id, Date.now());
  if (recentActions.size > 5000) {
    for (const [k, at] of recentActions) if (Date.now() - at > COOLDOWN_MS) recentActions.delete(k);
  }

  const me = guild.members.me;
  if (!me) return;
  const durationMs = rule.action === "timeout" ? rule.timeoutMinutes * 60_000 : null;
  const reason = `Auto-mod: ${ruleInfo[key].name.toLowerCase()}${durationMs ? ` (${formatDuration(durationMs)})` : ""}`;
  try {
    await runAction(guild, {
      action: rule.action,
      user,
      moderator: { id: me.id, tag: me.user.tag, member: null },
      reason,
      durationMs,
      auto: true,
    });
  } catch (err) {
    // E.g. the member left, or their role is above Number One's. Nothing else to do.
    if (err instanceof ModError) log(`${rule.action} in ${guild.name} (${guild.id}) skipped: ${err.message.replace(/\*\*/g, "")}`);
    else log(`${rule.action} in ${guild.name} (${guild.id}) failed:`, err);
  }
}

/* ------------------------------------------------------------ alerts */

/**
 * Posts a short note in the alert channel when Number One's own filters delete something.
 * (Discord posts its own alerts for its filters.)
 */
export async function postAlert(
  guild: Guild,
  settings: AutomodSettings,
  info: { user: User; channelId: string; key: AutomodRuleKey; content: string; deleted: number },
) {
  if (!settings.alertChannelId) return;
  const channel = guild.channels.cache.get(settings.alertChannelId);
  if (!channel?.isTextBased()) return;
  const rule = ruleInfo[info.key];
  const excerpt = info.content.length > 700 ? `${info.content.slice(0, 700)}…` : info.content;
  const step = settings[info.key].action;
  const embed = new EmbedBuilder()
    .setColor(0xff4fa3)
    .setAuthor({ name: info.user.tag, iconURL: info.user.displayAvatarURL() })
    .setTitle(`${rule.emoji} ${rule.name}`)
    .setDescription(excerpt ? `>>> ${excerpt}` : null)
    .addFields(
      { name: "Member", value: `<@${info.user.id}>`, inline: true },
      { name: "Channel", value: `<#${info.channelId}>`, inline: true },
      {
        name: "Action",
        value:
          (info.deleted > 1 ? `Deleted ${info.deleted} messages` : "Deleted the message") +
          (step === "warn" ? ", warned" : step === "timeout" ? ", timed out" : step === "kick" ? ", kicked" : ""),
        inline: true,
      },
    )
    .setFooter({ text: "Number One auto-moderation" })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err) => log("alert failed:", err.message));
}
