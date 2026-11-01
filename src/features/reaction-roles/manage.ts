import { ChannelType, type Client, type Guild, type GuildTextBasedChannel } from "discord.js";
import { MAX_REACTION_ROLE_MESSAGES, type ReactionRoleInput } from "../../shared/features.js";
import { parseEmojiInput } from "./emoji.js";
import { buildMessage, fetchConfigMessage, missingChannelPermissions, roleProblem, syncMessage } from "./message.js";
import * as store from "./store.js";

/** A problem the admin can fix, shown as-is in the dashboard. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message.replace(/\*\*/g, "")); // drop Discord bold markers; this text is shown on a web page
  }
}

/** Checks every row (emoji, role, label) and returns them ready to save. */
async function checkEntries(guild: Guild, userId: string, input: ReactionRoleInput) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new SetupError("You're no longer a member of this server.");
  const rank = { position: member.roles.highest.position, isOwner: guild.ownerId === member.id };
  const reactions = input.kind === "reactions";

  const seenEmojis = new Set<string>();
  const seenRoles = new Set<string>();
  return input.entries.map((entry, i) => {
    const row = `Row ${i + 1}`;
    const problem = roleProblem(guild, entry.roleId, rank);
    if (problem) throw new SetupError(`${row}: ${problem}`);
    if (seenRoles.has(entry.roleId)) throw new SetupError(`${row}: that role is already on this message.`);
    seenRoles.add(entry.roleId);

    let emojiKey = `role:${entry.roleId}`; // buttons and menus are matched by role, so the emoji is optional
    let emojiDisplay = "";
    if (entry.emoji) {
      const emoji = parseEmojiInput(entry.emoji, guild);
      if ("error" in emoji) throw new SetupError(`${row}: ${emoji.error}`);
      emojiDisplay = emoji.display;
      if (reactions) {
        if (seenEmojis.has(emoji.key)) throw new SetupError(`${row}: ${emoji.display} is used twice. Each emoji can only give one role.`);
        seenEmojis.add(emoji.key);
        emojiKey = emoji.key;
      }
    } else if (reactions) {
      throw new SetupError(`${row}: pick an emoji.`);
    }
    return {
      emojiKey,
      emojiDisplay,
      roleId: entry.roleId,
      position: i,
      label: entry.label,
      description: input.kind === "dropdown" ? entry.description : "",
      style: entry.style,
    };
  });
}

/** Restriction lists only keep roles that still exist. */
const existingRoles = (guild: Guild, ids: string[]) => [...new Set(ids)].filter((id) => guild.roles.cache.has(id) && id !== guild.id);

/** The message-level fields to save, from the dashboard's input. */
function messageFields(guild: Guild, input: ReactionRoleInput) {
  const { title, description, ...embed } = input.embed;
  return {
    name: input.name,
    kind: input.kind,
    mode: input.mode,
    content: input.content.trim(),
    title,
    description: description.trim(),
    singleChoice: input.mode === "unique",
    options: {
      embed: { ...embed, title: "", description: "" },
      placeholder: input.placeholder,
      maxRoles: input.mode === "normal" || input.mode === "binding" ? input.maxRoles : 0,
      allowedRoles: existingRoles(guild, input.allowedRoles),
      ignoredRoles: existingRoles(guild, input.ignoredRoles),
      removeReaction: input.kind === "reactions" && input.removeReaction,
      confirm: input.confirm,
    },
  };
}

function textChannel(guild: Guild, input: ReactionRoleInput): GuildTextBasedChannel {
  const channel = guild.channels.cache.get(input.channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new SetupError("Pick a text channel.");
  }
  const missing = missingChannelPermissions(channel, {
    kind: input.kind,
    mode: input.mode,
    options: { embed: { enabled: input.embed.enabled } } as never,
  });
  if (missing.length) throw new SetupError(`I need these permissions in #${channel.name}: ${missing.join(", ")}.`);
  return channel;
}

async function saveEntries(messageId: string, entries: Awaited<ReturnType<typeof checkEntries>>) {
  const existing = (await store.getConfig(messageId))?.entries ?? [];
  for (const old of existing) {
    if (!entries.some((e) => e.emojiKey === old.emojiKey)) await store.removeEntry(messageId, old.emojiKey);
  }
  for (const e of entries) await store.setEntry({ messageId, ...e });
}

/** Posts a new reaction-role message and saves it. Returns warnings to show (empty when all went well). */
export async function createFromDashboard(client: Client, guild: Guild, userId: string, input: ReactionRoleInput, replacing = false) {
  if (!replacing && (await store.countConfigs(guild.id)) >= MAX_REACTION_ROLE_MESSAGES) {
    throw new SetupError(`A server can have up to ${MAX_REACTION_ROLE_MESSAGES} reaction-role messages. Delete one you no longer use first.`);
  }
  const channel = textChannel(guild, input);
  const entries = await checkEntries(guild, userId, input);
  const fields = messageFields(guild, input);
  const base = { guildId: guild.id, channelId: channel.id, createdBy: userId, createdAt: new Date(), ...fields };

  // Post the finished message straight away (sync then adds reactions if needed).
  const draft = store.toConfig({ ...base, messageId: "" }, entries.map((e) => ({ messageId: "", ...e })));
  const posted = await channel.send(buildMessage(guild, draft)).catch((err) => {
    console.warn("[reaction-roles] post failed:", err?.message ?? err);
    throw new SetupError(`I couldn't post in #${channel.name}. Check my permissions there, and that any image links work.`);
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
  const entries = await checkEntries(guild, userId, input);

  const message = await fetchConfigMessage(client, config);
  if (!message || input.channelId !== config.channelId) {
    // Gone from Discord, or moving channels: post a fresh copy and retire the old one.
    const created = await createFromDashboard(client, guild, userId, input, true);
    await store.deleteMessage(config.messageId);
    await message?.delete().catch(() => {});
    return created;
  }

  textChannel(guild, input); // permissions can depend on the new kind / embed setting
  await store.updateMessage(messageId, messageFields(guild, input));
  await saveEntries(messageId, entries);
  const warnings = await syncMessage(client, (await store.getConfig(messageId))!);
  return { messageId, warnings };
}
