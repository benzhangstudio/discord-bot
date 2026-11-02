import { type Guild, type GuildMember, PermissionFlagsBits, type PermissionResolvable, type User } from "discord.js";
import { type CaseAction, type ModerationSettings, actionInfo } from "../../shared/moderation.js";

/** A problem the moderator can understand and fix. Shown to them as-is. */
export class ModError extends Error {}

/** The Discord permission each action needs, both from the moderator and from Number One. */
export const actionPermission: Record<CaseAction, { flag: PermissionResolvable; name: string }> = {
  warn: { flag: PermissionFlagsBits.ModerateMembers, name: "Timeout Members" },
  note: { flag: PermissionFlagsBits.ModerateMembers, name: "Timeout Members" },
  timeout: { flag: PermissionFlagsBits.ModerateMembers, name: "Timeout Members" },
  untimeout: { flag: PermissionFlagsBits.ModerateMembers, name: "Timeout Members" },
  kick: { flag: PermissionFlagsBits.KickMembers, name: "Kick Members" },
  ban: { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
  unban: { flag: PermissionFlagsBits.BanMembers, name: "Ban Members" },
};

/** Actions that change something in Discord (so Number One needs the permission and a high enough role). */
const DISCORD_ACTIONS = new Set<CaseAction>(["timeout", "untimeout", "kick", "ban", "unban"]);

/**
 * Everything that must be true before a moderator can act on someone.
 * `moderator` is null when Number One acts on its own (warning steps, temporary bans running out).
 * Throws a ModError explaining what's wrong.
 */
export function checkCanAct(
  guild: Guild,
  action: CaseAction,
  moderator: GuildMember | null,
  target: { user: User; member: GuildMember | null },
) {
  const { label } = actionInfo[action];
  const verb = label.toLowerCase();
  const perm = actionPermission[action];
  const me = guild.members.me;

  if (moderator && !moderator.permissions.has(perm.flag)) {
    throw new ModError(`You need the **${perm.name}** permission to do that.`);
  }
  if (DISCORD_ACTIONS.has(action) && !me?.permissions.has(perm.flag)) {
    throw new ModError(`I need the **${perm.name}** permission to do that. Give my role that permission in Server Settings → Roles.`);
  }

  const { user, member } = target;
  if (moderator && user.id === moderator.id) throw new ModError(`You can't ${verb} yourself.`);
  if (user.id === guild.client.user.id) throw new ModError("I can't moderate myself.");
  if (user.id === guild.ownerId && action !== "note") throw new ModError("The server owner can't be moderated.");

  if (!member) {
    if (["timeout", "untimeout", "kick"].includes(action)) throw new ModError(`**${user.username}** isn't in this server.`);
    return;
  }

  const isOwner = moderator?.id === guild.ownerId;
  if (moderator && !isOwner && action !== "note" && member.roles.highest.position >= moderator.roles.highest.position) {
    throw new ModError(`**${user.username}** has a role equal to or higher than yours, so you can't ${verb} them.`);
  }
  if (DISCORD_ACTIONS.has(action) && me && member.roles.highest.position >= me.roles.highest.position) {
    throw new ModError(
      `**${user.username}**'s highest role is above or equal to mine. Move my role higher in Server Settings → Roles.`,
    );
  }
  if (action === "timeout" && member.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new ModError("Members with the Administrator permission can't be timed out.");
  }
  if (action === "untimeout" && !member.isCommunicationDisabled()) {
    throw new ModError(`**${user.username}** isn't timed out.`);
  }
}

/** Requires a reason when the server asks for one. */
export function checkReason(settings: ModerationSettings, reason: string) {
  if (settings.requireReason && !reason.trim()) throw new ModError("This server requires a reason for every moderation action.");
}

/** Missing permissions and setup problems, in plain words, for the dashboard. */
export function setupProblems(guild: Guild, settings: ModerationSettings): string[] {
  const me = guild.members.me;
  if (!me) return [];
  const problems: string[] = [];
  const needs: [PermissionResolvable, string, string][] = [
    [PermissionFlagsBits.ModerateMembers, "Timeout Members", "time members out"],
    [PermissionFlagsBits.KickMembers, "Kick Members", "kick"],
    [PermissionFlagsBits.BanMembers, "Ban Members", "ban or unban (including temporary bans running out)"],
    [PermissionFlagsBits.ManageMessages, "Manage Messages", "use /purge"],
  ];
  if (settings.trackExternal) needs.push([PermissionFlagsBits.ViewAuditLog, "View Audit Log", "record actions taken directly in Discord"]);
  for (const [flag, name, what] of needs) {
    if (!me.permissions.has(flag)) problems.push(`I need the ${name} permission to ${what}.`);
  }
  if (settings.logChannelId) {
    const channel = guild.channels.cache.get(settings.logChannelId);
    if (!channel || !channel.isTextBased()) {
      problems.push("The mod log channel no longer exists. Pick another one.");
    } else {
      const perms = channel.permissionsFor(me);
      const missing = [
        [PermissionFlagsBits.ViewChannel, "View Channel"],
        [PermissionFlagsBits.SendMessages, "Send Messages"],
        [PermissionFlagsBits.EmbedLinks, "Embed Links"],
      ]
        .filter(([flag]) => !perms?.has(flag as bigint))
        .map(([, name]) => name);
      if (missing.length) problems.push(`In #${channel.name} (mod log) I need: ${missing.join(", ")}.`);
    }
  }
  return problems;
}
