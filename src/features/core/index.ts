import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { coreFeature } from "../../shared/features.js";
import type { BotFeature } from "../../server/bot/types.js";
import { dashboardLink } from "../../server/config.js";
import { setupCommand, setupComponents, welcomeOnJoin } from "./setup.js";

export const core: BotFeature = {
  info: coreFeature,
  components: [setupComponents],
  events: [welcomeOnJoin],
  commands: [
    setupCommand,
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
        const link = dashboardLink(`/servers/${interaction.guildId}`);
        await interaction.reply({
          content: link ? `Configure Number One here: ${link}` : "The dashboard isn't available yet.",
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
