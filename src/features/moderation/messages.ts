import { EmbedBuilder, type Guild, type Message, type User } from "discord.js";
import { type CaseAction, type ModerationSettings, actionInfo, formatDuration } from "../../shared/moderation.js";
import type { CaseRow } from "./store.js";
import * as store from "./store.js";

const log = (...args: unknown[]) => console.warn("[moderation]", ...args);

/** Discord timestamp that shows in each reader's own time zone. */
const when = (date: Date, style: "f" | "R" = "f") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

export const caseTitle = (c: Pick<CaseRow, "caseNumber" | "action">) => {
  const info = actionInfo[c.action as CaseAction];
  return `${info?.emoji ?? "•"} Case #${c.caseNumber} · ${info?.label ?? c.action}`;
};

/** The mod-log card for a case. Also used by /case view. */
export function caseEmbed(c: CaseRow, extra?: { deletedBy?: string }) {
  const info = actionInfo[c.action as CaseAction];
  const lines = [
    `**Member:** <@${c.userId}> (${c.userTag}) \`${c.userId}\``,
    `**Moderator:** ${c.auto ? "Number One (automatic)" : `<@${c.moderatorId}> (${c.moderatorTag})`}`,
    `**Reason:** ${c.reason || "_No reason given_"}`,
  ];
  if (c.durationMs) {
    const ends = c.expiresAt ? ` · ends ${when(c.expiresAt, "R")}` : "";
    lines.push(`**Duration:** ${formatDuration(c.durationMs)}${ends}`);
  } else if (c.action === "ban") {
    lines.push("**Duration:** Permanent");
  }
  const flags: string[] = [];
  if (c.external) flags.push("Done directly in Discord");
  if (c.auto) flags.push("Automatic");
  if (["warn", "timeout", "kick", "ban"].includes(c.action) && !c.external && !c.dmSent) flags.push("Member couldn't be messaged");
  if (c.action === "ban" && c.durationMs && !c.active) flags.push("Ended");

  const embed = new EmbedBuilder()
    .setColor(extra?.deletedBy ? 0x55505a : (info?.color ?? 0xff4fa3))
    .setTitle(caseTitle(c))
    .setDescription(lines.join("\n"))
    .setTimestamp(c.createdAt)
    .setFooter({ text: [`User ID ${c.userId}`, ...flags].join(" · ") });
  if (extra?.deletedBy) embed.addFields({ name: "Deleted", value: `This case was deleted by ${extra.deletedBy}.` });
  return embed;
}

/**
 * Tells a member what happened to them. Sent before kicks and bans (afterwards there's no shared server
 * to message them through). Returns the sent message, or null when their DMs are closed.
 */
export async function dmMember(
  guild: Guild,
  user: User,
  action: CaseAction,
  settings: ModerationSettings,
  details: { reason: string; durationMs: number | null; moderatorTag: string },
): Promise<Message | null> {
  if (!settings.dmMembers || user.bot) return null;
  const titles: Partial<Record<CaseAction, string>> = {
    warn: `You were warned in ${guild.name}`,
    timeout: `You were timed out in ${guild.name}`,
    untimeout: `Your timeout in ${guild.name} was removed`,
    kick: `You were kicked from ${guild.name}`,
    ban: `You were banned from ${guild.name}`,
  };
  const title = titles[action];
  if (!title) return null;

  const lines = [`**Reason:** ${details.reason || "No reason given"}`];
  if (details.durationMs) {
    lines.push(`**Duration:** ${formatDuration(details.durationMs)} (ends ${when(new Date(Date.now() + details.durationMs), "R")})`);
  } else if (action === "ban") {
    lines.push("**Duration:** Permanent");
  }
  if (settings.dmShowModerator) lines.push(`**Moderator:** ${details.moderatorTag}`);
  if (action === "ban" && settings.appealMessage) lines.push("", settings.appealMessage);

  const embed = new EmbedBuilder()
    .setColor(actionInfo[action].color)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setTimestamp(new Date());
  if (guild.iconURL()) embed.setThumbnail(guild.iconURL()!);
  return user.send({ embeds: [embed] }).catch(() => null);
}

/** Posts a case in the mod log channel and remembers the message so later edits can update it. */
export async function postToLog(guild: Guild, settings: ModerationSettings, c: CaseRow) {
  if (!settings.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId);
  if (!channel?.isSendable()) return;
  try {
    const message = await channel.send({ embeds: [caseEmbed(c)], allowedMentions: { parse: [] } });
    await store.updateCase(c.id, { logChannelId: channel.id, logMessageId: message.id });
    c.logChannelId = channel.id;
    c.logMessageId = message.id;
  } catch (err) {
    log(`couldn't post case #${c.caseNumber} in the mod log of ${guild.name} (${guild.id}):`, (err as Error).message);
  }
}

/** Updates a case's mod-log post after its reason changes or it's deleted. */
export async function refreshLog(guild: Guild, c: CaseRow, extra?: { deletedBy?: string }) {
  if (!c.logChannelId || !c.logMessageId) return;
  const channel = guild.channels.cache.get(c.logChannelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(c.logMessageId).catch(() => null);
  await message?.edit({ embeds: [caseEmbed(c, extra)], allowedMentions: { parse: [] } }).catch(() => {});
}

/** A small mod-log post for things that aren't cases (e.g. /purge). */
export async function postNote(guild: Guild, settings: ModerationSettings, title: string, description: string) {
  if (!settings.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId);
  if (!channel?.isSendable()) return;
  const embed = new EmbedBuilder().setColor(0x8c8c99).setTitle(title).setDescription(description).setTimestamp(new Date());
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

export const caseUrl = (c: CaseRow) =>
  c.logChannelId && c.logMessageId ? `https://discord.com/channels/${c.guildId}/${c.logChannelId}/${c.logMessageId}` : null;
