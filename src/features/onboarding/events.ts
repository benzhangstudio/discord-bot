import { type Client, Events, type GuildMember } from "discord.js";
import { onEvent } from "../../server/bot/types.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";
import { flowActive } from "./flow.js";
import { hideNewChannel } from "./gate.js";
import { sendGoodbye, sendWelcome, sendWelcomeDm } from "./messages.js";
import { addRoles } from "./roles.js";
import * as store from "./store.js";

/**
 * Everything that happens when someone joins: starting roles, the "new member" role when the gate is on,
 * and the welcome message / DM. `quiet` skips messages (used when catching up after downtime).
 */
async function handleJoin(member: GuildMember, settings: OnboardingSettings, quiet = false) {
  if (member.user.bot) {
    await addRoles(member, settings.botRoles, "Onboarding: bot roles");
    return;
  }

  const gateRole = settings.gate.enabled && settings.gate.roleId ? [settings.gate.roleId] : [];
  await addRoles(member, [...settings.joinRoles, ...gateRole], "Onboarding: join roles");

  const progress = store.newProgress(member.guild.id, member.id, member.joinedAt ?? new Date());
  const welcomeNow = settings.welcome.when === "join" || !flowActive(settings);
  if (!quiet && settings.welcome.enabled && welcomeNow) {
    progress.welcomed = await sendWelcome(member, settings).catch(() => false);
  }
  if (!quiet && settings.welcome.dmEnabled) await sendWelcomeDm(member, settings);
  await store.saveProgress(progress);
}

const memberJoined = onEvent(Events.GuildMemberAdd, async (member) => {
  const settings = await store.getActiveSettings(member.guild.id);
  if (settings) await handleJoin(member, settings);
});

const memberLeft = onEvent(Events.GuildMemberRemove, async (member) => {
  const settings = await store.getActiveSettings(member.guild.id);
  if (settings?.goodbye.enabled && !member.user?.bot) await sendGoodbye(member, settings);
  // If they come back, they go through onboarding again (like Discord's own onboarding).
  await store.deleteProgress(member.guild.id, member.id);
});

const channelCreated = onEvent(Events.ChannelCreate, async (channel) => {
  const settings = await store.getActiveSettings(channel.guild.id);
  if (settings) await hideNewChannel(channel, settings);
});

const DAY = 24 * 60 * 60 * 1000;

/** After a restart: give starting roles to people who joined while the bot was offline. */
async function catchUp(client: Client) {
  for (const guildId of await store.guildsWithOnboarding()) {
    const guild = client.guilds.cache.get(guildId);
    const settings = guild && (await store.getActiveSettings(guildId));
    if (!guild || !settings) continue;
    const members = await guild.members.fetch().catch(() => null);
    if (!members) continue;
    const known = new Set((await store.joinedSince(guildId, new Date(Date.now() - DAY))).map((r) => r.userId));
    for (const member of members.values()) {
      if (member.joinedTimestamp && member.joinedTimestamp > Date.now() - DAY && !known.has(member.id)) {
        await handleJoin(member, settings, true).catch(() => {});
      }
    }
  }
}

/** Removes members who haven't finished onboarding in time (only when the server turned this on). */
async function removeUnfinished(client: Client) {
  for (const guildId of await store.guildsWithOnboarding()) {
    const guild = client.guilds.cache.get(guildId);
    const settings = guild && (await store.getActiveSettings(guildId));
    if (!guild || !settings?.gate.enabled || !settings.gate.roleId || settings.gate.kickAfterHours <= 0) continue;
    const cutoff = new Date(Date.now() - settings.gate.kickAfterHours * 60 * 60 * 1000);
    for (const row of await store.unfinishedBefore(guildId, cutoff)) {
      const member = await guild.members.fetch(row.userId).catch(() => null);
      if (!member) {
        await store.deleteProgress(guildId, row.userId);
        continue;
      }
      if (!member.roles.cache.has(settings.gate.roleId) || !member.kickable) continue;
      await member
        .kick(`Didn't finish onboarding within ${settings.gate.kickAfterHours} hours`)
        .catch((err) => console.warn("[onboarding] couldn't remove unfinished member:", err.message ?? err));
    }
  }
}

export function startOnboardingTasks(client: Client) {
  client.once(Events.ClientReady, () => {
    catchUp(client).catch((err) => console.warn("[onboarding] catch-up failed:", err));
  });
  setInterval(() => {
    if (client.isReady()) removeUnfinished(client).catch((err) => console.warn("[onboarding] cleanup failed:", err));
  }, 15 * 60 * 1000).unref();
}

export const onboardingEvents = [memberJoined, memberLeft, channelCreated];
