import { Events, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { coreFeature } from "../../shared/features.js";
import type { BotFeature } from "../../server/bot/types.js";
import { dashboardLink } from "../../server/config.js";
import { startGuildDataCleanup } from "../../server/guildData.js";
import { guildAdded, guildRemoved } from "./cleanup.js";
import { setupCommand, setupComponents, welcomeOnJoin } from "./setup.js";

export const core: BotFeature = {
  info: coreFeature,
  components: [setupComponents],
  events: [welcomeOnJoin, guildAdded, guildRemoved],
  setup(client) {
    // Deletes data of servers the bot left more than 30 days ago (needs the server list, so waits for login).
    client.once(Events.ClientReady, () => startGuildDataCleanup(client));
  },
  commands: [
    setupCommand,
    {
      data: new SlashCommandBuilder().setName("ping").setDescription("Check that the bot is online and how fast it responds."),
      async execute(interaction) {
        const ws = interaction.client.ws.ping;
        await interaction.reply({
          content: `Pong! Gateway latency: ${ws >= 0 ? `${ws} ms` : "measuring..."}`,
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
        });
      },
    },
  ],
};
