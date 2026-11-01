import { ChannelType, type Client, type Guild, type GuildTextBasedChannel } from "discord.js";
import { MAX_REACTION_ROLE_MESSAGES, type ReactionRoleInput } from "../../shared/features.js";
import { parseEmojiInput } from "./emoji.js";
import { buildEmbed, fetchConfigMessage, missingChannelPermissions, roleProblem, syncMessage } from "./message.js";
import * as store from "./store.js";

/** A problem the admin can fix, shown as-is in the dashboard. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message.replace(/\*\*/g, "")); // drop Discord bold markers; this text is shown on a web page
  }
}

/** Checks every emoji/role pair and returns them ready to save. */
async function checkEntries(client: Client, guild: Guild, userId: string, input: ReactionRoleInput) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new SetupError("You're no longer a member of this server.");
  const rank = { position: member.roles.highest.position, isOwner: guild.ownerId === member.id };

  const seenEmojis = new Set<string>();
  const seenRoles = new Set<string>();
  return input.entries.map((entry, i) => {
    const emoji = parseEmojiInput(entry.emoji, guild);
    if ("error" in emoji) throw new SetupError(`Row ${i + 1}: ${emoji.error}`);
    const problem = roleProblem(guild, entry.roleId, rank);
    if (problem) throw new SetupError(`Row ${i + 1}: ${problem}`);
    if (seenEmojis.has(emoji.key)) throw new SetupError(`Row ${i + 1}: ${emoji.display} is used twice. Each emoji can only give one role.`);
    if (seenRoles.has(entry.roleId)) throw new SetupError(`Row ${i + 1}: that role is already given by another emoji.`);
    seenEmojis.add(emoji.key);
    seenRoles.add(entry.roleId);
    return { emojiKey: emoji.key, emojiDisplay: emoji.display, roleId: entry.roleId, position: i };
  });
}

function textChannel(guild: Guild, channelId: string): GuildTextBasedChannel {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new SetupError("Pick a text channel.");
  }
  const missing = missingChannelPermissions(channel);
  if (missing.length) throw new SetupError(`I need these permissions in #${channel.name}: ${missing.join(", ")}.`);
  return channel;
}

async function saveEntries(messageId: string, entries: Awaited<ReturnType<typeof checkEntries>>) {
  const existing = (await store.getConfig(messageId))?.entries ?? [];
  for (const old of existing) {
    if (!entries.some((e) => e.emojiKey === old.emojiKey)) await store.removeEntry(messageId, old.emojiKey);
  }
  for (const e of entries) await store.setEntry(messageId, e.emojiKey, e.emojiDisplay, e.roleId, e.position);
}

/** Posts a new reaction-role message and saves it. Returns warnings to show (empty when all went well). */
export async function createFromDashboard(client: Client, guild: Guild, userId: string, input: ReactionRoleInput, replacing = false) {
  if (!replacing && (await store.countConfigs(guild.id)) >= MAX_REACTION_ROLE_MESSAGES) {
    throw new SetupError(`A server can have up to ${MAX_REACTION_ROLE_MESSAGES} reaction-role messages. Delete one you no longer use first.`);
  }
  const channel = textChannel(guild, input.channelId);
  const entries = await checkEntries(client, guild, userId, input);
  const base = {
    guildId: guild.id,
    channelId: channel.id,
    title: input.title,
    description: input.description.trim(),
    singleChoice: input.singleChoice,
    createdBy: userId,
    createdAt: new Date(),
  };
  const posted = await channel.send({ embeds: [buildEmbed({ ...base, messageId: "", entries: [] })] }).catch(() => {
    throw new SetupError(`I couldn't post in #${channel.name}. Check my permissions there and try again.`);
  });
  try {
    await store.createMessage({ ...base, messageId: posted.id });
    await saveEntries(posted.id, entries);
  } catch (err) {
    // Don't leave a message in Discord that the bot doesn't know about.
    await store.deleteMessage(posted.id).catch(() => {});
    await posted.delete().catch(() => {});
    throw err;
  }
  const warnings = await syncMessage(client, (await store.getConfig(posted.id))!);
  return { messageId: posted.id, warnings };
}

/** Updates an existing message. Moving it to another channel reposts it there. */
export async function updateFromDashboard(client: Client, guild: Guild, userId: string, messageId: string, input: ReactionRoleInput) {
  const config = await store.getConfig(messageId);
  if (!config || config.guildId !== guild.id) throw new SetupError("That reaction-role message no longer exists.");
  const entries = await checkEntries(client, guild, userId, input);

  const message = await fetchConfigMessage(client, config);
  if (!message || input.channelId !== config.channelId) {
    // Gone from Discord, or moving channels: post a fresh copy and retire the old one.
    const created = await createFromDashboard(client, guild, userId, input, true);
    await store.deleteMessage(config.messageId);
    await message?.delete().catch(() => {});
    return created;
  }

  await store.updateMessage(messageId, {
    title: input.title,
    description: input.description.trim(),
    singleChoice: input.singleChoice,
  });
  await saveEntries(messageId, entries);
  const warnings = await syncMessage(client, (await store.getConfig(messageId))!);
  return { messageId, warnings };
}
