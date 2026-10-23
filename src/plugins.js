// Dashboard plugin switches. Stored in the bot's existing generic `records` table
// (kind 'dashboard-plugins', id 'main'), so no schema migration is required.
// A missing record or missing key means enabled, preserving behaviour for existing servers.
export const TOGGLEABLE_PLUGINS=Object.freeze(['moderation','embeds','scheduler','instagram']);
const MODERATION_COMMANDS=['ban','unban','kick','warn','timeout','mute','untimeout','unmute','purge','warnings','modlogs','case','reason','delwarn','mod-reconcile','mod-settings','appeals','emergency'];
export const COMMAND_PLUGINS=Object.freeze({
  ...Object.fromEntries(MODERATION_COMMANDS.map(name=>[name,'moderation'])),
  embed:'embeds',schedule:'scheduler',instagram:'instagram'
});
export const PLUGIN_DISABLED_MESSAGE='This feature is turned off for this server. A server manager can turn it on in the Number One dashboard.';
export function pluginStates(store,guild){
  const saved=store.get(guild,'dashboard-plugins','main')||{};
  return Object.fromEntries(TOGGLEABLE_PLUGINS.map(name=>[name,saved[name]!==false]));
}
export function pluginEnabled(store,guild,plugin){return !TOGGLEABLE_PLUGINS.includes(plugin)||pluginStates(store,guild)[plugin];}
export function setPluginEnabled(store,guild,plugin,enabled,actor){
  if(!TOGGLEABLE_PLUGINS.includes(plugin)||typeof enabled!=='boolean')throw new TypeError('Unknown plugin or invalid state.');
  const saved=store.get(guild,'dashboard-plugins','main')||{id:'main'};
  store.put(guild,'dashboard-plugins',{...saved,id:'main',[plugin]:enabled,updatedBy:actor,updatedAt:Date.now()});
  return pluginStates(store,guild);
}
export function commandPluginEnabled(store,guild,commandName){const plugin=COMMAND_PLUGINS[commandName];return !plugin||pluginEnabled(store,guild,plugin);}
