// General dashboard plugin APIs. Runs inside the same process as the bot (src/index.js)
// and reuses the bot's Store and discord.js client instead of opening a second database.
// Errors use the dashboard's Fault type (HTTP status + website copy); they never reach Discord.
import {randomUUID} from 'node:crypto';
import {IANAZone} from 'luxon';
import {Fault,assert} from '../age-verification/core.js';
import {Moderation,defaults as modDefaults} from './moderation-core.js';
import {DEFAULT_ZONE} from './domain.js';
import {deliveryLabel} from './weekly-feeds.js';
import {TOGGLEABLE_PLUGINS,pluginStates,setPluginEnabled} from './plugins.js';
import {createReactionRoles,RR_LIMITS} from './reaction-roles.js';

export const PLUGINS=Object.freeze(['overview','moderation','automod','embeds','scheduler','instagram','reactionroles','verification','access','settings']);
const commandsFor={
  moderation:['/ban','/kick','/warn','/timeout','/purge','/warnings','/modlogs','/case','/appeals','/emergency','/mod-settings'],
  automod:['/mod-settings automod','/mod-settings block-invites','/mod-settings blocked-words','/mod-settings mention-limit','/mod-settings spam-limit'],
  embeds:['/embed create','/embed edit','/embed send','/embed list','/embed delete'],
  scheduler:['/schedule add','/schedule list','/schedule show','/schedule edit','/schedule cancel','/settings timezone'],
  instagram:['/instagram setup','/instagram list','/instagram preview','/instagram pause','/instagram resume','/instagram remove'],
  reactionroles:['/reaction-roles create','/reaction-roles attach','/reaction-roles add','/reaction-roles remove','/reaction-roles edit','/reaction-roles delete','/reaction-roles list'],
  access:['/access'],settings:['/settings timezone','/settings status','/help','/portal']
};
const text=(value,max=200)=>String(value??'').slice(0,max);
const only=(data,allowed)=>assert(data&&Object.keys(data).every(k=>allowed.includes(k)),400,'Unsupported fields for this plugin.');

