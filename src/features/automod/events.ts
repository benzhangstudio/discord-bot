import {
  AutoModerationActionType,
  type GuildMember,
  type Message,
  type PartialMessage,
  PermissionFlagsBits,
} from "discord.js";
import { canReadMessages } from "../../server/bot/discord.js";
import { onEvent } from "../../server/bot/types.js";
import { type AutomodRuleKey, type AutomodSettings, botRules, needsContent } from "../../shared/automod.js";
import { channelIgnored, countCatch, followUp, getState, isExempt, postAlert, roleIgnored } from "./act.js";
import { countEmojis, countLinks, isShouting, isZalgo, trackBurst, trackRepeat } from "./filters.js";
import { filterForRule, syncRules } from "./native.js";

type BotRule = (typeof botRules)[number];

/** Which of Number One's own filters a message breaks, and which messages to delete because of it. */
function check(
  message: Message<true>,
  settings: AutomodSettings,
  member: GuildMember,
  isEdit: boolean,
): { key: BotRule; toDelete: { channelId: string; messageId: string }[] } | null {
  const reading = canReadMessages();
  const applies = (key: BotRule) => {
    const rule = settings[key];
    return (
      rule.enabled &&
      (reading || !needsContent(key)) &&
      !channelIgnored(rule.ignoredChannelIds, message.channel) &&
      !roleIgnored(rule.ignoredRoleIds, member)
    );
  };
  const self = [{ channelId: message.channelId, messageId: message.id }];
  const text = message.content;
  const { guildId } = message;

  // Anti-spam first: every new message must be counted, even one another filter would catch.
  // Edits aren't new posts, so they don't count towards bursts or repeats.
  const burstHits: { key: BotRule; toDelete: { channelId: string; messageId: string }[] }[] = [];
  if (!isEdit) {
    const burst = (key: "rate" | "attachments" | "linkSpam", weight: number, limit: number, seconds: number, channels?: number) => {
      if (!applies(key)) return;
      const toDelete = trackBurst(key, guildId, member.id, message, { weight, limit, seconds, channels });
      if (toDelete) burstHits.push({ key, toDelete });
    };
    burst("rate", 1, settings.rate.messages, settings.rate.seconds, settings.rate.channels);
    burst("attachments", message.attachments.size + message.stickers.size, settings.attachments.count, settings.attachments.seconds);
    burst("linkSpam", countLinks(text), settings.linkSpam.count, settings.linkSpam.seconds);
    if (applies("repeated")) {
      const copies = trackRepeat(guildId, member.id, message, settings.repeated);
      if (copies) burstHits.push({ key: "repeated", toDelete: copies });
    }
  }
  if (burstHits.length) {
    // Several limits at once (e.g. a flood of links that's also too fast): act once, delete everything caught.
    const seen = new Set<string>();
    const toDelete = burstHits.flatMap((h) => h.toDelete).filter((m) => !seen.has(m.messageId) && seen.add(m.messageId));
    return { key: burstHits[0].key, toDelete };
  }

  if (!text) return null;
  if (applies("zalgo") && isZalgo(text)) return { key: "zalgo", toDelete: self };
  if (applies("caps") && isShouting(text, settings.caps)) return { key: "caps", toDelete: self };
  if (applies("emoji") && countEmojis(text) > settings.emoji.max) return { key: "emoji", toDelete: self };
  return null;
}

async function handle(message: Message | PartialMessage, isEdit: boolean) {
  if (!message.inGuild() || message.author?.bot || message.webhookId || message.system) return;
  const { enabled, settings } = await getState(message.guildId);
  const reading = canReadMessages();
  if (!enabled || !botRules.some((k) => settings[k].enabled && (reading || !needsContent(k)))) return;

  if (message.partial) message = await message.fetch().catch(() => message);
  if (message.partial) return;
  const msg = message as Message<true>;
  const member = msg.member ?? (await msg.guild.members.fetch(msg.author.id).catch(() => null));
  if (!member || isExempt(member)) return;

  const hit = check(msg, settings, member, isEdit);
  if (!hit) return;

  // Delete everything caught, one request per channel (a spam burst can span several).
  const me = msg.guild.members.me;
  const byChannel = new Map<string, string[]>();
  for (const { channelId, messageId } of hit.toDelete) byChannel.set(channelId, [...(byChannel.get(channelId) ?? []), messageId]);
  let deleted = 0;
  for (const [channelId, ids] of byChannel) {
    const channel = channelId === msg.channelId ? msg.channel : msg.guild.channels.cache.get(channelId);
    const target = channel?.isTextBased() ? channel : null;
    if (!target || !me || !target.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) continue;
    if (ids.length === 1) {
      if (await target.messages.delete(ids[0]).then(() => true, () => false)) deleted++;
    } else if ("bulkDelete" in target) {
      deleted += (await target.bulkDelete(ids, true).catch(() => null))?.size ?? 0;
    }
  }

  countCatch(msg.guildId);
  await postAlert(msg.guild, settings, { user: msg.author, channelId: msg.channelId, key: hit.key, content: msg.content, deleted });
  await followUp(msg.guild, msg.author, hit.key, settings);
}

export const messageEvent = onEvent("messageCreate", (message) => handle(message, false));

export const editEvent = onEvent("messageUpdate", (before, after) => {
  // Only re-check when the text actually changed (embeds loading also count as an "edit").
  if (before.content !== null && before.content === after.content) return;
  return handle(after, true);
});

/**
 * Discord's AutoMod caught something with one of Number One's rules. Discord already blocked the
 * message (and timed them out, if set); Number One now takes the follow-up step and records the case.
 * Each catch fires once per Discord action, so only the "block" action is used.
 */
export const executionEvent = onEvent("autoModerationActionExecution", async (execution) => {
  if (execution.action.type !== AutoModerationActionType.BlockMessage) return;
  const { guild } = execution;
  const rule = execution.autoModerationRule ?? (await guild.autoModerationRules.fetch(execution.ruleId).catch(() => null));
  const key: AutomodRuleKey | null = filterForRule(rule);
  if (!key) return;
  const { enabled, settings } = await getState(guild.id);
  if (!enabled) return;
  const user = execution.user ?? (await guild.client.users.fetch(execution.userId).catch(() => null));
  if (!user) return;
  await followUp(guild, user, key, settings);
});

/** Number One joined a server that already had settings (e.g. it was re-added): put its rules back. */
export const joinEvent = onEvent("guildCreate", async (guild) => {
  const { enabled, settings } = await getState(guild.id);
  if (enabled) await syncRules(guild, settings, true);
});
