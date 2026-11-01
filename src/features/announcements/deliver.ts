import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
  PermissionFlagsBits,
} from "discord.js";
import { client } from "../../server/bot/discord.js";
import { getFeatureState } from "../../server/settings.js";
import {
  type AnnouncementSettings,
  type AnnouncementTypeId,
  type DeliveryOutcome,
  PINGING_TYPES,
  announcementTypes,
} from "../../shared/announcements.js";
import { announcementsFeature } from "../../shared/features.js";
import { welcomeChannel } from "../core/setup.js";
import * as store from "./store.js";

const PINK = 0xff4fa3;
const SEND_GAP_MS = 350; // be gentle with Discord when posting to many servers
const POST_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

export const typeInfo = (id: string) => announcementTypes.find((t) => t.id === id) ?? announcementTypes[3];

/** Security, maintenance and downtime notices still reach servers that never picked a channel. */
const isUrgent = (type: AnnouncementTypeId) => PINGING_TYPES.includes(type);

interface Message {
  type: AnnouncementTypeId;
  title: string;
  body: string;
  url: string;
  createdAt: Date;
}

export interface Plan {
  outcome: DeliveryOutcome;
  settings: AnnouncementSettings;
}

/** Decides what should happen for one server without sending anything. */
export async function planFor(guild: Guild, type: AnnouncementTypeId): Promise<Plan> {
  const state = await getFeatureState(guild.id, announcementsFeature);
  const settings = state.settings as AnnouncementSettings;
  if (await store.isExplicitlyOff(guild.id, announcementsFeature.id)) return { outcome: "skipped-off", settings };
  // Security notices can't be switched off per type; the other kinds can.
  if (type !== "security" && settings[type] === false) return { outcome: "skipped-type", settings };
  if (settings.channelId) return { outcome: "channel", settings };
  return { outcome: isUrgent(type) ? "fallback" : "skipped-nochannel", settings };
}

function buildMessage(guild: Guild, m: Message, settings: AnnouncementSettings): MessageCreateOptions {
  const info = typeInfo(m.type);
  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle(`${info.emoji} ${m.title}`.slice(0, 256))
    .setDescription(m.body)
    .setFooter({ text: `Number One · ${info.name}` })
    .setTimestamp(m.createdAt);

  // Only urgent kinds ping, and only a role that still exists.
  const pingRole = settings.roleId && isUrgent(m.type) && guild.roles.cache.has(settings.roleId) ? settings.roleId : null;
  const options: MessageCreateOptions = {
    embeds: [embed],
    allowedMentions: { parse: [], roles: pingRole ? [pingRole] : [] },
  };
  if (pingRole) options.content = `<@&${pingRole}>`;
  if (m.url) {
    options.components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Learn more").setURL(m.url),
      ),
    ];
  }
  return options;
}

/** A plain-language reason a post failed. */
export function reasonFrom(err: unknown): string {
  if (err instanceof DiscordAPIError) {
    if (err.code === 10003 || err.code === 10004) return "The announcement channel was deleted.";
    if (err.code === 50001 || err.code === 50013) return "I don't have permission to post in the announcement channel.";
    if (err.code === 50007) return "The owner has direct messages turned off.";
  }
  return (err as Error)?.message?.slice(0, 200) || "Unknown error.";
}

/** The channel an admin picked, if the bot can post there. Otherwise a plain-language problem. */
export function chosenChannel(guild: Guild, channelId: string): { channel: GuildTextBasedChannel } | { problem: string } {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased() || channel.isThread()) return { problem: "The announcement channel was deleted." };
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me)?.has(POST_PERMISSIONS)) {
    return { problem: `I can't post in #${channel.name}. I need View Channel, Send Messages and Embed Links there.` };
  }
  return { channel: channel as GuildTextBasedChannel };
}

/** No channel set: the system channel if possible, otherwise a direct message to the server owner. */
async function sendFallback(guild: Guild, message: MessageCreateOptions) {
  const channel = welcomeChannel(guild);
  if (channel) {
    try {
      await channel.send(message);
      return;
    } catch {
      // fall through to the owner DM
    }
  }
  const owner = await guild.fetchOwner();
  // A role ping means nothing in a DM.
  await owner.send({ embeds: message.embeds, components: message.components });
}

async function deliverTo(guild: Guild, m: Message, plan: Plan): Promise<{ outcome: DeliveryOutcome; reason: string }> {
  const message = buildMessage(guild, m, plan.settings);

  if (plan.outcome === "channel") {
    const target = chosenChannel(guild, plan.settings.channelId!);
    if ("channel" in target) {
      try {
        await target.channel.send(message);
        return { outcome: "channel", reason: "" };
      } catch (err) {
        if (!isUrgent(m.type)) return { outcome: "failed", reason: reasonFrom(err) };
      }
    } else if (!isUrgent(m.type)) {
      return { outcome: "failed", reason: target.problem };
    }
    // Urgent notices don't get lost because of a broken channel setting: fall through to the fallback.
  }

  try {
    await sendFallback(guild, message);
    return { outcome: "fallback", reason: "" };
  } catch (err) {
    return { outcome: "failed", reason: reasonFrom(err) };
  }
}

const running = new Set<number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one announcement to every server, one at a time. Every server's result is saved as it
 * happens, so after a restart the remaining servers are picked up where it left off.
 */
export async function runAnnouncement(id: number) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const row = await store.getAnnouncement(id);
    if (!row || row.status === "done") return;
    const message: Message = { type: row.type as AnnouncementTypeId, title: row.title, body: row.body, url: row.url, createdAt: row.createdAt };
    const handled = await store.handledGuildIds(id);

    for (const guild of [...client.guilds.cache.values()]) {
      if (handled.has(guild.id)) continue;
      let result: { outcome: DeliveryOutcome; reason: string };
      let sent = false;
      try {
        const plan = await planFor(guild, message.type);
        if (plan.outcome === "channel" || plan.outcome === "fallback") {
          result = await deliverTo(guild, message, plan);
          sent = true;
        } else {
          result = { outcome: plan.outcome, reason: "" };
        }
      } catch (err) {
        result = { outcome: "failed", reason: reasonFrom(err) };
      }
      await store.recordDelivery(id, guild.id, result.outcome, result.reason);
      if (sent) await sleep(SEND_GAP_MS);
    }
    await store.markDone(id);
    console.log(`[announcements] #${id} finished`);
  } catch (err) {
    console.error(`[announcements] #${id} stopped early (it will resume on the next start):`, err);
  } finally {
    running.delete(id);
  }
}

/** How many servers each outcome would apply to right now. */
export async function previewAudience(type: AnnouncementTypeId) {
  const counts = store.emptyCounts();
  for (const guild of client.guilds.cache.values()) counts[(await planFor(guild, type)).outcome]++;
  return { servers: client.guilds.cache.size, counts };
}

/** Posts a sample notice in a server's chosen channel so admins can check permissions. */
export async function sendTest(guild: Guild, settings: AnnouncementSettings): Promise<string | null> {
  if (!settings.channelId) return "Choose a channel first.";
  const target = chosenChannel(guild, settings.channelId);
  if ("problem" in target) return target.problem;
  const message = buildMessage(
    guild,
    {
      type: "update",
      title: "Test announcement",
      body: "This is what announcements from Number One will look like. Security, maintenance and online/offline notices can ping your chosen role.",
      url: "",
      createdAt: new Date(),
    },
    settings,
  );
  try {
    await target.channel.send({ ...message, content: undefined });
    return null;
  } catch (err) {
    return reasonFrom(err);
  }
}