export function createDashboardApi({store,client=null,env=process.env,demo=false}={}) {
  const available=()=>assert(store,503,'Bot settings are unavailable on this dashboard instance. Use slash commands in Discord.');
  const cached=guild=>client?.guilds?.cache?.get?.(guild)||null;
  function hasBot(guild){
    if(demo)return guild==='111111111111111111';
    if(!client?.isReady?.())return null;
    return !!cached(guild);
  }
  function label(guild,kind,id){
    if(!id)return null;const g=cached(guild);
    const name=kind==='role'?g?.roles?.cache?.get(id)?.name:g?.channels?.cache?.get(id)?.name;
    return {id,name:name?text(name,100):null};
  }
  const settings=guild=>store.get(guild,'settings','main')||{id:'main',zone:DEFAULT_ZONE};
  const modConfig=guild=>({...modDefaults,...store.get(guild,'mod-config','main')});
  const reactionRoles=createReactionRoles({store,client});
  // Shared validation throws UserError with reviewed copy; surface it as a 400 on the website.
  async function rr(work){try{return await work();}catch(error){if(error?.name==='UserError')throw new Fault(400,error.message);throw new Fault(502,'Discord did not accept the change. Check the bot’s permissions and try again.');}}
  function rrGuild(guild){const g=cached(guild);assert(g,503,'The bot must be online and in this server to change reaction roles.');return g;}
  function rrView(guild){
    const g=cached(guild),me=g?.members?.me;
    const channels=g?[...g.channels.cache.values()].filter(c=>[0,5].includes(c.type)).map(c=>({id:c.id,name:text(c.name,100)})):[];
    const roles=g?[...g.roles.cache.values()].filter(r=>r.id!==g.id&&!r.managed).sort((a,b)=>b.position-a.position).map(r=>({id:r.id,name:text(r.name,100),assignable:!!me&&r.position<me.roles.highest.position})):[];
    return {limits:RR_LIMITS,channels,roles,botReady:!!g,
      items:store.list(guild,'reaction-role').map(x=>({id:x.id,title:text(x.title||'Reaction roles',256),description:text(x.description,2000),channel:label(guild,'channel',x.channel),message:x.message,owned:!!x.owned,mode:x.mode,maxRoles:x.maxRoles||0,duration:x.duration||0,removeOnUnreact:x.removeOnUnreact!==false,requiredRole:label(guild,'role',x.requiredRole),
        entries:x.entries.map(e=>({emoji:text(e.display,64),role:label(guild,'role',e.role)})),broken:x.broken?text(x.broken,120):null,link:`https://discord.com/channels/${guild}/${x.channel}/${x.message}`}))};
  }
  const automodAvailable=()=>env.MODERATION_MESSAGE_CONTENT==='1';

  function overview(guild,{verification}={}){
    const now=Date.now(),cases=store.list(guild,'mod-case'),events=store.list(guild,'event');
    return {
      plugins:pluginStates(store,guild),toggleable:TOGGLEABLE_PLUGINS,botPresent:hasBot(guild),
      stats:{
        moderationCases:cases.length,casesNeedingReview:cases.filter(c=>['pending','uncertain'].includes(c.state)).length,
        openAppeals:store.list(guild,'mod-appeal').filter(a=>a.state==='open').length,
        automod:!!modConfig(guild).automod,embeds:store.list(guild,'embed').length,
        upcomingEvents:events.filter(e=>!e.cancelled&&!e.complete&&e.start+e.duration*60000>now).length,
        instagramSources:store.list(guild,'feed').length,accessGrants:store.list(guild,'access').length,
        deliveryProblems:store.problems(guild).length
      },
      timezone:settings(guild).zone||DEFAULT_ZONE,verification:verification||null
    };
  }
  function plugin(guild,name){
    const enabled=TOGGLEABLE_PLUGINS.includes(name)?pluginStates(store,guild)[name]:null;
    const base={plugin:name,enabled,toggleable:TOGGLEABLE_PLUGINS.includes(name),commands:commandsFor[name]||[]};
    if(name==='moderation'){
      const cfg=modConfig(guild);
      return {...base,editable:false,config:{modRole:label(guild,'role',cfg.modRole),privacyRole:label(guild,'role',cfg.privacyRole),logChannel:label(guild,'channel',cfg.logChannel),retentionDays:cfg.retentionDays},
        recentCases:store.list(guild,'mod-case').sort((a,b)=>b.created-a.created).slice(0,15).map(c=>({id:text(c.id,40),action:text(c.action,40),target:text(c.target,40),actor:text(c.actor,40),state:text(c.state,20),created:c.created})),
        locks:store.list(guild,'mod-lock').length};
    }
    if(name==='automod'){
      const cfg=modConfig(guild);
      return {...base,editable:true,ownerOnly:true,messageContentAvailable:automodAvailable(),config:{automod:!!cfg.automod,blockInvites:!!cfg.blockInvites,mentionLimit:cfg.mentionLimit,spamLimit:cfg.spamLimit,blockedWords:(cfg.blockedWords||[]).map(w=>text(w,100))}};
    }
    if(name==='embeds')return {...base,editable:false,items:store.list(guild,'embed').map(d=>({id:d.id,name:text(d.name,80),title:text(d.embed?.title,256),updatedAt:d.updatedAt||null}))};
    if(name==='scheduler'){
      const now=Date.now();
      return {...base,editable:false,timezone:settings(guild).zone||DEFAULT_ZONE,items:store.list(guild,'event').filter(e=>!e.cancelled&&!e.complete&&e.start+e.duration*60000>now).sort((a,b)=>a.start-b.start).slice(0,50)
        .map(e=>({id:e.id,title:text(e.title,150),start:e.start,zone:e.zone,kind:e.kind||'event',repeat:e.repeat||'none',duration:e.duration,channel:label(guild,'channel',e.channel),needsAttention:!!e.error}))};
    }
    if(name==='instagram')return {...base,editable:false,items:store.list(guild,'feed').map(f=>({id:f.id,name:text(f.name,100),channel:label(guild,'channel',f.channel),paused:!!f.paused,schedule:f.paused?'Paused':text(deliveryLabel(f),120),waiting:f.pending?.length||0,needsAttention:!!f.error}))};
    if(name==='reactionroles')return {...base,editable:true,...rrView(guild)};
    if(name==='access')return {...base,editable:false,ownerManaged:true,items:store.list(guild,'access').map(a=>({user:a.id,grantedBy:a.grantedBy||null,grantedAt:a.grantedAt||null}))};
    if(name==='settings'){const s=settings(guild);return {...base,editable:true,timezone:s.zone||DEFAULT_ZONE,logChannel:label(guild,'channel',s.logChannel)};}
    throw new Fault(404,'Unknown dashboard plugin.');
  }
  async function update(guild,name,data,identity){
    if(name==='reactionroles'&&data&&!('enabled' in data)){
      only(data,['create','update','delete']);assert(Object.keys(data).length===1,400,'Make one change at a time.');
      const g=rrGuild(guild),actor={id:identity.id,owner:!!identity.owner};
      const opts=o=>{only(o,['id','channel','message','title','description','mode','maxRoles','duration','removeOnUnreact','requiredRole','entries']);
        for(const k of ['channel','message','requiredRole','id'])assert(o[k]==null||(typeof o[k]==='string'&&o[k].length<=200),400,'Invalid field.');
        assert(o.entries===undefined||Array.isArray(o.entries)&&o.entries.every(e=>e&&typeof e.emoji==='string'&&e.emoji.length<=64&&/^\d{17,20}$/.test(e.role)),400,'Each row needs an emoji and a role.');
        const {id,entries,channel,message,...rest}=o;return {id,entries,channel,message,rest};};
      if(data.create){const o=opts(data.create);await rr(()=>reactionRoles.create(g,{channel:o.channel,message:o.message||null,entries:o.entries||[],...o.rest},actor));}
      if(data.update){const o=opts(data.update);assert(o.id,400,'Choose a reaction-role message.');await rr(async()=>{await reactionRoles.edit(g,o.id,o.rest);if(o.entries)await reactionRoles.setEntries(g,o.id,o.entries,actor);});}
      if(data.delete){assert(typeof data.delete==='string',400,'Choose a reaction-role message.');await rr(()=>reactionRoles.remove(g,data.delete));}
      return plugin(guild,name);
    }
    only(data,name==='automod'?['enabled','automod','blockInvites','mentionLimit','spamLimit','blockedWords']:name==='settings'?['timezone']:['enabled']);
    if('enabled' in data&&name!=='automod'){
      assert(TOGGLEABLE_PLUGINS.includes(name),400,'This section cannot be turned off.');assert(typeof data.enabled==='boolean',400,'Choose on or off.');
      setPluginEnabled(store,guild,name,data.enabled,identity.id);
    }
    if(name==='settings'&&'timezone' in data){
      assert(typeof data.timezone==='string'&&data.timezone.length<=64&&IANAZone.isValidZone(data.timezone),400,'Choose a valid IANA timezone, such as America/New_York.');
      store.put(guild,'settings',{...settings(guild),id:'main',zone:data.timezone});
    }
    if(name==='automod'){
      // Mirrors /mod-settings: only the current owner configures moderation policy.
      assert(identity.owner,403,'Only the current server owner can change automod settings.');
      const patch={};
      if('enabled' in data)data={...data,automod:data.enabled};
      if('automod' in data){assert(typeof data.automod==='boolean',400,'Choose on or off.');patch.automod=data.automod;}
      if('blockInvites' in data){assert(typeof data.blockInvites==='boolean',400,'Choose on or off for the invite filter.');patch.blockInvites=data.blockInvites;}
      if('mentionLimit' in data){assert(Number.isInteger(data.mentionLimit)&&data.mentionLimit>=1&&data.mentionLimit<=50,400,'Mention limit must be 1 to 50.');patch.mentionLimit=data.mentionLimit;}
      if('spamLimit' in data){assert(Number.isInteger(data.spamLimit)&&data.spamLimit>=3&&data.spamLimit<=30,400,'Spam limit must be 3 to 30 messages.');patch.spamLimit=data.spamLimit;}
      if('blockedWords' in data){assert(typeof data.blockedWords==='string'&&data.blockedWords.length<=1000,400,'Blocked words must be a comma-separated list up to 1000 characters.');patch.blockedWords=data.blockedWords.split(',').map(w=>w.trim()).filter(Boolean).slice(0,100);}
      assert(!patch.automod||automodAvailable(),409,'Automod needs the bot operator to enable Message Content Intent first.');
      if(Object.keys(patch).length){
        const core=new Moderation(store);
        const result=await core.run({guild,id:'dash-'+randomUUID().slice(0,12),actor:identity.id,target:'configuration',action:'configure',reason:'Updated automod policy on the dashboard',details:{before:modConfig(guild),patch},effect:()=>core.saveConfig(guild,patch)});
        assert(result.state==='succeeded',500,'Automod settings could not be saved.');
      }
    }
    return plugin(guild,name);
  }
  return {
    hasBot,
    async handle({method,endpoint,data,guild,identity,verification}){
      if(endpoint!=='overview'&&!endpoint.startsWith('plugins/'))return undefined;
      assert(identity.manager,403,'Server owner, Administrator or Manage Server permission required to manage this server.');
      available();
      if(endpoint==='overview'){assert(method==='GET',405,'Method not allowed.');return overview(guild,{verification});}
      const name=endpoint.slice('plugins/'.length);
      assert(PLUGINS.includes(name)&&!['overview','verification'].includes(name),404,'Unknown dashboard plugin.');
      if(method==='GET')return plugin(guild,name);
      assert(method==='PUT',405,'Method not allowed.');
      return update(guild,name,data,identity);
    }
  };
}
