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
}
