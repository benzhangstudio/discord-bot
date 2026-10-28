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

export const COMMAND_PERMISSIONS=Object.freeze({ban:PermissionFlagsBits.BanMembers,unban:PermissionFlagsBits.BanMembers,kick:PermissionFlagsBits.KickMembers,purge:PermissionFlagsBits.ManageMessages,warn:PermissionFlagsBits.ModerateMembers,unwarn:PermissionFlagsBits.ModerateMembers,timeout:PermissionFlagsBits.ModerateMembers,untimeout:PermissionFlagsBits.ModerateMembers,case:PermissionFlagsBits.ModerateMembers,lockdown:PermissionFlagsBits.ManageChannels});
export const MODERATOR_PERMISSIONS=PermissionFlagsBits.BanMembers|PermissionFlagsBits.KickMembers|PermissionFlagsBits.ManageMessages|PermissionFlagsBits.ModerateMembers|PermissionFlagsBits.ManageChannels;
export const NATIVE_ACCESS_MESSAGE='You need the Discord permission for this action. Ask a server administrator to review your roles.';
export const commandPermission=name=>COMMAND_PERMISSIONS[name]??PermissionFlagsBits.ManageGuild;
export function canUseCommand(i,name=i.commandName){
  if(i.guild?.ownerId&&i.user?.id===i.guild.ownerId)return true;
  if(i.user?.bot)return false;
  const p='memberPermissions' in i?i.memberPermissions:i.member?.permissions;
  if(!p?.has)return false;
  if(p.has(PermissionFlagsBits.Administrator))return true;
  if(name==='help')return canManageServer(p)||Object.values(COMMAND_PERMISSIONS).some(bit=>p.has(bit));
  return p.has(commandPermission(name));
}
export function interactionCommand(i){
  if(i.commandName)return i.commandName;
  const kind=String(i.customId||'').split(':')[0];
  return ({modpage:'case',help:'help',embed:'embed',embedform:'embed',instagram:'instagram',rsvp:'schedule',eventform:'schedule'})[kind]||'settings';
}
export function dashboardAccess(identity){
  const administrator=!!identity.owner||identity.administrator===true;
  const manager=administrator||identity.manager===true;
  return {...identity,administrator,dashboard:manager,manager,securityAdmin:administrator,moderationAccess:administrator||identity.moderationAccess===true};
}
