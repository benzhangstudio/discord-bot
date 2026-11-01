import type { Client, Emoji } from "discord.js";

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
 * Reads what an admin typed in the emoji box.
 * Accepts a Unicode emoji (😀), a custom emoji (<:name:123>), or a custom emoji's name or ID
 * from a server the bot is in.
 */
export function parseEmojiInput(input: string, client: Client): ParsedEmoji | { error: string } {
  const text = input.trim();

  const custom = text.match(CUSTOM_EMOJI);
  if (custom) {
    const [, animated, name, id] = custom;
    if (!client.emojis.cache.has(id)) {
      return { error: `I can't use ${text} because I'm not in the server it comes from. Use an emoji from this server instead.` };
    }
    return { key: id, display: `<${animated}:${name}:${id}>`, customId: id };
  }

  // Bare name (":wave_custom:" or "wave_custom") or ID of a custom emoji the bot can see.
  const bare = text.replace(/^:|:$/g, "");
  const found = /^\d{17,20}$/.test(bare)
    ? client.emojis.cache.get(bare)
    : client.emojis.cache.find((e) => e.name === bare);
  if (found) return { key: found.id, display: found.toString(), customId: found.id };

  if (UNICODE_EMOJI.test(text) && [...text].length <= 12) {
    return { key: normalizeUnicode(text), display: text };
  }
  return { error: `"${text}" isn't an emoji I can use. Pick one from the emoji menu, like 🎮 or a custom server emoji.` };
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
