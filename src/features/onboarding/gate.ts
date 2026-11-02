import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";

/** Channels the gate controls: everything except threads, and except the onboarding channel itself. */
function gateableChannels(guild: Guild, startChannelId: string | null) {
  return guild.channels.cache.filter((c) => !c.isThread() && c.id !== startChannelId);
}

function botCanEdit(channel: GuildBasedChannel) {
  const me = channel.guild.members.me;
  const perms = me && "permissionsFor" in channel ? channel.permissionsFor(me) : null;
  return Boolean(perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageRoles]));
}

const hidesFrom = (channel: GuildBasedChannel, roleId: string) =>
  "permissionOverwrites" in channel &&
  Boolean(channel.permissionOverwrites.cache.get(roleId)?.deny.has(PermissionFlagsBits.ViewChannel));

/** How many channels are hidden from the gate role right now. */
export function gateCoverage(guild: Guild, settings: OnboardingSettings) {
  const channels = gateableChannels(guild, settings.flow.channelId);
  const roleId = settings.gate.roleId;
  return {
    hidden: roleId ? channels.filter((c) => hidesFrom(c, roleId)).size : 0,
    total: channels.size,
  };
}

/**
 * Channels the gate can't keep closed: in Discord, a role that's allowed to view a channel beats one
 * that's denied, so a join role with "View Channel" allowed there lets new members see it anyway.
 */
export function gateLeaks(guild: Guild, settings: OnboardingSettings) {
  const roleId = settings.gate.roleId;
  if (!settings.gate.enabled || !roleId || !settings.joinRoles.length) return [];
  return [
    ...gateableChannels(guild, settings.flow.channelId)
      .filter(
        (c) =>
          hidesFrom(c, roleId) &&
          "permissionOverwrites" in c &&
          settings.joinRoles.some((id) => c.permissionOverwrites.cache.get(id)?.allow.has(PermissionFlagsBits.ViewChannel)),
      )
      .values(),
  ].map((c) => `#${c.name}`);
}

/** Plain-language list of what "Set it up for me" will do, shown before anything changes. */
export function describeGateSetup(guild: Guild, settings: OnboardingSettings) {
  const steps: string[] = [];
  const role = settings.gate.roleId ? guild.roles.cache.get(settings.gate.roleId) : undefined;
  steps.push(role ? `Use the existing @${role.name} role for new members.` : "Create a role called “New member”.");
  const channel = settings.flow.channelId ? guild.channels.cache.get(settings.flow.channelId) : undefined;
  steps.push(channel ? `Use #${channel.name} as the onboarding channel.` : "Create a #start-here channel at the top of the server.");
  const count = gateableChannels(guild, settings.flow.channelId).size;
  steps.push(`Hide ${count} other channel${count === 1 ? "" : "s"} from new members until they finish. Nothing changes for existing members.`);
  steps.push("Turn on onboarding steps, so new members get a Start button.");
  return steps;
}

/**
 * Creates (or reuses) the new-member role and onboarding channel, and hides every other channel
 * from that role. Returns the updated settings and anything that couldn't be changed.
 */
export async function setUpGate(guild: Guild, settings: OnboardingSettings) {
  const me = guild.members.me;
  if (!me?.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) {
    throw new Error("I need the Manage Roles and Manage Channels permissions to set this up.");
  }

  let role = settings.gate.roleId ? guild.roles.cache.get(settings.gate.roleId) : undefined;
  role ??= await guild.roles.create({
    name: "New member",
    permissions: [],
    mentionable: false,
    reason: "Number One onboarding: temporary role for members who haven't finished onboarding",
  });

  let channel = settings.flow.channelId ? guild.channels.cache.get(settings.flow.channelId) : undefined;
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = await guild.channels.create({
      name: "start-here",
      type: ChannelType.GuildText,
      position: 0,
      topic: "New here? Click Start below to get set up.",
      reason: "Number One onboarding channel",
    });
  }
  // New members can read the onboarding channel but not chat in it.
  await channel.permissionOverwrites.edit(
    role.id,
    { ViewChannel: true, ReadMessageHistory: true, SendMessages: false },
    { reason: "Number One onboarding", type: OverwriteType.Role },
  );

  const skipped: string[] = [];
  for (const target of gateableChannels(guild, channel.id).values()) {
    if (!("permissionOverwrites" in target) || hidesFrom(target, role.id)) continue;
    if (!botCanEdit(target)) {
      skipped.push(`#${target.name}`);
      continue;
    }
    await target.permissionOverwrites
      .edit(role.id, { ViewChannel: false }, { reason: "Number One onboarding: hide until onboarding is finished", type: OverwriteType.Role })
      .catch(() => skipped.push(`#${target.name}`));
  }

  const next: OnboardingSettings = {
    ...settings,
    gate: { ...settings.gate, enabled: true, roleId: role.id },
    flow: { ...settings.flow, enabled: true, channelId: channel.id },
  };
  return { settings: next, skipped };
}

/** Undoes the channel changes: removes the gate role's overwrites everywhere. */
export async function removeGate(guild: Guild, settings: OnboardingSettings) {
  const roleId = settings.gate.roleId;
  let changed = 0;
  if (roleId) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.isThread() || !("permissionOverwrites" in channel) || !channel.permissionOverwrites.cache.has(roleId)) continue;
      if (channel.id === settings.flow.channelId) continue; // keep the onboarding channel readable
      await channel.permissionOverwrites
        .delete(roleId, "Number One onboarding: gate turned off")
        .then(() => changed++)
        .catch(() => {});
    }
  }
  return { settings: { ...settings, gate: { ...settings.gate, enabled: false } }, changed };
}

/** Hides a newly created channel from new members, so the gate stays closed. */
export async function hideNewChannel(channel: GuildBasedChannel, settings: OnboardingSettings) {
  const roleId = settings.gate.roleId;
  if (!settings.gate.enabled || !roleId || channel.isThread() || channel.id === settings.flow.channelId) return;
  if (!("permissionOverwrites" in channel) || !botCanEdit(channel) || hidesFrom(channel, roleId)) return;
  await channel.permissionOverwrites
    .edit(roleId, { ViewChannel: false }, { reason: "Number One onboarding: new channel hidden from new members", type: OverwriteType.Role })
    .catch(() => {});
}
