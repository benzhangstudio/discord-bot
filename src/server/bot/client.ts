import { ApplicationFlags, Events, MessageFlags, Routes } from "discord.js";
import { features } from "../../features/index.js";
import { config, dashboardLink, setPublicUrl } from "../config.js";
import { isFeatureEnabled } from "../settings.js";
import { canReadMessages, client, dropMessageContent } from "./discord.js";
import type { BotFeature, ComponentHandler, SlashCommand } from "./types.js";

export { client };



const commands = new Map<string, { command: SlashCommand; feature: BotFeature }>();
for (const feature of features) {
  for (const command of feature.commands ?? []) {
    if (commands.has(command.data.name)) throw new Error(`Duplicate command name: /${command.data.name}`);
    commands.set(command.data.name, { command, feature });
  }
}

const components = new Map<string, { handler: ComponentHandler; feature: BotFeature }>();
for (const feature of features) {
  for (const handler of feature.components ?? []) components.set(handler.prefix, { handler, feature });
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

/** Finds the dashboard address from the login redirect already registered in the Discord application. */
async function detectDashboardAddress() {
  if (config.publicUrl) return;
  const app = (await client.rest.get(Routes.currentApplication())) as { redirect_uris?: string[] };
  const callback = app.redirect_uris?.find((u) => u.startsWith("https://") && u.endsWith("/auth/callback"));
  if (callback) setPublicUrl(callback.slice(0, -"/auth/callback".length), "Discord application settings");
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag} in ${c.guilds.cache.size} servers`);
  await registerCommands().catch((err) => console.error("[bot] command registration failed:", err));
  await detectDashboardAddress().catch(() => {});
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const entry = commands.get(interaction.commandName);
    if (!entry?.command.autocomplete) return;
    if (interaction.guildId && !(await isFeatureEnabled(interaction.guildId, entry.feature.info))) {
      return interaction.respond([]).catch(() => {});
    }
    await entry.command.autocomplete(interaction).catch((err) => {
      console.error(`[bot] /${interaction.commandName} suggestions failed:`, err);
      return interaction.respond([]).catch(() => {});
    });
    return;
  }
  if (interaction.isMessageComponent()) {
    const found = components.get(interaction.customId.split(":")[0]);
    if (!found) return;
    try {
      await found.handler.handle(interaction);
    } catch (err) {
      console.error(`[bot] ${interaction.customId} failed:`, err);
      const content = "Something went wrong. Please try again.";
      await (interaction.replied || interaction.deferred
        ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral })
      ).catch(() => {});
    }
    return;
  }
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

let featuresSetUp = false;

export async function startBot() {
  if (!featuresSetUp) {
    for (const feature of features) feature.setup?.(client);
    featuresSetUp = true;
  }
  await checkMessageContent();
  await client.login(config.token);
}

/** Discord application flags that mean "Message Content Intent" is turned on in the Developer Portal. */
const MESSAGE_CONTENT_FLAGS = ApplicationFlags.GatewayMessageContent | ApplicationFlags.GatewayMessageContentLimited;

/**
 * Logging in with an intent that's off in the Developer Portal fails completely, so check first.
 * When "Message Content Intent" is off, log in without it: everything else still works, and
 * auto-moderation's own filters stay paused (the dashboard explains how to fix it).
 */
async function checkMessageContent() {
  if (!canReadMessages()) return;
  client.rest.setToken(config.token);
  const app = (await client.rest.get(Routes.currentApplication()).catch(() => null)) as { flags?: number } | null;
  if (!app || ((app.flags ?? 0) & MESSAGE_CONTENT_FLAGS) !== 0) return;
  console.warn(
    '[bot] "Message Content Intent" is off in the Discord Developer Portal, so logging in without it. ' +
      "Auto-moderation's caps, emoji, zalgo and repeated-message filters are paused until it's turned on (then restart).",
  );
  dropMessageContent();
}
