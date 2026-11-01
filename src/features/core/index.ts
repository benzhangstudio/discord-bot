import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { coreFeature } from "../../shared/features.js";
import type { BotFeature } from "../../server/bot/types.js";
import { config } from "../../server/config.js";

export const core: BotFeature = {
  info: coreFeature,
  commands: [
    {
      data: new SlashCommandBuilder().setName("ping").setDescription("Check that the bot is online and how fast it responds."),
      async execute(interaction) {
        const ws = interaction.client.ws.ping;
        await interaction.reply({
          content: `Pong! Gateway latency: ${ws >= 0 ? `${ws} ms` : "measuring..."}`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName("dashboard")
        .setDescription("Get the link to configure Number One for this server.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setContexts(0), // servers only
      async execute(interaction) {
        await interaction.reply({
          content: `Configure Number One here: ${config.PUBLIC_URL}/servers/${interaction.guildId}`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
