import {PermissionFlagsBits as P} from 'discord.js';
const timezones=[['America/New_York','New York · Eastern time'],['America/Chicago','Chicago · Central time'],['America/Denver','Denver · Mountain time'],['America/Los_Angeles','Los Angeles · Pacific time'],['America/Phoenix','Phoenix · Arizona time'],['America/Anchorage','Anchorage · Alaska time'],['Pacific/Honolulu','Honolulu · Hawaii time'],['America/Toronto','Toronto · Eastern time'],['America/Vancouver','Vancouver · Pacific time'],['America/Sao_Paulo','São Paulo'],['Europe/London','London'],['Europe/Paris','Paris'],['Europe/Berlin','Berlin'],['Asia/Seoul','Seoul · Korea time'],['Asia/Tokyo','Tokyo · Japan time'],['Asia/Shanghai','Shanghai · China time'],['Asia/Singapore','Singapore'],['Asia/Kolkata','Kolkata · India time'],['Asia/Dubai','Dubai'],['Australia/Sydney','Sydney'],['Pacific/Auckland','Auckland'],['UTC','Universal time · UTC']];
const normalized=value=>String(value).toLowerCase().replace(/[_/]/g,' ');
export const timezoneLabel=(value='America/New_York')=>timezones.find(([zone])=>zone===value)?.[1] || value.split('/').at(-1).replace(/_/g,' ');
export function suggestions(store,i,{canManage=false,canConfigure=false}={}) {
  if(!i.inGuild())return [];
  const focused=i.options.getFocused(true),query=normalized(focused.value);
  if(focused.name==='zone') {
    if((i.commandName==='settings'&&!canConfigure)||(i.commandName==='schedule'&&!canManage))return [];
    return timezones.filter(([value,name])=>normalized(value+' '+name).includes(query)).slice(0,25).map(([value,name])=>({name,value}));
  }
  const kind={embed:'embed',schedule:'event',feed:'feed'}[i.commandName];
  if(!kind || (kind!=='event'&&!canManage))return [];
  return store.list(i.guildId,kind).filter(record=>{
    if(kind==='event') {
      if(i.options.getSubcommand(false)!=='show'&&!canManage)return false;
      const channel=i.guild.channels.cache?.get(record.channel);
      if(!channel?.permissionsFor(i.member)?.has(P.ViewChannel))return false;
      const action=i.options.getSubcommand(false);
      if(action!=='show'&&(record.cancelled||record.complete))return false;
    }
    return normalized((record.name||record.title)+' '+record.id).includes(query);
  }).slice(0,25).map(record=>({name:`${record.name||record.title}${record.cancelled?' · Cancelled':record.complete?' · Finished':''}`.slice(0,100),value:record.id}));
}
