import {
  type Client,
  Events,
  type GuildMember,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  RESTJSONErrorCodes,
  type User,
} from "discord.js";
import { onEvent } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { reactionRolesFeature } from "../../shared/features.js";
import { reactionKey } from "./emoji.js";
import { isDiscordError, roleProblem, syncMessage } from "./message.js";
import * as store from "./store.js";

const log = (...args: unknown[]) => console.warn("[reaction-roles]", ...args);

/** Common lookup for both reaction events. Works on old messages the bot hasn't cached. */
async function resolve(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
  if (!reaction.message.guildId || user.id === reaction.client.user.id) return;
  const config = await store.getConfig(reaction.message.id);
  if (!config) return;
  if (!(await isFeatureEnabled(config.guildId, reactionRolesFeature))) return;

  const entry = config.entries.find((e) => e.emojiKey === reactionKey(reaction.emoji));
  if (!entry) return;

  const guild = reaction.client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member || member.user.bot) return; // ignore bots, and people who already left

  const problem = roleProblem(guild, entry.roleId);
  if (problem) {
    if (!guild.roles.cache.has(entry.roleId)) {
      // The role was deleted: drop it from the message so members aren't left confused.
      await store.removeEntry(config.messageId, entry.emojiKey);
      await syncMessage(reaction.client, (await store.getConfig(config.messageId))!).catch(() => {});
    } else {
      log(`can't manage role ${entry.roleId} in ${guild.name} (${guild.id}): ${problem}`);
    }
    return;
  }
  return { config, entry, member, guild };
}

function explainRoleError(err: unknown, member: GuildMember, roleId: string) {
  if (isDiscordError(err, RESTJSONErrorCodes.MissingPermissions)) {
    log(`missing permission to change role ${roleId} for ${member.id} in ${member.guild.name} (${member.guild.id})`);
  } else if (!isDiscordError(err, RESTJSONErrorCodes.UnknownRole, RESTJSONErrorCodes.UnknownMember)) {
    log("role update failed:", err);
  }
}

const reactionAdded = onEvent(Events.MessageReactionAdd, async (reaction, user) => {
  const found = await resolve(reaction, user);
  if (!found) return;
  const { config, entry, member } = found;

  if (config.singleChoice) {
    // Single choice: swap out any other role from this message, and clear the member's other reactions.
    const others = config.entries.filter((e) => e.emojiKey !== entry.emojiKey);
    const toRemove = others.map((e) => e.roleId).filter((id) => member.roles.cache.has(id));
    if (toRemove.length) await member.roles.remove(toRemove, "Reaction roles: single choice").catch((e) => explainRoleError(e, member, toRemove[0]));

    const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    for (const other of others) {
      const r = message?.reactions.cache.find((x) => reactionKey(x.emoji) === other.emojiKey);
      if (r && r.count > 1) await r.users.remove(member.id).catch(() => {});
    }
  }

  if (!member.roles.cache.has(entry.roleId)) {
    await member.roles.add(entry.roleId, "Reaction roles").catch((e) => explainRoleError(e, member, entry.roleId));
  }
});

const reactionRemoved = onEvent(Events.MessageReactionRemove, async (reaction, user) => {
  const found = await resolve(reaction, user);
  if (!found) return;
  const { entry, member } = found;
  if (member.roles.cache.has(entry.roleId)) {
    await member.roles.remove(entry.roleId, "Reaction roles").catch((e) => explainRoleError(e, member, entry.roleId));
  }
});

/** If a moderator clears reactions from the message, put the bot's reactions back. */
async function restoreReactions(client: Client, messageId: string) {
  const config = await store.getConfig(messageId);
  if (!config || !(await isFeatureEnabled(config.guildId, reactionRolesFeature))) return;
  await syncMessage(client, config).catch(() => {});
}

const allReactionsCleared = onEvent(Events.MessageReactionRemoveAll, (message) => restoreReactions(message.client, message.id));
const emojiCleared = onEvent(Events.MessageReactionRemoveEmoji, (reaction) => restoreReactions(reaction.client, reaction.message.id));

// Clean up saved setups when their message, channel or role disappears.
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (await store.getConfig(message.id)) await store.deleteMessage(message.id);
});

const messagesBulkDeleted = onEvent(Events.MessageBulkDelete, async (messages) => {
  for (const id of messages.keys()) if (await store.getConfig(id)) await store.deleteMessage(id);
});

const channelDeleted = onEvent(Events.ChannelDelete, async (channel) => {
  await store.deleteMessagesInChannel(channel.id);
});

const roleDeleted = onEvent(Events.GuildRoleDelete, async (role) => {
  const affected = await store.removeRoleEverywhere(role.id);
  for (const messageId of affected) {
    const config = await store.getConfig(messageId);
    if (config) await syncMessage(role.client, config).catch(() => {});
  }
});

export const reactionRoleEvents = [
  reactionAdded,
  reactionRemoved,
  allReactionsCleared,
  emojiCleared,
  messageDeleted,
  messagesBulkDeleted,
  channelDeleted,
  roleDeleted,
];
