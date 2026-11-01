import {
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type PartialGuildMember,
  PermissionFlagsBits,
} from "discord.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";

export const PINK = 0xff4fa3;

/** Fills in {user}, {username}, {server}, {memberCount} and {startChannel}. */
export function fillPlaceholders(text: string, member: GuildMember | PartialGuildMember, settings: OnboardingSettings) {
  const name = member.displayName ?? member.user?.username ?? "someone";
  return text
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", name)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", member.guild.memberCount.toLocaleString("en-US"))
    .replaceAll("{startChannel}", settings.flow.channelId ? `<#${settings.flow.channelId}>` : "the onboarding channel");
}

/** A channel the bot can post in: the chosen one, or the server's system channel. */
export function postableChannel(guild: Guild, channelId: string | null): GuildTextBasedChannel | null {
  const channel = channelId ? guild.channels.cache.get(channelId) : guild.systemChannel;
  if (!channel || !channel.isTextBased() || channel.isThread()) return null;
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel as GuildTextBasedChannel;
}

function payload(text: string, member: GuildMember | PartialGuildMember, useEmbed: boolean) {
  // Mention the member only (never @everyone or roles), even if the message text contains them.
  const allowedMentions = { users: [member.id] };
  if (!useEmbed) return { content: text, allowedMentions };
  const avatar = member.user?.displayAvatarURL?.({ size: 128 });
  const embed = new EmbedBuilder().setColor(PINK).setDescription(text);
  if (avatar) embed.setThumbnail(avatar);
  return { embeds: [embed], allowedMentions };
}

export async function sendWelcome(member: GuildMember, settings: OnboardingSettings) {
  const channel = postableChannel(member.guild, settings.welcome.channelId);
  if (!channel) return false;
  const text = fillPlaceholders(settings.welcome.message, member, settings);
  if (!text.trim()) return false;
  await channel.send(payload(text, member, settings.welcome.useEmbed));
  return true;
}

export async function sendWelcomeDm(member: GuildMember, settings: OnboardingSettings) {
  const text = fillPlaceholders(settings.welcome.dmMessage, member, settings);
  if (!text.trim()) return;
  // Members can block DMs; that's fine, there's nothing to do about it.
  await member.send({ embeds: [new EmbedBuilder().setColor(PINK).setDescription(text)] }).catch(() => {});
}

export async function sendGoodbye(member: GuildMember | PartialGuildMember, settings: OnboardingSettings) {
  const channel = postableChannel(member.guild, settings.goodbye.channelId);
  if (!channel) return;
  const text = fillPlaceholders(settings.goodbye.message, member, settings);
  if (!text.trim()) return;
  await channel.send(payload(text, member, true)).catch(() => {});
}
