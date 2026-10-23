import {PermissionFlagsBits} from 'discord.js';

export const MANAGEMENT_ONLY_MESSAGE='You do not have permission to use these commands. You need Administrator or Manage Server permission, or access granted by this server’s owner.';

export function canManageServer(permissions) {
  if (!permissions) {
    return false;
  } else if (permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  } else if (permissions.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  } else {
    return false;
  }
}
