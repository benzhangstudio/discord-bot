import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { features } from "../../features/index.js";
import { config, dashboardLink } from "../config.js";
import { isFeatureEnabled } from "../settings.js";
import type { BotFeature, SlashCommand } from "./types.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: enable "Server Members Intent" in the Developer Portal
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildMember],
});

const commands = new Map<string, { command: SlashCommand; feature: BotFeature }>();
for (const feature of features) {
  for (const command of feature.commands ?? []) {
    if (commands.has(command.data.name)) throw new Error(`Duplicate command name: /${command.data.name}`);
    commands.set(command.data.name, { command, feature });
  }
}

async function registerCommands() {
  const body = [...commands.values()].map(({ command }) => command.data.toJSON());
  if (config.devGuildId) {
    await client.application!.commands.set(body, config.devGuildId);
    console.log(`[bot] registered ${body.length} commands in dev server ${config.devGuildId}`);
  } else {
    await client.application!.commands.set(body);
    console.log(`[bot] registered ${body.length} global commands`);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag} in ${c.guilds.cache.size} servers`);
  await registerCommands().catch((err) => console.error("[bot] command registration failed:", err));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const entry = commands.get(interaction.commandName);
  if (!entry) return;

  const reply = (content: string) =>
    interaction.replied || interaction.deferred
      ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
      : interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (interaction.guildId && !(await isFeatureEnabled(interaction.guildId, entry.feature.info))) {
    const link = dashboardLink(`/servers/${interaction.guildId}`);
    await reply(
      `**${entry.feature.info.name}** is turned off in this server. An admin can turn it on in the dashboard${link ? `: ${link}` : "."}`,
    );
    return;
  }

  try {
    await entry.command.execute(interaction);
  } catch (err) {
    console.error(`[bot] /${interaction.commandName} failed:`, err);
    await reply("Something went wrong running that command.").catch(() => {});
  }
});

for (const feature of features) {
  for (const { event, handle } of feature.events ?? []) {
    client.on(event, async (...args) => {
      try {
        await (handle as (...a: unknown[]) => unknown)(...args);
      } catch (err) {
        console.error(`[bot] ${feature.info.id} ${event} handler failed:`, err);
      }
    });
  }
}

export async function startBot() {
  for (const feature of features) feature.setup?.(client);
  await client.login(config.token);
}
