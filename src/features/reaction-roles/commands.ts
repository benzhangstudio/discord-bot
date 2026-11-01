import {
  type AutocompleteInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "../../server/bot/types.js";
import { parseEmojiInput } from "./emoji.js";
import {
  buildEmbed,
  fetchConfigMessage,
  messageUrl,
  missingChannelPermissions,
  roleProblem,
  syncMessage,
} from "./message.js";
import * as store from "./store.js";

const data = new SlashCommandBuilder()
  .setName("reactionroles")
  .setDescription("Let members pick roles by reacting to a message.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setContexts(0)
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Post a new reaction-role message.")
      .addStringOption((o) => o.setName("title").setDescription("Message title, e.g. Pick your games").setRequired(true).setMaxLength(256))
      .addStringOption((o) =>
        o.setName("description").setDescription("Text under the title. Type \\n for a new line.").setMaxLength(2000),
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Where to post it (default: this channel)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      )
      .addBooleanOption((o) =>
        o.setName("single_choice").setDescription("Members can only have ONE role from this message (default: no)"),
      )
      .addStringOption((o) => o.setName("emoji").setDescription("Optional: first emoji (add more later with /reactionroles add)"))
      .addRoleOption((o) => o.setName("role").setDescription("Optional: the role that emoji gives")),
  )
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add an emoji and the role it gives to a reaction-role message.")
      .addStringOption((o) => o.setName("message").setDescription("Which reaction-role message").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("emoji").setDescription("The emoji members react with").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("The role it gives").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove an emoji from a reaction-role message.")
      .addStringOption((o) => o.setName("message").setDescription("Which reaction-role message").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("emoji").setDescription("Which emoji to remove").setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("edit")
      .setDescription("Change the title, description or single-choice setting.")
      .addStringOption((o) => o.setName("message").setDescription("Which reaction-role message").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("title").setDescription("New title").setMaxLength(256))
      .addStringOption((o) => o.setName("description").setDescription("New text. Type \\n for a new line, or - to clear it.").setMaxLength(2000))
      .addBooleanOption((o) => o.setName("single_choice").setDescription("Members can only have ONE role from this message")),
  )
  .addSubcommand((s) => s.setName("list").setDescription("Show all reaction-role messages in this server."))
  .addSubcommand((s) =>
    s
      .setName("delete")
      .setDescription("Delete a reaction-role message. Members keep the roles they already have.")
      .addStringOption((o) => o.setName("message").setDescription("Which reaction-role message").setRequired(true).setAutocomplete(true)),
  );

const multiline = (s: string) => s.replace(/\\n/g, "\n").trim();

async function reply(interaction: ChatInputCommandInteraction, content: string) {
  const payload = { content, allowedMentions: { parse: [] } };
  return interaction.deferred || interaction.replied
    ? interaction.editReply(payload)
    : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Loads the chosen message's setup, making sure it belongs to this server. */
async function chosenConfig(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getString("message", true);
  const config = await store.getConfig(id);
  return config && config.guildId === interaction.guildId ? config : undefined;
}

const NOT_FOUND = "I couldn't find that reaction-role message. Pick one from the list that appears as you type.";

function memberRank(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember;
  return { position: member.roles.highest.position, isOwner: interaction.guild!.ownerId === member.id };
}

/** Validates an emoji + role pair before anything is changed. */
function checkPair(interaction: ChatInputCommandInteraction, emojiInput: string, roleId: string, existing: store.ReactionRoleEntry[]) {
  const emoji = parseEmojiInput(emojiInput, interaction.client);
  if ("error" in emoji) return { error: emoji.error };
  const problem = roleProblem(interaction.guild!, roleId, memberRank(interaction));
  if (problem) return { error: problem };
  const sameRole = existing.find((e) => e.roleId === roleId && e.emojiKey !== emoji.key);
  if (sameRole) return { error: `<@&${roleId}> is already given by ${sameRole.emojiDisplay} on this message.` };
  if (!existing.some((e) => e.emojiKey === emoji.key) && existing.length >= store.MAX_ENTRIES) {
    return { error: `A message can have at most ${store.MAX_ENTRIES} reactions. Create another message for more roles.` };
  }
  return { emoji };
}

async function create(interaction: ChatInputCommandInteraction) {
  const channel = (interaction.options.getChannel("channel") ?? interaction.channel) as GuildTextBasedChannel | null;
  if (!channel || !("send" in channel)) return reply(interaction, "Please choose a text channel.");

  const missing = missingChannelPermissions(channel);
  if (missing.length) return reply(interaction, `I need these permissions in ${channel}: **${missing.join(", ")}**.`);

  const emojiInput = interaction.options.getString("emoji");
  const role = interaction.options.getRole("role");
  if (Boolean(emojiInput) !== Boolean(role)) {
    return reply(interaction, "To add the first role now, fill in both **emoji** and **role** (or leave both empty).");
  }
  const pair = emojiInput && role ? checkPair(interaction, emojiInput, role.id, []) : undefined;
  if (pair && "error" in pair) return reply(interaction, pair.error!);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const draft: store.ReactionRoleConfig = {
    messageId: "",
    guildId: interaction.guildId!,
    channelId: channel.id,
    title: interaction.options.getString("title", true).trim(),
    description: multiline(interaction.options.getString("description") ?? ""),
    singleChoice: interaction.options.getBoolean("single_choice") ?? false,
    createdBy: interaction.user.id,
    createdAt: new Date(),
    entries: [],
  };

  const posted = await channel.send({ embeds: [buildEmbed(draft)] });
  const { entries, ...messageRow } = { ...draft, messageId: posted.id };
  await store.createMessage(messageRow);

  let problems: string[] = [];
  if (pair?.emoji && role) {
    await store.setEntry(posted.id, pair.emoji.key, pair.emoji.display, role.id, 0);
    problems = await syncMessage(interaction.client, (await store.getConfig(posted.id))!);
  }

  const next = pair ? "Add more with `/reactionroles add`." : "Now add roles with `/reactionroles add`.";
  return reply(interaction, [`Posted in ${channel}: ${posted.url}`, next, ...problems.map((p) => `⚠️ ${p}`)].join("\n"));
}

async function add(interaction: ChatInputCommandInteraction) {
  const config = await chosenConfig(interaction);
  if (!config) return reply(interaction, NOT_FOUND);
  const role = interaction.options.getRole("role", true);
  const pair = checkPair(interaction, interaction.options.getString("emoji", true), role.id, config.entries);
  if ("error" in pair) return reply(interaction, pair.error!);
  const { emoji } = pair;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const message = await fetchConfigMessage(interaction.client, config);
  if (!message) {
    await store.deleteMessage(config.messageId);
    return reply(interaction, "That message was deleted, so I removed its setup. Create a new one with `/reactionroles create`.");
  }
  // React first: if Discord rejects the emoji, nothing gets saved.
  try {
    await message.react(emoji.customId ?? emoji.display);
  } catch {
    return reply(interaction, `I couldn't react with ${emoji.display}. Make sure it's a real emoji I can use and I have Add Reactions there.`);
  }

  const replaced = config.entries.find((e) => e.emojiKey === emoji.key);
  const position = replaced?.position ?? Math.max(-1, ...config.entries.map((e) => e.position)) + 1;
  await store.setEntry(config.messageId, emoji.key, emoji.display, role.id, position);
  const problems = await syncMessage(interaction.client, (await store.getConfig(config.messageId))!);

  const done = replaced
    ? `${emoji.display} now gives <@&${role.id}> instead of <@&${replaced.roleId}>.`
    : `${emoji.display} now gives <@&${role.id}>.`;
  return reply(interaction, [done, message.url, ...problems.map((p) => `⚠️ ${p}`)].join("\n"));
}

async function remove(interaction: ChatInputCommandInteraction) {
  const config = await chosenConfig(interaction);
  if (!config) return reply(interaction, NOT_FOUND);
  const input = interaction.options.getString("emoji", true);
  const parsed = parseEmojiInput(input, interaction.client);
  const entry = config.entries.find((e) => e.emojiKey === input || ("key" in parsed && e.emojiKey === parsed.key));
  if (!entry) return reply(interaction, "That emoji isn't on this message. Pick one from the list that appears as you type.");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await store.removeEntry(config.messageId, entry.emojiKey);
  const problems = await syncMessage(interaction.client, (await store.getConfig(config.messageId))!);
  return reply(
    interaction,
    [`Removed ${entry.emojiDisplay} (<@&${entry.roleId}>). Members who already have the role keep it.`, ...problems.map((p) => `⚠️ ${p}`)].join("\n"),
  );
}

async function edit(interaction: ChatInputCommandInteraction) {
  const config = await chosenConfig(interaction);
  if (!config) return reply(interaction, NOT_FOUND);
  const title = interaction.options.getString("title");
  const description = interaction.options.getString("description");
  const singleChoice = interaction.options.getBoolean("single_choice");
  if (title === null && description === null && singleChoice === null) {
    return reply(interaction, "Fill in at least one thing to change: **title**, **description** or **single_choice**.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await store.updateMessage(config.messageId, {
    ...(title !== null && { title: title.trim() }),
    ...(description !== null && { description: description.trim() === "-" ? "" : multiline(description) }),
    ...(singleChoice !== null && { singleChoice }),
  });
  const problems = await syncMessage(interaction.client, (await store.getConfig(config.messageId))!);
  return reply(interaction, [`Updated: ${messageUrl(config)}`, ...problems.map((p) => `⚠️ ${p}`)].join("\n"));
}

async function list(interaction: ChatInputCommandInteraction) {
  const configs = await store.listConfigs(interaction.guildId!);
  if (!configs.length) return reply(interaction, "No reaction-role messages yet. Create one with `/reactionroles create`.");
  const lines = configs.map((c) => {
    const roles = c.entries.map((e) => `${e.emojiDisplay} <@&${e.roleId}>`).join("  ") || "_no roles yet_";
    return `**${c.title}** in <#${c.channelId}>${c.singleChoice ? " · single choice" : ""}\n${roles}\n${messageUrl(c)}`;
  });
  let content = lines.join("\n\n");
  if (content.length > 1900) content = `${content.slice(0, 1900)}\n…and more. See the dashboard for the full list.`;
  return reply(interaction, content);
}

async function deleteMessageSetup(interaction: ChatInputCommandInteraction) {
  const config = await chosenConfig(interaction);
  if (!config) return reply(interaction, NOT_FOUND);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await store.deleteMessage(config.messageId);
  const message = await fetchConfigMessage(interaction.client, config).catch(() => null);
  const deleted = message ? await message.delete().then(() => true, () => false) : true;
  return reply(
    interaction,
    deleted
      ? `Deleted **${config.title}**. Members keep the roles they already have.`
      : `Stopped **${config.title}** from giving roles, but I couldn't delete the message itself. You can delete it manually.`,
  );
}

async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === "message") {
    const search = focused.value.toLowerCase();
    const configs = await store.listConfigs(interaction.guildId!);
    const choices = configs
      .map((c) => {
        const channel = interaction.guild?.channels.cache.get(c.channelId);
        return { name: `${c.title} (#${channel?.name ?? "deleted-channel"})`.slice(0, 100), value: c.messageId };
      })
      .filter((c) => c.name.toLowerCase().includes(search))
      .slice(0, 25);
    return interaction.respond(choices);
  }
  if (focused.name === "emoji") {
    const config = await store.getConfig(interaction.options.getString("message") ?? "");
    if (!config || config.guildId !== interaction.guildId) return interaction.respond([]);
    const choices = config.entries.map((e) => {
      const emojiName = e.emojiDisplay.match(/^<a?:(\w+):\d+>$/)?.[1];
      const role = interaction.guild?.roles.cache.get(e.roleId);
      return { name: `${emojiName ? `:${emojiName}:` : e.emojiDisplay} → @${role?.name ?? "deleted role"}`.slice(0, 100), value: e.emojiKey };
    });
    return interaction.respond(choices.slice(0, 25));
  }
  return interaction.respond([]);
}

export const reactionRolesCommand: SlashCommand = {
  data,
  autocomplete,
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) return reply(interaction, "This command only works in a server.");
    switch (interaction.options.getSubcommand()) {
      case "create":
        return create(interaction);
      case "add":
        return add(interaction);
      case "remove":
        return remove(interaction);
      case "edit":
        return edit(interaction);
      case "list":
        return list(interaction);
      case "delete":
        return deleteMessageSetup(interaction);
    }
  },
};
