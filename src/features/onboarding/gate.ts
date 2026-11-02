import { ChannelType, type Guild, OverwriteType, PermissionFlagsBits } from "discord.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";
import { type AccessState, accessSummary, startArea, viewBit } from "./access.js";

/**
 * The access gate: new members get a "New member" role until they finish onboarding, and ordinary
 * channels are hidden from that role. The hiding itself is done by access.ts, together with the
 * public, new-member-only and private-mode rules, so they can never disagree.
 */

const START_CATEGORY = "Start here";
const START_CHANNEL = "start-here";

/**
 * Channels the gate can't keep closed: in Discord, a role that's allowed to view a channel beats one
 * that's denied, so a join role with "View Channel" allowed there lets new members see it anyway.
 */
export function gateLeaks(guild: Guild, settings: OnboardingSettings, state: AccessState) {
  if (!(settings.gate.enabled || state.privateMode) || !settings.joinRoles.length) return [];
  const gateRole = settings.gate.roleId;
  return accessSummary(guild, settings, state)
    .byClass.other.filter(
      (c) =>
        (state.privateMode ? viewBit(c, guild.id) === false : Boolean(gateRole) && viewBit(c, gateRole!) === false) &&
        settings.joinRoles.some((id) => viewBit(c, id) === true),
    )
    .map((c) => `#${c.name}`);
}

/**
 * Creates (or reuses) the new-member role and onboarding channel, and returns settings with the gate
 * and onboarding steps switched on. The caller saves them and runs access.applyAccessNow to hide channels.
 */
export async function setUpGate(guild: Guild, settings: OnboardingSettings): Promise<OnboardingSettings> {
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
  if (!channel || channel.type !== ChannelType.GuildText) channel = await createStartArea(guild, role.id, me.id);

  // New members can read the onboarding channel (and see its category) but not chat in it.
  for (const id of startArea(guild, channel.id)) {
    const target = guild.channels.cache.get(id);
    if (!target || target.isThread() || !("permissionOverwrites" in target)) continue;
    await target.permissionOverwrites
      .edit(
        role.id,
        { ViewChannel: true, ReadMessageHistory: true, SendMessages: false },
        { reason: "Number One onboarding", type: OverwriteType.Role },
      )
      .catch(() => {});
  }

  return {
    ...settings,
    gate: { ...settings.gate, enabled: true, roleId: role.id },
    flow: { ...settings.flow, enabled: true, channelId: channel.id },
  };
}

/**
 * Creates the "Start here" category at the top of the server with a #start-here channel inside.
 * Reuses a category with that name if one exists. Everyone can read the channel, but only the bot
 * posts there, so the Start message stays at the top.
 */
async function createStartArea(guild: Guild, gateRoleId: string, botId: string) {
  // Discord only lets the bot set permissions it has itself, so leave out any it doesn't.
  const has = (p: bigint) => Boolean(guild.members.me?.permissions.has(p));
  const P = PermissionFlagsBits;
  const readOnly = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads].filter(has) },
    { id: gateRoleId, type: OverwriteType.Role, allow: [P.ViewChannel, P.ReadMessageHistory].filter(has), deny: [P.SendMessages].filter(has) },
    // The bot always keeps what it needs to post and update the Start message.
    { id: botId, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory].filter(has) },
  ];

  const category =
    guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === START_CATEGORY.toLowerCase()) ??
    (await guild.channels.create({
      name: START_CATEGORY,
      type: ChannelType.GuildCategory,
      position: 0,
      permissionOverwrites: readOnly,
      reason: "Number One onboarding category",
    }));

  return guild.channels.create({
    name: START_CHANNEL,
    type: ChannelType.GuildText,
    parent: category.id,
    position: 0,
    topic: "New here? Click Start below to get set up.",
    permissionOverwrites: readOnly,
    reason: "Number One onboarding channel",
  });
}
