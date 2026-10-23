import {PermissionFlagsBits as P} from 'discord.js';
const timezones=[['America/New_York','New York · Eastern time'],['America/Chicago','Chicago · Central time'],['America/Denver','Denver · Mountain time'],['America/Los_Angeles','Los Angeles · Pacific time'],['America/Phoenix','Phoenix · Arizona time'],['America/Anchorage','Anchorage · Alaska time'],['Pacific/Honolulu','Honolulu · Hawaii time'],['America/Toronto','Toronto · Eastern time'],['America/Vancouver','Vancouver · Pacific time'],['America/Sao_Paulo','São Paulo'],['Europe/London','London'],['Europe/Paris','Paris'],['Europe/Berlin','Berlin'],['Asia/Seoul','Seoul · Korea time'],['Asia/Tokyo','Tokyo · Japan time'],['Asia/Shanghai','Shanghai · China time'],['Asia/Singapore','Singapore'],['Asia/Kolkata','Kolkata · India time'],['Asia/Dubai','Dubai'],['Australia/Sydney','Sydney'],['Pacific/Auckland','Auckland'],['UTC','Universal time · UTC']];
const normalized=value=>String(value).toLowerCase().replace(/[_/]/g,' ');
export const timezoneLabel=(value='America/New_York')=>timezones.find(([zone])=>zone===value)?.[1] || value.split('/').at(-1).replace(/_/g,' ');
export function suggestions(store,i,{canManage=false,canConfigure=false}={}) {
  if(!i.inGuild() || !canManage)return [];
  const focused=i.options.getFocused(true),query=normalized(focused.value);
  if(['case','id','appeal'].includes(focused.name)&&['case','reason','delwarn','mod-reconcile','appeals'].includes(i.commandName)){
    const cfg=store.get(i.guildId,'mod-config','main');
    const permissions=i.memberPermissions;
    const roleIds=i.member?.roles?.cache?[...i.member.roles.cache.keys()]:i.member?.roles||[];
    if(!permissions?.has(P.Administrator)&&!permissions?.has(P.ModerateMembers)&&i.user?.id!==i.guild?.ownerId&&(!cfg?.modRole||!roleIds.includes(cfg.modRole)))return [];
    const grant=store.get(i.guildId,'access',i.user?.id||'');
    if(!permissions?.has(P.Administrator)&&!permissions?.has(P.ManageGuild)&&i.user?.id!==i.guild?.ownerId&&grant?.grantedBy!==i.guild?.ownerId)return [];
    if(i.commandName==='mod-reconcile'&&i.user?.id!==i.guild?.ownerId)return [];
    const kind=focused.name==='appeal'?'mod-appeal':'mod-case';
    const memberName=c=>i.guild.members?.cache?.get(c.target||c.actor)?.displayName||c.details?.memberName||c.target||c.actor;
    return store.list(i.guildId,kind).reverse().filter(c=>i.commandName!=='delwarn'||c.action==='warn'&&c.state==='succeeded'&&!c.voided).filter(c=>normalized([c.id,c.target,c.actor,c.action,c.reason,c.state,memberName(c)].join(' ')).includes(query)).slice(0,25).map(c=>({name:`${c.action||'Appeal'} · ${memberName(c)} · ${c.reason||c.state} · ${c.id}`.slice(0,100),value:c.id}));
  }
  if(focused.name==='zone') {
    if((i.commandName==='settings'&&!canConfigure)||(i.commandName==='schedule'&&!canManage))return [];
    return timezones.filter(([value,name])=>normalized(value+' '+name).includes(query)).slice(0,25).map(([value,name])=>({name,value}));
  }
  if(i.commandName==='reaction-roles'&&focused.name==='message')return store.list(i.guildId,'reaction-role').filter(g=>normalized((g.title||'Reaction roles')+' '+g.id+' '+g.message).includes(query)).slice(0,25).map(g=>({name:`${g.title||'Reaction roles'} · #${i.guild?.channels?.cache?.get(g.channel)?.name||g.channel} · ${g.entries.length} role(s)${g.broken?' · Needs attention':''}`.slice(0,100),value:g.id}));
  const kind={embed:'embed',schedule:'event',instagram:'feed'}[i.commandName];
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
