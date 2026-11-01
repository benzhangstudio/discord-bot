import type { Emoji, Guild, GuildEmoji } from "discord.js";

export interface ParsedEmoji {
  /** Stable key used to match reactions: custom emoji ID or normalized Unicode. */
  key: string;
  /** What to show in messages and react with. */
  display: string;
  /** For custom emojis, the ID to react with. */
  customId?: string;
}

/** Discord sometimes includes an invisible "variation selector" in Unicode emojis; ignore it when matching. */
const normalizeUnicode = (s: string) => s.replace(/️/g, "");

const CUSTOM_EMOJI = /^<(a?):(\w{2,32}):(\d{17,20})>$/;
// Pictographs, keycaps, flags and their modifiers. Rejects plain text like "hello".
const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;

/**
 * Reads the emoji an admin picked for one server.
 * Accepts a Unicode emoji (😀), or a custom emoji from THIS server (<:name:123>, its name, or its ID).
 * Emojis from other servers are refused, so one server's setup never depends on (or reveals) another's.
 */
export function parseEmojiInput(input: string, guild: Guild): ParsedEmoji | { error: string } {
  const text = input.trim();
  const usable = (e: GuildEmoji | undefined) => (e && e.available !== false ? e : undefined);

  const custom = text.match(CUSTOM_EMOJI);
  if (custom) {
    const emoji = usable(guild.emojis.cache.get(custom[3]));
    if (!emoji) {
      return { error: `${custom[2] ? `:${custom[2]}:` : "That emoji"} isn't from this server (or was deleted). Pick one from this server or a standard emoji.` };
    }
    return { key: emoji.id, display: emoji.toString(), customId: emoji.id };
  }

  // Bare name (":wave_custom:" or "wave_custom") or ID of one of this server's emojis.
  const bare = text.replace(/^:|:$/g, "");
  const found = usable(
    /^\d{17,20}$/.test(bare) ? guild.emojis.cache.get(bare) : guild.emojis.cache.find((e) => e.name === bare),
  );
  if (found) return { key: found.id, display: found.toString(), customId: found.id };

  if (UNICODE_EMOJI.test(text) && [...text].length <= 12) {
    return { key: normalizeUnicode(text), display: text };
  }
  return { error: `"${text}" isn't an emoji I can use. Pick one from the emoji picker.` };
}

/** The matching key for an emoji on an actual reaction. */
export function reactionKey(emoji: Pick<Emoji, "id" | "name">): string {
  return emoji.id ?? normalizeUnicode(emoji.name ?? "");
}

/** Image link for a custom emoji (used by the dashboard). */
export function emojiImageUrl(display: string): string | null {
  const m = display.match(CUSTOM_EMOJI);
  return m ? `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? "gif" : "png"}?size=48` : null;
}
