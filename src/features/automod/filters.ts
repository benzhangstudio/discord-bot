import { createHash } from "node:crypto";
import type { AutomodSettings } from "../../shared/automod.js";

/**
 * Number One's own checks: the things Discord's AutoMod can't do.
 * Pure functions, so they're easy to reason about and test.
 */

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Parts of a message that aren't really "writing": links, mentions, custom emojis, code. */
function stripNoise(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/<(@[!&]?|#)\d+>/g, " ");
}

/** True when enough of the message's letters are capitals. Short messages are never shouting. */
export function isShouting(text: string, rule: AutomodSettings["caps"]): boolean {
  const clean = stripNoise(text);
  const upper = clean.match(/\p{Lu}/gu)?.length ?? 0;
  const lower = clean.match(/\p{Ll}/gu)?.length ?? 0;
  const letters = upper + lower;
  return letters >= rule.minLetters && (upper / letters) * 100 >= rule.percent;
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Emojis in a message: custom ones plus normal ones (a family or a flag counts as one). */
export function countEmojis(text: string): number {
  const custom = text.match(/<a?:\w+:\d+>/g)?.length ?? 0;
  let normal = 0;
  for (const { segment } of graphemes.segment(text.replace(/<a?:\w+:\d+>/g, " "))) {
    if (PICTOGRAPH.test(segment)) normal++;
  }
  return custom + normal;
}

/**
 * Zalgo stacks many combining accent marks on one letter. Real languages use at most two of these
 * on a letter (Vietnamese, for example), so three or more on any single letter counts as zalgo.
 * Only the general-purpose combining blocks are counted, so scripts like Thai or Hindi are never caught.
 */
const ZALGO_MARK = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/gu;

export function isZalgo(text: string): boolean {
  for (const { segment } of graphemes.segment(text)) {
    if (segment.length > 3 && (segment.match(ZALGO_MARK)?.length ?? 0) >= 3) return true;
  }
  return false;
}

/**
 * A fingerprint of a message's text, so repeats can be spotted without keeping what people wrote.
 * Case, spacing and trailing punctuation are ignored, so "hi!!" and "HI" count as the same message.
 */
export function fingerprint(text: string): string | null {
  const normal = text.toLowerCase().replace(/\s+/g, " ").replace(/[!?.~]+$/, "").trim();
  if (!normal) return null;
  return createHash("sha256").update(normal).digest("base64url").slice(0, 16);
}

interface Recent {
  print: string;
  at: number;
  channelId: string;
  messageId: string;
}

/** Each member's recent message fingerprints, per server. Kept in memory only, for at most 10 minutes. */
const recent = new Map<string, Recent[]>();
const MAX_KEPT = 30;
const MAX_AGE_MS = 10 * 60_000;

/**
 * Records a message and returns the earlier copies of it (plus this one) when the member has now
 * posted it `count` times within `seconds`. Returns null when it's not (yet) spam.
 */
export function trackRepeat(
  guildId: string,
  userId: string,
  msg: { content: string; channelId: string; id: string; createdTimestamp: number },
  rule: AutomodSettings["repeated"],
): { channelId: string; messageId: string }[] | null {
  const print = fingerprint(msg.content);
  if (!print) return null;
  const key = `${guildId}:${userId}`;
  const since = msg.createdTimestamp - rule.seconds * 1000;
  const list = (recent.get(key) ?? []).filter((r) => r.at >= msg.createdTimestamp - MAX_AGE_MS);
  list.push({ print, at: msg.createdTimestamp, channelId: msg.channelId, messageId: msg.id });
  recent.set(key, list.slice(-MAX_KEPT));
  const copies = list.filter((r) => r.print === print && r.at >= since);
  if (copies.length < rule.count) return null;
  // Start counting again, so the next copy doesn't immediately trigger again on the same old messages.
  recent.set(
    key,
    list.filter((r) => !copies.includes(r)),
  );
  return copies.map((c) => ({ channelId: c.channelId, messageId: c.messageId }));
}

/** Drops members who haven't posted for a while. */
export function sweepRepeats(now = Date.now()) {
  for (const [key, list] of recent) {
    const kept = list.filter((r) => r.at >= now - MAX_AGE_MS);
    if (kept.length) recent.set(key, kept);
    else recent.delete(key);
  }
}

/** Forgets a server's tracked messages (feature switched off). */
export function forgetGuild(guildId: string) {
  for (const key of recent.keys()) if (key.startsWith(`${guildId}:`)) recent.delete(key);
  for (const map of [bursts, flagged]) {
    for (const key of map.keys()) if (key.split(":")[1] === guildId) map.delete(key);
  }
}

/* ------------------------------------------------------------ anti-spam bursts */

export type BurstKind = "rate" | "attachments" | "linkSpam";

interface BurstEntry {
  at: number;
  /** How much this message counts: 1 for a message, or its number of files or links. */
  weight: number;
  channelId: string;
  messageId: string;
}

/** Each member's recent messages per anti-spam filter. Only IDs and times, kept for at most 2 minutes. */
const bursts = new Map<string, BurstEntry[]>();
/**
 * Members caught recently, until when. While flagged, every new message for that filter is deleted
 * straight away, so a spammer doesn't get another free burst before the limit is reached again.
 */
const flagged = new Map<string, number>();
const BURST_MAX_AGE_MS = 2 * 60_000;
const BURST_MAX_KEPT = 60;

/** Links in a message (each http/https address counts once). */
export const countLinks = (text: string) => text.match(/https?:\/\/[^\s<>]+/gi)?.length ?? 0;

/**
 * Records a message for one anti-spam filter and says which messages to delete if the member went over the limit.
 * - `weight`: how much the message counts (0 means it doesn't count, e.g. no links for the link filter)
 * - `limit`: total weight allowed within `seconds`; reaching more than that is spam
 * - `channels`: optionally, posting in this many different channels within `seconds` is spam too
 * Returns null when it's not spam.
 */
export function trackBurst(
  kind: BurstKind,
  guildId: string,
  userId: string,
  msg: { channelId: string; id: string; createdTimestamp: number },
  rule: { weight: number; limit: number; seconds: number; channels?: number },
): { channelId: string; messageId: string }[] | null {
  if (rule.weight <= 0) return null;
  const key = `${kind}:${guildId}:${userId}`;
  const now = msg.createdTimestamp;
  const self = { channelId: msg.channelId, messageId: msg.id };

  // Still flagged from a moment ago: delete and keep them flagged while they carry on.
  const until = flagged.get(key) ?? 0;
  if (until > now) {
    flagged.set(key, now + rule.seconds * 1000);
    return [self];
  }

  const since = now - rule.seconds * 1000;
  const list = (bursts.get(key) ?? []).filter((e) => e.at >= since);
  list.push({ at: now, weight: rule.weight, channelId: msg.channelId, messageId: msg.id });
  bursts.set(key, list.slice(-BURST_MAX_KEPT));

  const total = list.reduce((sum, e) => sum + e.weight, 0);
  const spread = new Set(list.map((e) => e.channelId)).size;
  const tooMany = total > rule.limit;
  const tooSpread = Boolean(rule.channels) && spread >= rule.channels!;
  if (!tooMany && !tooSpread) return null;

  bursts.delete(key);
  flagged.set(key, now + rule.seconds * 1000);
  return list.map((e) => ({ channelId: e.channelId, messageId: e.messageId }));
}

/** Drops old burst records and expired flags. */
export function sweepBursts(now = Date.now()) {
  for (const [key, list] of bursts) {
    const kept = list.filter((e) => e.at >= now - BURST_MAX_AGE_MS);
    if (kept.length) bursts.set(key, kept);
    else bursts.delete(key);
  }
  for (const [key, until] of flagged) if (until <= now) flagged.delete(key);
}
