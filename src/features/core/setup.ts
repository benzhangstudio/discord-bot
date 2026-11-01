import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  type MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { type ComponentHandler, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { dashboardLink } from "../../server/config.js";
import { applySetup, getSetup, markWelcomed } from "../../server/settings.js";
import { type CategoryId, categories, categoryIds, featuresInCategory } from "../../shared/features.js";

const PINK = 0xff4fa3;
const PICK_ID = "setup:categories";
const START_ID = "setup:start";

function dashboardButton(guildId: string, label = "Open dashboard") {
  const url = dashboardLink(`/servers/${guildId}`);
  return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url) : null;
}

/** The "what will you use Number One for?" question, with the server's current answers pre-selected. */
async function setupPrompt(guildId: string) {
  const current = await getSetup(guildId);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(PICK_ID)
    .setPlaceholder("Choose everything that applies")
    .setMinValues(1)
    .setMaxValues(categories.length)
    .addOptions(
      categories.map((c) => {
        const ready = featuresInCategory(c.id).length > 0;
        return {
          label: c.name,
          value: c.id,
          emoji: c.emoji,
          description: (ready ? c.description : `${c.description} (coming soon)`).slice(0, 100),
          default: current.categories.includes(c.id),
        };
      }),
    );

  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle("What will you use Number One for?")
    .setDescription(
      "Pick everything that fits your server. I'll switch on the right features for each one, " +
        "and you can fine-tune them anytime in the dashboard.",
    );

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
  ];
  const link = dashboardButton(guildId);
  if (link) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(link));
  return { embeds: [embed], components: rows };
}

function canManage(interaction: MessageComponentInteraction) {
  return interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

const NEEDS_MANAGE = "Only people with the **Manage Server** permission can set up Number One.";

/** Saves the picks and shows what was switched on. */
async function handlePick(interaction: MessageComponentInteraction) {
  if (!interaction.isStringSelectMenu()) return;
  if (!canManage(interaction)) return interaction.reply({ content: NEEDS_MANAGE, flags: MessageFlags.Ephemeral });

  const picked = interaction.values.filter((v): v is CategoryId => (categoryIds as string[]).includes(v));
  const turnedOn = await applySetup(interaction.guildId!, picked, interaction.user.id);
  const ready = picked.flatMap((id) => featuresInCategory(id).filter((f) => f.recommended));
  const comingSoon = categories.filter((c) => picked.includes(c.id) && featuresInCategory(c.id).length === 0);

  const embed = new EmbedBuilder().setColor(PINK).setTitle("✅ You're all set");
  embed.addFields({
    name: "Switched on",
    value: ready.length
      ? ready.map((f) => `• **${f.name}**${turnedOn.includes(f) ? "" : " (already on)"}`).join("\n")
      : "Nothing yet. Your picks are coming soon.",
  });
  if (comingSoon.length) {
    embed.addFields({
      name: "Coming soon",
      value: `${comingSoon.map((c) => `${c.emoji} ${c.name}`).join("\n")}\nThese switch on automatically as soon as they're released.`,
    });
  }
  embed.setFooter({ text: "Run /setup again anytime to change your picks. Nothing you already use gets switched off." });

  const link = dashboardButton(interaction.guildId!, "Fine-tune in the dashboard");
  await interaction.update({
    embeds: [embed],
    components: link ? [new ActionRowBuilder<ButtonBuilder>().addComponents(link)] : [],
  });
}

export const setupComponents: ComponentHandler = {
  prefix: "setup",
  async handle(interaction) {
    if (interaction.customId === PICK_ID) return handlePick(interaction);
    if (interaction.customId === START_ID) {
      if (!canManage(interaction)) return interaction.reply({ content: NEEDS_MANAGE, flags: MessageFlags.Ephemeral });
      return interaction.reply(await setupPrompt(interaction.guildId!));
    }
  },
};

export const setupCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Tell Number One what your server needs and switch on the right features.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0),
  async execute(interaction) {
    if (!interaction.inGuild()) return;
    // Public, so staff can see who ran setup and what was picked.
    await interaction.reply(await setupPrompt(interaction.guildId));
  },
};

/** The first channel where the bot can post a welcome: the system channel if possible. */
function welcomeChannel(guild: Guild): GuildTextBasedChannel | undefined {
  const me = guild.members.me;
  if (!me) return;
  const canPost = (c: GuildTextBasedChannel) =>
    c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  if (guild.systemChannel && canPost(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache
    .filter((c): c is GuildTextBasedChannel & { position: number } => c.type === ChannelType.GuildText)
    .sort((a, b) => a.position - b.position)
    .find(canPost);
}

/** When added to a new server, invite the admins to run setup (once per server). */
export const welcomeOnJoin = onEvent(Events.GuildCreate, async (guild) => {
  if ((await getSetup(guild.id)).completed) return;
  const channel = welcomeChannel(guild);
  if (!channel || !(await markWelcomed(guild.id))) return;

  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle("Thanks for adding Number One!")
    .setDescription(
      "I'm an all-in-one admin bot: roles, moderation, welcomes, logs and more.\n\n" +
        "An admin can click **Set up** below (or run `/setup`) to tell me what this server needs. It takes a few seconds.",
    );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(START_ID).setStyle(ButtonStyle.Primary).setLabel("Set up"),
  );
  const link = dashboardButton(guild.id);
  if (link) buttons.addComponents(link);
  await channel.send({ embeds: [embed], components: [buttons] }).catch(() => {});
});
