// Reaction roles (MEE6-style). Configuration lives in the shared `records` table:
//   kind 'reaction-role' (one record per message) and kind 'rr-temp' (temporary role expiries).
// No schema migration is needed; missing fields fall back to defaults.
import {EmbedBuilder,PermissionFlagsBits as P} from 'discord.js';
import {UserError} from './user-error.js';
import {RR} from './reaction-role-messages.js';
import {pluginEnabled} from './plugins.js';

export const RR_LIMITS=Object.freeze({groups:50,entries:20,durationMinutes:43200});
export const RR_MODES=Object.freeze(['normal','unique']);
const fail=m=>{throw new UserError(m);};
const must=(ok,m)=>{if(!ok)fail(m);};
const strip=s=>String(s).replace(/\uFE0F/g,'');

/** Parse user emoji input into {key, display}. key matches reaction.emoji.id || name. */
export function parseEmoji(input){
  const value=String(input??'').trim();
  const custom=value.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if(custom)return {key:custom[3],display:value,custom:true};
  must(value&&value.length<=16&&!/[\sA-Za-z<>:@#]/.test(value.replace(/^[#*0-9]\uFE0F?\u20E3$/,''))&&/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(value),RR.emoji);
  return {key:strip(value),display:value,custom:false};
}
export const reactionKey=emoji=>emoji?.id||strip(emoji?.name||'');
export function parseDuration(input){
  if(input==null||input==='')return null;
  const v=String(input).trim().toLowerCase();if(['off','none','0'].includes(v))return 0;
  const m=v.match(/^(\d{1,5})\s*(m|min|h|d|w)$/);must(m,RR.duration);
  const minutes=Number(m[1])*{m:1,min:1,h:60,d:1440,w:10080}[m[2]];must(minutes>=1&&minutes<=RR_LIMITS.durationMinutes,RR.duration);return minutes;
}
export function parseMessageRef(input,guildId){
  const v=String(input??'').trim();
  const link=v.match(/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/);
  if(link){must(link[1]===guildId,RR.messageRef);return {channel:link[2],message:link[3]};}
  must(/^\d{17,20}$/.test(v),RR.messageRef);return {channel:null,message:v};
}
export const durationLabel=m=>m%10080===0?`${m/10080}w`:m%1440===0?`${m/1440}d`:m%60===0?`${m/60}h`:`${m}m`;

/**
 * Pure decision for one reaction event. memberRoles: Set of role IDs the member holds.
 * Returns {add:[], remove:[], clearReactions:[emoji keys], denied?:'required'|'limit', removeReaction?:bool}.
 */
export function planReaction(group,key,memberRoles,added){
  const entry=group.entries.find(e=>e.key===key);
  const none={add:[],remove:[],clearReactions:[]};
  if(!entry)return none;
  if(!added){
    if(group.removeOnUnreact===false||!memberRoles.has(entry.role))return none;
    return {...none,remove:[entry.role]};
  }
  if(group.requiredRole&&!memberRoles.has(group.requiredRole))return {...none,denied:'required',removeReaction:true};
  const others=group.entries.filter(e=>e.role!==entry.role&&memberRoles.has(e.role));
  if(group.mode==='unique')return {add:memberRoles.has(entry.role)?[]:[entry.role],remove:others.map(e=>e.role),clearReactions:others.map(e=>e.key)};
  if(!memberRoles.has(entry.role)&&group.maxRoles&&others.length>=group.maxRoles)return {...none,denied:'limit',removeReaction:true};
  return {...none,add:memberRoles.has(entry.role)?[]:[entry.role]};
}

export function groupEmbed(group){
  const lines=group.entries.map(e=>`${e.display} – <@&${e.role}>`);
  const notes=[group.mode==='unique'?'Pick one role':group.maxRoles?`Pick up to ${group.maxRoles} roles`:null,
    group.requiredRole?'Requires a role':null,group.removeOnUnreact===false?'Roles stay when you remove your reaction':null,
    group.duration?`Roles last ${durationLabel(group.duration)}`:null].filter(Boolean);
  const description=[group.description,lines.length?lines.join('\n'):'No roles yet.'].filter(Boolean).join('\n\n');
  const e=new EmbedBuilder().setColor(0x5865f2).setTitle(group.title||'Reaction roles').setDescription(description.slice(0,4096));
  if(group.requiredRole)e.addFields({name:'Required role',value:`<@&${group.requiredRole}>`});
  if(notes.length)e.setFooter({text:notes.join(' · ')});
  return {embeds:[e],allowedMentions:{parse:[]}};
}

function normalizeOptions(o,base={}){
  const g={...base};
  if(o.title!==undefined){must(o.title==null||String(o.title).length<=256,RR.text);g.title=o.title?String(o.title):null;}
  if(o.description!==undefined){must(o.description==null||String(o.description).length<=2000,RR.text);g.description=o.description?String(o.description):null;}
  if(o.mode!=null){must(RR_MODES.includes(o.mode),RR.mode);g.mode=o.mode;}
  if(o.maxRoles!=null){must(Number.isInteger(o.maxRoles)&&o.maxRoles>=0&&o.maxRoles<=20,RR.maxRoles);g.maxRoles=o.maxRoles||null;}
  if(o.duration!==undefined&&o.duration!==null){const d=typeof o.duration==='number'?o.duration:parseDuration(o.duration);must(d===0||(Number.isInteger(d)&&d>=1&&d<=RR_LIMITS.durationMinutes),RR.duration);g.duration=d||null;}
  if(o.removeOnUnreact!=null)g.removeOnUnreact=!!o.removeOnUnreact;
  if(o.requiredRole!==undefined)g.requiredRole=o.requiredRole||null;
  g.mode||='normal';g.removeOnUnreact??=true;g.entries||=[];
  return g;
}

export function createReactionRoles({store,client,log=console,now=()=>Date.now()}){
  async function me(guild){return guild.members.me||await guild.members.fetchMe();}
  async function channelFor(guild,id){
    const ch=guild.channels.cache.get(id)||await guild.channels.fetch(id).catch(()=>null);
    must(ch&&[0,5].includes(ch.type),RR.channel);return ch;
  }
  async function checkBot(guild,channel){
    const bot=await me(guild);
    must(bot.permissions.has(P.ManageRoles),RR.needManageRoles);
    must(channel.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.AddReactions,P.ReadMessageHistory]),RR.channelPerms);
    return bot;
  }
  async function checkRole(guild,roleId,actor){
    const role=guild.roles.cache.get(roleId)||await guild.roles.fetch(roleId).catch(()=>null);
    must(role&&role.id!==guild.id&&!role.managed,RR.role);
    const bot=await me(guild);
    must(role.position<bot.roles.highest.position,RR.roleAboveBot);
    if(actor&&!actor.owner&&actor.id!==guild.ownerId){
      const member=actor.roles?actor:await guild.members.fetch(actor.id).catch(()=>null);
      must(member&&role.position<member.roles.highest.position,RR.roleAboveYou);
    }
    return role;
  }
  const get=(guild,id)=>{const g=store.get(guild,'reaction-role',id);must(g,RR.groupMissing);return g;};
  async function fetchMessage(guild,group){
    const ch=await channelFor(guild,group.channel);
    const msg=await ch.messages.fetch(group.message).catch(()=>null);must(msg,RR.messageMissing);return msg;
  }
  async function refresh(guild,group,msg){if(group.owned)await (msg||await fetchMessage(guild,group)).edit(groupEmbed(group));}
  async function react(msg,entry){
    try{await msg.react(entry.custom?entry.key:entry.display);}catch(error){if(String(error.code)==='10014'||String(error.code)==='50035')fail(RR.emojiUnusable);throw error;}
  }
  async function entryFrom(guild,group,{emoji,role},actor,skip){
    const e=parseEmoji(emoji);
    must(!group.entries.some(x=>x.key===e.key&&x!==skip),RR.emojiTaken);
    must(!group.entries.some(x=>x.role===role&&x!==skip),RR.roleTaken);
    await checkRole(guild,role,actor);
    return {...e,role};
  }
  function save(guild,group){group.updatedAt=now();group.broken=null;return store.put(guild,'reaction-role',group);}

  const api={
    list:guild=>store.list(guild,'reaction-role'),
    get,
    /** Post a new embed (message omitted) or attach to an existing message. */
    async create(guild,{channel,message,entries=[],...options},actor){
      must(store.list(guild.id,'reaction-role').length<RR_LIMITS.groups,RR.groupLimit);
      let ref=message?parseMessageRef(message,guild.id):null;
      const ch=await channelFor(guild,ref?.channel||channel);await checkBot(guild,ch);
      const group=normalizeOptions(options,{channel:ch.id,createdBy:actor?.id||null,createdAt:now()});
      if(group.requiredRole)await checkRole(guild,group.requiredRole,null);
      must(entries.length<=RR_LIMITS.entries,RR.entryLimit);
      for(const x of entries)group.entries.push(await entryFrom(guild,group,x,actor));
      let msg;
      if(ref){
        must(!store.list(guild.id,'reaction-role').some(g=>g.message===ref.message),RR.messageTaken);
        msg=await ch.messages.fetch(ref.message).catch(()=>null);must(msg,RR.messageMissing);group.owned=false;
      }else{msg=await ch.send(groupEmbed(group));group.owned=true;}
      group.message=msg.id;
      for(const e of group.entries)await react(msg,e);
      return save(guild.id,group);
    },
    async addEntry(guild,id,{emoji,role},actor){
      const group=get(guild.id,id);must(group.entries.length<RR_LIMITS.entries,RR.entryLimit);
      const msg=await fetchMessage(guild,group);await checkBot(guild,msg.channel);
      const entry=await entryFrom(guild,group,{emoji,role},actor);
      await react(msg,entry);group.entries.push(entry);await refresh(guild,group,msg);return save(guild.id,group);
    },
    async removeEntry(guild,id,emoji){
      const group=get(guild.id,id);const key=parseEmoji(emoji).key;const entry=group.entries.find(e=>e.key===key);must(entry,RR.emojiMissing);
      group.entries=group.entries.filter(e=>e!==entry);
      const msg=await fetchMessage(guild,group).catch(()=>null);
      if(msg){await msg.reactions.cache.get(key)?.users.remove(client.user.id).catch(()=>{});await refresh(guild,group,msg).catch(()=>{});}
      return save(guild.id,group);
    },
    /** Replace all entries (dashboard editor). */
    async setEntries(guild,id,entries,actor){
      const group=get(guild.id,id);must(Array.isArray(entries)&&entries.length<=RR_LIMITS.entries,RR.entryLimit);
      const next={...group,entries:[]};
      for(const x of entries)next.entries.push(await entryFrom(guild,next,x,actor));
      const msg=await fetchMessage(guild,group);await checkBot(guild,msg.channel);
      for(const e of next.entries)if(!group.entries.some(o=>o.key===e.key))await react(msg,e);
      for(const o of group.entries)if(!next.entries.some(e=>e.key===o.key))await msg.reactions.cache.get(o.key)?.users.remove(client.user.id).catch(()=>{});
      await refresh(guild,next,msg);return save(guild.id,next);
    },
    async edit(guild,id,options){
      const group=normalizeOptions(options,get(guild.id,id));
      if(options.requiredRole)await checkRole(guild,group.requiredRole,null);
      await refresh(guild,group);return save(guild.id,group);
    },
    async remove(guild,id){
      const group=get(guild.id,id);store.remove(guild.id,'reaction-role',id);
      for(const t of store.list(guild.id,'rr-temp'))if(t.group===id)store.remove(guild.id,'rr-temp',t.id);
      if(group.owned){const msg=await fetchMessage(guild,group).catch(()=>null);await msg?.delete().catch(()=>{});}
      return group;
    },
    markBroken(guildId,predicate,reason){
      for(const g of store.list(guildId,'reaction-role'))if(predicate(g)&&g.broken!==reason){g.broken=reason;store.put(guildId,'reaction-role',g);}
    },
    /** Gateway handler for messageReactionAdd/Remove. Never posts in channels; failures are logged. */
    async onReaction(reaction,user,added){
      try{
        if(user.bot)return;
        if(reaction.partial)reaction=await reaction.fetch();
        const guild=reaction.message.guild;if(!guild)return;
        if(!pluginEnabled(store,guild.id,'reactionroles'))return;
        const group=store.list(guild.id,'reaction-role').find(g=>g.message===reaction.message.id);if(!group)return;
        const key=reactionKey(reaction.emoji);if(!group.entries.some(e=>e.key===key))return;
        const member=await guild.members.fetch(user.id);
        const roles=new Set(member.roles.cache.keys());
        const plan=planReaction(group,key,roles,added);
        if(plan.denied){log.log(`Reaction role not given (${plan.denied}) in server ${guild.id}.`);if(plan.removeReaction)await reaction.users.remove(user.id).catch(()=>{});return;}
        const missing=[...plan.add,...plan.remove].filter(r=>!guild.roles.cache.has(r));
        if(missing.length){api.markBroken(guild.id,g=>g.id===group.id,'A role on this message was deleted.');return;}
        if(plan.remove.length)await member.roles.remove(plan.remove,'Reaction roles');
        if(plan.add.length)await member.roles.add(plan.add,'Reaction roles');
        for(const r of plan.remove)store.remove(guild.id,'rr-temp',`${user.id}-${r}`);
        if(group.duration)for(const r of plan.add)store.put(guild.id,'rr-temp',{id:`${user.id}-${r}`,user:user.id,role:r,group:group.id,expires:now()+group.duration*60000});
        for(const k of plan.clearReactions)await reaction.message.reactions.cache.get(k)?.users.remove(user.id).catch(()=>{});
      }catch(error){
        log.warn(`Reaction role update failed${error.code?` (${error.code})`:''}.`);
        if(added)await reaction.users?.remove?.(user.id).catch(()=>{});
      }
    },
    /** Removes expired temporary roles. Expiries are persisted, so this also restores timers after a restart. */
    async sweep(){
      for(const t of store.all('rr-temp')){
        if(t.expires>now())continue;
        const {guild:guildId}=t;
        try{
          const guild=client.guilds.cache.get(guildId);if(!guild)continue;
          const member=await guild.members.fetch(t.user).catch(e=>{if(String(e.code)==='10007')return null;throw e;});
          if(member&&member.roles.cache.has(t.role))await member.roles.remove(t.role,'Temporary reaction role expired');
          store.remove(guildId,'rr-temp',t.id);
        }catch(error){
          const tries=(t.tries||0)+1;
          if(tries>=10||String(error.code)==='10011')store.remove(guildId,'rr-temp',t.id);else{const {guild,...rest}=t;store.put(guildId,'rr-temp',{...rest,tries,expires:now()+60000});}
          log.warn(`Temporary reaction role removal failed${error.code?` (${error.code})`:''}.`);
        }
      }
    },
    start(intervalMs=30000){
      api.sweep();const timer=setInterval(()=>api.sweep(),intervalMs);timer.unref?.();
      return ()=>clearInterval(timer);
    },
  };
  return api;
}
