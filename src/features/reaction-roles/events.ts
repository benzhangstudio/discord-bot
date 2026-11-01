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
  // The guild check keeps every server's setups separate, whatever happens to message IDs.
  if (!config || config.guildId !== reaction.message.guildId) return;
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

/**
 * Runs one member's role changes one at a time. When someone clicks several reactions quickly
 * (or in many servers at once), each change sees the result of the one before it, so
 * single-choice messages never end up giving two roles.
 */
const queues = new Map<string, Promise<unknown>>();
function inOrder(key: string, task: () => Promise<unknown>) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

const reactionAdded = onEvent(Events.MessageReactionAdd, (reaction, user) =>
  inOrder(`${reaction.message.guildId}:${user.id}`, async () => {
    const found = await resolve(reaction, user);
    if (!found) return;
    const { config, entry, guild } = found;
    let { member } = found;

    if (config.singleChoice) {
      // Single choice: swap any other role from this message for the new one in a single change.
      // Fresh member data is used so a click a moment ago is always taken into account.
      member = (await guild.members.fetch({ user: member.id, force: true }).catch(() => null)) ?? member;
      const others = new Set(config.entries.filter((e) => e.emojiKey !== entry.emojiKey).map((e) => e.roleId));
      const current = [...member.roles.cache.keys()].filter((id) => id !== guild.id);
      const next = [...current.filter((id) => !others.has(id)), ...(current.includes(entry.roleId) ? [] : [entry.roleId])];
      if (next.length !== current.length || current.some((id) => others.has(id))) {
        await member.roles.set(next, "Reaction roles: single choice").catch((e) => explainRoleError(e, member, entry.roleId));
      }

      // Clear the member's other reactions on the message so it matches their role.
      const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
      for (const other of config.entries) {
        if (other.emojiKey === entry.emojiKey) continue;
        const r = message?.reactions.cache.find((x) => reactionKey(x.emoji) === other.emojiKey);
        if (r && r.count > 1) await r.users.remove(member.id).catch(() => {});
      }
      return;
    }

    // Adding a role someone already has is harmless, and skipping the check avoids acting on stale data.
    await member.roles.add(entry.roleId, "Reaction roles").catch((e) => explainRoleError(e, member, entry.roleId));
  }),
);

const reactionRemoved = onEvent(Events.MessageReactionRemove, (reaction, user) =>
  inOrder(`${reaction.message.guildId}:${user.id}`, async () => {
    const found = await resolve(reaction, user);
    if (!found) return;
    const { entry, member } = found;
    await member.roles.remove(entry.roleId, "Reaction roles").catch((e) => explainRoleError(e, member, entry.roleId));
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
