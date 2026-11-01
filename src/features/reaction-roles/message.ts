import {
  type Client,
  DiscordAPIError,
  EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import { reactionKey } from "./emoji.js";
import type { ReactionRoleConfig } from "./store.js";

export const BRAND_PINK = 0xff4fa3;

/** Permissions the bot needs in the channel to run a reaction-role message. */
export const CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ReadMessageHistory,
] as const;

const PERMISSION_NAMES: Record<string, string> = {
  [String(PermissionFlagsBits.ViewChannel)]: "View Channel",
  [String(PermissionFlagsBits.SendMessages)]: "Send Messages",
  [String(PermissionFlagsBits.EmbedLinks)]: "Embed Links",
  [String(PermissionFlagsBits.AddReactions)]: "Add Reactions",
  [String(PermissionFlagsBits.ReadMessageHistory)]: "Read Message History",
};

/** Lists the channel permissions the bot is missing, in plain words (empty when all is well). */
export function missingChannelPermissions(channel: GuildTextBasedChannel): string[] {
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  return CHANNEL_PERMISSIONS.filter((p) => !perms?.has(p)).map((p) => PERMISSION_NAMES[String(p)]);
}

/**
 * What's stopping a saved message from working right now (missing channel, missing permissions,
 * roles the bot can't give), in plain words for the dashboard. Uses only cached data, so it's instant.
 */
export function configProblems(guild: Guild, config: ReactionRoleConfig): string[] {
  const problems: string[] = [];
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel || !channel.isTextBased() || channel.isThread()) {
    problems.push("Its channel was deleted. Edit it and pick a new channel to post it again.");
    return problems;
  }
  const missing = missingChannelPermissions(channel as GuildTextBasedChannel);
  if (missing.length) problems.push(`I'm missing ${missing.join(", ")} in #${channel.name}.`);
  for (const entry of config.entries) {
    const problem = roleProblem(guild, entry.roleId);
    if (problem) problems.push(`${entry.emojiDisplay}: ${problem.replace(/\*\*/g, "")}`);
  }
  return [...new Set(problems)];
}

export function buildEmbed(config: ReactionRoleConfig) {
  const lines = config.entries.map((e) => `${e.emojiDisplay}  <@&${e.roleId}>`);
  const body = [config.description, lines.join("\n")].filter(Boolean).join("\n\n");
  return new EmbedBuilder()
    .setColor(BRAND_PINK)
    .setTitle(config.title)
    .setDescription(body || "Roles will appear here soon.")
    .setFooter({
      text: config.singleChoice
        ? "Pick one: react to get a role. Choosing another swaps it."
        : "React to get a role. Remove your reaction to remove it.",
    });
}

export const messageUrl = (c: Pick<ReactionRoleConfig, "guildId" | "channelId" | "messageId">) =>
  `https://discord.com/channels/${c.guildId}/${c.channelId}/${c.messageId}`;

export const isDiscordError = (err: unknown, ...codes: number[]) =>
  err instanceof DiscordAPIError && codes.includes(err.code as number);

/** Finds the posted message, or null if it (or its channel) no longer exists. */
export async function fetchConfigMessage(client: Client, config: ReactionRoleConfig): Promise<Message | null> {
  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
  return channel.messages.fetch(config.messageId).catch((err) => {
    if (isDiscordError(err, RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel)) return null;
    throw err;
  });
}

/**
 * Brings the Discord message in line with the saved setup: refreshes the embed,
 * adds any missing reactions and removes the bot's reactions for emojis no longer used.
 * Returns problems to show the admin (empty when everything worked).
 */
export async function syncMessage(client: Client, config: ReactionRoleConfig): Promise<string[]> {
  const problems: string[] = [];
  const message = await fetchConfigMessage(client, config);
  if (!message) return ["The reaction-role message no longer exists."];

  await message.edit({ embeds: [buildEmbed(config)] }).catch(() => problems.push("I couldn't update the message text."));

  const wanted = new Set(config.entries.map((e) => e.emojiKey));
  for (const reaction of message.reactions.cache.values()) {
    if (reaction.me && !wanted.has(reactionKey(reaction.emoji))) {
      await reaction.users.remove(client.user!.id).catch(() => {});
    }
  }
  for (const entry of config.entries) {
    const existing = message.reactions.cache.find((r) => reactionKey(r.emoji) === entry.emojiKey);
    if (existing?.me) continue;
    try {
      await message.react(entry.emojiDisplay);
    } catch (err) {
      problems.push(
        isDiscordError(err, RESTJSONErrorCodes.UnknownEmoji)
          ? `${entry.emojiDisplay} can't be used as a reaction (it may have been deleted).`
          : `I couldn't add the ${entry.emojiDisplay} reaction. Check I have Add Reactions in that channel.`,
      );
    }
  }
  return problems;
}

import { roleProblem } from "../../server/bot/roles.js";
export { roleProblem };
