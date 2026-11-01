import { type Guild, PermissionFlagsBits } from "discord.js";

/**
 * Checks that the bot is allowed to give a role. Returns a plain-language reason when it can't.
 * `byMemberHighest` stops an admin from handing out roles above their own.
 */
export function roleProblem(guild: Guild, roleId: string, byMemberHighest?: { position: number; isOwner: boolean }) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return "That role no longer exists.";
  if (role.id === guild.id) return "The @everyone role can't be given out.";
  if (role.managed) return `${role.name} is managed by an integration or bot, so it can't be given out manually.`;
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "I need the **Manage Roles** permission.";
  if (role.position >= me.roles.highest.position) {
    return `My highest role must be above **${role.name}**. Move my role higher in Server Settings → Roles.`;
  }
  if (byMemberHighest && !byMemberHighest.isOwner && role.position >= byMemberHighest.position) {
    return `You can only set up roles that are below your own highest role.`;
  }
  return null;
}
