import {
  type Client,
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { onEvent } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { reactionRolesFeature } from "../../shared/features.js";
import { reactionKey } from "./emoji.js";
import { choose, inOrder, toggle } from "./apply.js";
import { roleProblem, syncMessage } from "./message.js";
import * as store from "./store.js";

const log = (...args: unknown[]) => console.warn("[reaction-roles]", ...args);

/** Common lookup for both reaction events. Works on old messages the bot hasn't cached. */
async function resolve(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
  if (!reaction.message.guildId || user.id === reaction.client.user.id) return;
  const config = await store.getConfig(reaction.message.id);
  // The guild check keeps every server's setups separate, whatever happens to message IDs.
  if (!config || config.kind !== "reactions" || config.guildId !== reaction.message.guildId) return;
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

/** Takes one member's reaction off the message (used when a choice was refused or reactions clear after use). */
async function removeUserReaction(reaction: MessageReaction | PartialMessageReaction, userId: string) {
  await reaction.users.remove(userId).catch(() => {});
}

const reactionAdded = onEvent(Events.MessageReactionAdd, (reaction, user) =>
  inOrder(reaction.message.guildId ?? "dm", user.id, async () => {
    const found = await resolve(reaction, user);
    if (!found) return;
    const { config, entry, member } = found;

    if (config.options.removeReaction) {
      // Reactions clear after use, so each reaction toggles the role (like a button).
      await toggle(member, config, entry);
      await removeUserReaction(reaction, member.id);
      return;
    }

    const outcome = await choose(member, config, entry, true);
    if (outcome.denied) {
      // Nothing changed: take the reaction off so it matches the member's roles.
      await removeUserReaction(reaction, member.id);
      return;
    }

    if (config.mode === "unique") {
      // One only: clear the member's other reactions on the message so they match their role.
      const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
      for (const other of config.entries) {
        if (other.emojiKey === entry.emojiKey) continue;
        const r = message?.reactions.cache.find((x) => reactionKey(x.emoji) === other.emojiKey);
        if (r && r.count > 1) await r.users.remove(member.id).catch(() => {});
      }
    }
  }),
);

const reactionRemoved = onEvent(Events.MessageReactionRemove, (reaction, user) =>
  inOrder(reaction.message.guildId ?? "dm", user.id, async () => {
    const found = await resolve(reaction, user);
    // When reactions clear after use, removing one is the bot's own tidy-up, not a choice.
    if (!found || found.config.options.removeReaction) return;
    await choose(found.member, found.config, found.entry, false);
  }),
);

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
  await store.clearTimersForRole(role.id);
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
