import {PermissionFlagsBits} from 'discord.js';

export const MANAGEMENT_ONLY_MESSAGE='You do not have permission to use Number One slash commands. You need Administrator or Manage Server permission.';

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
