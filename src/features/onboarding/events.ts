import { type Client, Events, type Guild, type GuildMember } from "discord.js";
import { onEvent } from "../../server/bot/types.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";
import { onboardingFeature } from "../../shared/features.js";
import { syncAccess } from "./access.js";
import { flowActive, scheduleCardRefresh, syncStartMessage } from "./flow.js";
import { sendGoodbye, sendWelcome, sendWelcomeDm } from "./messages.js";
import { addRoles } from "./roles.js";
import * as store from "./store.js";

/**
 * Everything that happens when someone joins: starting roles, the "new member" role when the gate is on,
 * and the welcome message / DM. `quiet` skips messages (used when catching up after downtime).
 */
async function handleJoin(member: GuildMember, settings: OnboardingSettings, quiet = false) {
  if (member.user.bot) {
    // Bots skip onboarding, so they count as verified straight away.
    const verified = settings.access.verifiedRoleId ? [settings.access.verifiedRoleId] : [];
    await addRoles(member, [...settings.botRoles, ...verified], "Onboarding: bot roles");
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
  if (!settings) return;
  await handleJoin(member, settings);
  scheduleCardRefresh(member.guild);
});

const memberLeft = onEvent(Events.GuildMemberRemove, async (member) => {
  const settings = await store.getActiveSettings(member.guild.id);
  if (settings?.goodbye.enabled && !member.user?.bot) await sendGoodbye(member, settings);
  // If they come back, they go through onboarding again (like Discord's own onboarding).
  await store.deleteProgress(member.guild.id, member.id);
  if (settings) scheduleCardRefresh(member.guild);
});

// New channels follow the server's access rules (hidden from new members, private in private mode...).
const channelCreated = onEvent(Events.ChannelCreate, async (channel) => {
  await syncAccess(channel.guild, [channel]);
});

// A channel moved into or out of a category (e.g. a staff category) may need different access.
const channelMoved = onEvent(Events.ChannelUpdate, async (before, after) => {
  if (after.isDMBased() || before.isDMBased() || after.isThread()) return;
  if ("parentId" in before && before.parentId !== after.parentId) await syncAccess(after.guild, [after]);
});

// Keep the Start card's verified / at-the-gate numbers current when those roles change.
const rolesChanged = onEvent(Events.GuildMemberUpdate, async (before, after) => {
  const settings = await store.getActiveSettings(after.guild.id);
  const watched = [settings?.access.verifiedRoleId, settings?.gate.roleId].filter((id): id is string => Boolean(id));
  if (!watched.length) return;
  if (before.partial || watched.some((id) => before.roles.cache.has(id) !== after.roles.cache.has(id))) {
    scheduleCardRefresh(after.guild);
  }
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

/**
 * Takes the "new member" role off everyone still holding it, so nobody is left stuck behind the
 * access gate when onboarding is switched off. Saved settings stay, so it can be switched back on.
 */
export async function releaseGatedMembers(guild: Guild, settings: OnboardingSettings, reason: string) {
  const roleId = settings.gate.enabled ? settings.gate.roleId : null;
  const role = roleId ? guild.roles.cache.get(roleId) : undefined;
  if (!role || !role.editable) return 0;
  const members = await guild.members.fetch().catch(() => null);
  let released = 0;
  for (const member of (members ?? guild.members.cache).values()) {
    if (!member.roles.cache.has(role.id)) continue;
    await member.roles
      .remove(role, reason)
      .then(() => released++)
      .catch(() => {});
  }
  if (released) console.log(`[onboarding] ${guild.name} (${guild.id}): released ${released} gated member(s)`);
  return released;
}

/** While onboarding is marked work in progress it's off everywhere, so release anyone behind the gate. */
async function pauseOnboarding(client: Client) {
  for (const guildId of await store.guildsWithOnboarding()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const settings = await store.getSettings(guildId);
    await syncStartMessage(guild, settings, false).catch(() => {});
    await releaseGatedMembers(guild, settings, "Member onboarding is paused while it's being worked on");
  }
}

export function startOnboardingTasks(client: Client) {
  client.once(Events.ClientReady, () => {
    if (onboardingFeature.workInProgress) {
      pauseOnboarding(client).catch((err) => console.warn("[onboarding] pause failed:", err));
      return;
    }
    catchUp(client).catch((err) => console.warn("[onboarding] catch-up failed:", err));
  });
  setInterval(() => {
    if (!client.isReady()) return;
    removeUnfinished(client).catch((err) => console.warn("[onboarding] cleanup failed:", err));
    // Weekly numbers on the Start card change with time too, so refresh every card now and then.
    store
      .guildsWithOnboarding()
      .then((ids) => ids.forEach((id) => {
        const guild = client.guilds.cache.get(id);
        if (guild) scheduleCardRefresh(guild, 1000 + Math.random() * 60_000);
      }))
      .catch(() => {});
  }, 15 * 60 * 1000).unref();
}

export const onboardingEvents = [memberJoined, memberLeft, channelCreated, channelMoved, rolesChanged];
