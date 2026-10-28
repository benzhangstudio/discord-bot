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
import {modlogConfig,saveModlog,missingPermissions,enabledEmbed,MODLOG_EVENTS,EVENT_KEYS} from './modlog.js';
import {createReactionRoles,RR_LIMITS} from './reaction-roles.js';
import {actionName,statusOf} from './mod-format.js';
import {createDashboardFeatures} from './dashboard-features.js';

export const PLUGINS=Object.freeze(['overview','moderation','automod','embeds','scheduler','instagram','reactionroles','verification','access','settings']);
const commandsFor={
  moderation:['/ban','/unban','/kick','/warn','/unwarn','/timeout','/untimeout','/purge','/case','/lockdown'],
  automod:[],
  embeds:['/embed create','/embed edit','/embed send','/embed list','/embed delete'],
  scheduler:['/schedule add','/schedule list','/schedule show','/schedule edit','/schedule post','/schedule cancel','/settings'],
  instagram:['/instagram setup','/instagram list','/instagram preview','/instagram pause','/instagram resume','/instagram remove'],
  settings:['/settings','/help','/dashboard']
};
const text=(value,max=200)=>String(value??'').slice(0,max);
const only=(data,allowed)=>assert(data&&Object.keys(data).every(k=>allowed.includes(k)),400,'Unsupported fields for this plugin.');

export function createDashboardApi({store,client=null,env=process.env,demo=false,accessTimeoutMs=8000}={}) {
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
  const features=createDashboardFeatures({store,client,authorize:reauthorize});
  const delegated=(guild,id,ownerId)=>!!ownerId&&store?.get(guild,'dashboard-access',id)?.grantedBy===ownerId;
  function dashboardIdentity(guild,identity){
    const dashboard=!!identity.owner||delegated(guild,identity.id,identity.ownerId);
    return {...identity,dashboard,manager:dashboard};
  }
  async function reauthorize(guild,identity){
    if(identity.reauthorize)return identity.reauthorize();
    const g=cached(guild);assert(g,503,'The bot must be online and in this server to save changes.');
    let timer;
    try{
      const [fresh,member]=await Promise.race([
        Promise.all([g.fetch(),g.members.fetch({user:identity.id,force:true})]),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Fault(504,'Discord took too long. No changes were saved.')),accessTimeoutMs);})
      ]);
      assert(member?.id===identity.id&&(fresh.ownerId===identity.id||delegated(guild,identity.id,fresh.ownerId)),403,'Your dashboard access was removed.');
    }catch(error){if(error instanceof Fault)throw error;throw new Fault(403,'Could not confirm your dashboard access. Sign in again.');}
    finally{clearTimeout(timer);}
  }
  // Shared validation throws UserError with reviewed copy; surface it as a 400 on the website.
  async function rr(work){try{return await work();}catch(error){if(error?.name==='UserError')throw new Fault(400,error.message);throw new Fault(502,'Discord did not accept the change. Check the bot’s permissions and try again.');}}
  function rrGuild(guild){const g=cached(guild);assert(g,503,'The bot must be online and in this server to change reaction roles.');return g;}
  function rrView(guild){
    const g=cached(guild),me=g?.members?.me;
    const channels=g?[...g.channels.cache.values()].filter(c=>[0,5].includes(c.type)).map(c=>({id:c.id,name:text(c.name,100)})):[];
    const roles=g?[...g.roles.cache.values()].filter(r=>r.id!==g.id&&!r.managed).sort((a,b)=>b.position-a.position).map(r=>({id:r.id,name:text(r.name,100),assignable:!!me&&r.position<me.roles.highest.position})):[];
    return {limits:RR_LIMITS,channels,roles,botReady:!!g,drafts:store.list(guild,'reaction-role-draft'),
      items:store.list(guild,'reaction-role').map(x=>({id:x.id,title:text(x.title||'Reaction roles',256),description:text(x.description,2000),channel:label(guild,'channel',x.channel),message:x.message,owned:!!x.owned,mode:x.mode,maxRoles:x.maxRoles||0,duration:x.duration||0,removeOnUnreact:x.removeOnUnreact!==false,requiredRole:label(guild,'role',x.requiredRole),
        entries:x.entries.map(e=>({emoji:text(e.display,64),role:label(guild,'role',e.role)})),broken:x.broken?text(x.broken,120):null,link:`https://discord.com/channels/${guild}/${x.channel}/${x.message}`}))};
  }
  const automodAvailable=()=>env.MODERATION_MESSAGE_CONTENT==='1';

  function overview(guild,{verification,identity}={}){
    const now=Date.now(),cases=new Moderation(store).cases(guild),events=store.list(guild,'event');
    return {
      plugins:pluginStates(store,guild),toggleable:TOGGLEABLE_PLUGINS,botPresent:hasBot(guild),
      stats:{
        moderationCases:cases.length,casesNeedingReview:cases.filter(c=>['pending','uncertain'].includes(c.state)).length,
        automod:!!modConfig(guild).automod,embeds:store.list(guild,'embed').length,
        upcomingEvents:events.filter(e=>!e.cancelled&&!e.complete&&e.start+e.duration*60000>now).length,
        instagramSources:store.list(guild,'feed').length,...(identity?.owner?{accessGrants:store.list(guild,'access').filter(a=>a.grantedBy===identity.id).length,dashboardGrants:store.list(guild,'dashboard-access').filter(a=>a.grantedBy===identity.id).length}:{}),
        deliveryProblems:store.problems(guild).length
      },
      timezone:settings(guild).zone||DEFAULT_ZONE,verification:verification||null
    };
  }
  // Mod Log settings (Moderation › Mod log). Managers may edit; shared with the bot via the 'modlog' record.
  function modlogView(guild){
    const m=modlogConfig(store,guild),g=cached(guild),ch=m.channel&&g?.channels?.cache?.get(m.channel);
    return {channel:label(guild,'channel',m.channel),enabled:m.enabled,events:m.events,eventList:MODLOG_EVENTS.map(([key,label])=>({key,label})),
      missingPermissions:ch?missingPermissions(ch,g.members?.me):[],
      auditLog:g?.members?.me?.permissions?.has?.(128n)??null};
  }
  function modlogChannel(guild,id){
    const g=cached(guild);assert(g,409,'The bot is not in this server.');
    const ch=g.channels.cache.get(id);assert(ch&&[0,5].includes(ch.type),400,'Choose a text or announcement channel.');
    const missing=missingPermissions(ch,g.members?.me);
    assert(!missing.length,400,`The bot needs ${missing.join(', ')} in #${text(ch.name,100)}.`);
    return ch;
  }
  async function modlogUpdate(guild,data,identity){
    const m=data.modlog;assert(m&&typeof m==='object'&&!Array.isArray(m),400,'Invalid mod log settings.');
    only(m,['channel','enabled','events','test']);
    if(m.test){
      const cfg=modlogConfig(store,guild),id=m.channel??cfg.channel;assert(typeof id==='string'&&/^\d{17,20}$/.test(id),400,'Choose a mod log channel first.');
      const ch=modlogChannel(guild,id);
      try{await Promise.race([ch.send({embeds:[{...enabledEmbed(cfg,identity.id),title:'Mod log test message',description:'The bot can post moderation records in this channel.'}],allowedMentions:{parse:[]}}),new Promise((_,r)=>setTimeout(()=>r(Object.assign(new Error('timeout'),{name:'TimeoutError'})),8000).unref?.())]);}
      catch(error){console.warn(`Mod log test message failed (${error.status||error.name}).`);throw new Fault(502,'Discord did not confirm the test message. Check the channel before trying again.');}
      return;
    }
    const patch={};
    if('channel' in m){assert(m.channel===null||typeof m.channel==='string'&&/^\d{17,20}$/.test(m.channel),400,'Choose a channel.');if(m.channel)modlogChannel(guild,m.channel);patch.channel=m.channel;}
    if('enabled' in m){assert(typeof m.enabled==='boolean',400,'Choose on or off.');patch.enabled=m.enabled;}
    if('events' in m){assert(m.events&&typeof m.events==='object'&&Object.entries(m.events).every(([k,v])=>EVENT_KEYS.includes(k)&&typeof v==='boolean'),400,'Invalid mod log actions.');patch.events=m.events;}
    const next={...modlogConfig(store,guild),...patch};
    assert(!next.enabled||next.channel,400,'Choose a mod log channel before turning it on.');
    if(next.enabled&&!('channel' in patch))modlogChannel(guild,next.channel);
    const cur=modlogConfig(store,guild);
    // Entries for actions taken while the log was off are never posted later.
    if(next.enabled&&!cur.enabled)for(const row of store.list(guild,'mod-log'))if(row.state==='queued')store.put(guild,'mod-log',{...row,state:'skipped'});
    saveModlog(store,guild,patch,identity.id);
  }
  function plugin(guild,name,identity){
    const enabled=TOGGLEABLE_PLUGINS.includes(name)?pluginStates(store,guild)[name]:null;
    const base={plugin:name,enabled,toggleable:TOGGLEABLE_PLUGINS.includes(name),commands:commandsFor[name]||[]};
    if(name==='moderation'){
      const cfg=modConfig(guild);
      const {channels,roles}=rrView(guild);
      return {...base,editable:true,ownerOnly:true,channels,roles,config:{modRole:label(guild,'role',cfg.modRole),privacyRole:label(guild,'role',cfg.privacyRole),retentionDays:cfg.retentionDays,dmMembers:cfg.dmMembers!==false},
        recentCases:new Moderation(store).cases(guild).slice(0,15).map(c=>({id:text(c.id,40),number:c.number||null,proof:(Array.isArray(c.details?.proof)?c.details.proof:[]).slice(0,10).map(p=>({type:p.type==='image'?'image':'link',url:/^https:\/\//.test(String(p.storedUrl||p.url))?text(p.storedUrl||p.url,600):null,logMessage:p.logMessage&&/^https:\/\/discord\.com\//.test(p.logMessage)?text(p.logMessage,200):null})).filter(p=>p.url),action:text(c.action,40),actionLabel:actionName(c.action),targetLabel:text(c.details?.memberName||cached(guild)?.members?.cache?.get?.(c.target)?.displayName||client?.users?.cache?.get?.(c.target)?.username||'Member',100),moderatorLabel:text(client?.users?.cache?.get?.(c.actor)?.username||'Moderator',100),statusLabel:statusOf(c),target:text(c.target,40),actor:text(c.actor,40),state:text(c.state,20),created:c.created})),
        locks:store.list(guild,'mod-lock').length,modlog:modlogView(guild)};
    }
    if(name==='automod'){
      const cfg=modConfig(guild);
      return {...base,editable:true,ownerOnly:true,messageContentAvailable:automodAvailable(),config:{automod:!!cfg.automod,blockInvites:!!cfg.blockInvites,mentionLimit:cfg.mentionLimit,spamLimit:cfg.spamLimit,blockedWords:(cfg.blockedWords||[]).map(w=>text(w,100))}};
    }
    if(['embeds','scheduler','instagram'].includes(name))return {...base,...features.view(guild,name)};
    if(name==='reactionroles')return {...base,editable:true,...rrView(guild)};
    if(name==='access'){
      const ownerId=identity?.owner?identity.id:cached(guild)?.ownerId;
      const grants=kind=>store.list(guild,kind).filter(a=>a.grantedBy===ownerId).map(a=>({user:a.id,grantedBy:a.grantedBy,grantedAt:a.grantedAt||null}));
      return {...base,editable:true,ownerManaged:true,limit:100,dashboardLimit:100,items:grants('access'),dashboardItems:grants('dashboard-access')};
    }
    if(name==='settings'){const s=settings(guild);return {...base,editable:true,timezone:s.zone||DEFAULT_ZONE,logChannel:label(guild,'channel',s.logChannel)};}
    throw new Fault(404,'Unknown dashboard plugin.');
  }
  async function update(guild,name,data,identity){
    if(name==='access'){
      assert(identity.owner,403,'Only the current server owner can manage access.');
      only(data,['add','remove','dashboardAdd','dashboardRemove']);assert(Object.keys(data).length===1,400,'Choose one member to add or remove.');
      const key=Object.keys(data)[0],action=['add','dashboardAdd'].includes(key)?'add':'remove',id=data[key],kind=key.startsWith('dashboard')?'dashboard-access':'access';
      assert(typeof id==='string'&&/^\d{17,20}$/.test(id),400,'Enter a valid Discord user ID.');
      const g=cached(guild);assert(g,503,'The bot must be online and in this server to manage access.');
      // Bound lookups and recheck ownership after asynchronous work, before any write.
      async function lookup(work){
        let timer;
        try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Fault(504,'Discord took too long. No access changes were saved.')),accessTimeoutMs);})]);}
        catch(error){if(error instanceof Fault)throw error;throw new Fault(502,'Could not verify this server or member with Discord. No access changes were saved.');}
        finally{clearTimeout(timer);}
      }
      if(action==='add'){
        const member=await lookup(async()=>{try{return await g.members.fetch({user:id,force:true});}catch(error){if(error.code===10007||error.status===404)throw new Fault(400,'Choose a current human member of this server.');throw error;}});
        assert(member?.id===id&&member.user&&!member.user.bot,400,'Choose a current human member of this server.');
      }
      const fresh=await lookup(()=>g.fetch());
      assert(fresh.ownerId===identity.id,403,'Only the current server owner can manage access.');
      if(action==='remove')store.remove(guild,kind,id);
      else{
        assert(store.get(guild,kind,id)||store.list(guild,kind).filter(a=>a.grantedBy===identity.id).length<100,400,'This server already has 100 approved members. Remove someone before adding another.');
        const existing=store.get(guild,kind,id);
        if(existing?.grantedBy!==identity.id)store.put(guild,kind,{id,grantedBy:identity.id,grantedAt:Date.now()});
      }
      return plugin(guild,name,identity);
    }
    if(['embeds','scheduler','instagram'].includes(name)&&Object.keys(data||{}).some(key=>key!=='enabled')){
      assert(!('enabled' in data),400,'Save feature settings separately from the plugin switch.');
      await features.update(guild,name,data,identity);
      return plugin(guild,name);
    }
    if(name==='reactionroles'&&data&&!('enabled' in data)){
      only(data,['create','update','delete','draft','deleteDraft','publishDraft']);assert(Object.keys(data).length===1,400,'Make one change at a time.');
      if(data.draft){
        const draft=data.draft;only(draft,['id','target','channel','message','title','description','mode','maxRoles','duration','removeOnUnreact','requiredRole','entries']);
        assert(draft.id===undefined||typeof draft.id==='string'&&!!store.get(guild,'reaction-role-draft',draft.id),404,'Saved draft not found in this server.');
        assert(draft.target==null||typeof draft.target==='string'&&!!store.get(guild,'reaction-role',draft.target),404,'The original reaction-role setup is no longer available in this server.');
        for(const [key,max] of [['channel',20],['message',200],['title',256],['description',2000],['duration',10],['requiredRole',20]])assert(draft[key]==null||typeof draft[key]==='string'&&draft[key].length<=max,400,'One of the draft fields is too long.');
        assert(draft.mode==null||['normal','unique'].includes(draft.mode),400,'Choose normal or unique mode.');
        assert(draft.maxRoles==null||Number.isInteger(draft.maxRoles)&&draft.maxRoles>=0&&draft.maxRoles<=20,400,'Max roles must be 0 to 20.');
        assert(draft.removeOnUnreact===undefined||typeof draft.removeOnUnreact==='boolean',400,'Choose on or off.');
        assert(draft.entries===undefined||Array.isArray(draft.entries)&&draft.entries.length<=20&&draft.entries.every(e=>e&&Object.keys(e).every(k=>['emoji','role'].includes(k))&&typeof e.emoji==='string'&&e.emoji.length<=64&&typeof e.role==='string'&&e.role.length<=20),400,'Use up to 20 emoji and role rows.');
        assert(draft.id||store.list(guild,'reaction-role-draft').length<50,400,'This server already has 50 drafts. Remove one before saving another.');
        const id=draft.id||randomUUID();
        store.put(guild,'reaction-role-draft',{...draft,id,updatedBy:identity.id,updatedAt:Date.now()});
        return {...plugin(guild,name),savedDraft:id};
      }
      if(data.deleteDraft){assert(typeof data.deleteDraft==='string',400,'Choose a saved draft.');store.remove(guild,'reaction-role-draft',data.deleteDraft);return plugin(guild,name);}
      const g=rrGuild(guild),actor={id:identity.id,owner:!!identity.owner};
      if(data.publishDraft){
        assert(typeof data.publishDraft==='string',400,'Choose a saved draft.');
        const draft=store.get(guild,'reaction-role-draft',data.publishDraft);assert(draft,404,'Saved draft not found in this server.');
        const {id,target,updatedBy,updatedAt,...options}=draft;
        if(target){const {channel,message,entries,...settings}=options;await rr(async()=>{await reactionRoles.edit(g,target,settings);if(entries)await reactionRoles.setEntries(g,target,entries,actor);});}
        else await rr(()=>reactionRoles.create(g,{...options,requestId:'draft-'+id},actor));
        store.remove(guild,'reaction-role-draft',id);return plugin(guild,name);
      }
      const opts=o=>{only(o,['id','channel','message','title','description','mode','maxRoles','duration','removeOnUnreact','requiredRole','entries']);
        for(const k of ['channel','message','requiredRole','id'])assert(o[k]==null||(typeof o[k]==='string'&&o[k].length<=200),400,'Invalid field.');
        assert(o.entries===undefined||Array.isArray(o.entries)&&o.entries.every(e=>e&&typeof e.emoji==='string'&&e.emoji.length<=64&&/^\d{17,20}$/.test(e.role)),400,'Each row needs an emoji and a role.');
        const {id,entries,channel,message,...rest}=o;return {id,entries,channel,message,rest};};
      if(data.create){const o=opts(data.create);await rr(()=>reactionRoles.create(g,{channel:o.channel,message:o.message||null,entries:o.entries||[],...o.rest},actor));}
      if(data.update){const o=opts(data.update);assert(o.id,400,'Choose a reaction-role message.');await rr(async()=>{await reactionRoles.edit(g,o.id,o.rest);if(o.entries)await reactionRoles.setEntries(g,o.id,o.entries,actor);});}
      if(data.delete){assert(typeof data.delete==='string',400,'Choose a reaction-role message.');await rr(()=>reactionRoles.remove(g,data.delete));}
      return plugin(guild,name);
    }
    only(data,name==='automod'?['enabled','automod','blockInvites','mentionLimit','spamLimit','blockedWords']:name==='moderation'?['enabled','modRole','privacyRole','retentionDays','dmMembers','modlog']:name==='settings'?['timezone']:['enabled']);
    if('enabled' in data&&name!=='automod'){
      assert(TOGGLEABLE_PLUGINS.includes(name),400,'This section cannot be turned off.');assert(typeof data.enabled==='boolean',400,'Choose on or off.');
      setPluginEnabled(store,guild,name,data.enabled,identity.id);
    }
    if(name==='settings'&&'timezone' in data){
      assert(typeof data.timezone==='string'&&data.timezone.length<=64&&IANAZone.isValidZone(data.timezone),400,'Choose a valid IANA timezone, such as America/New_York.');
      store.put(guild,'settings',{...settings(guild),id:'main',zone:data.timezone});
    }
    if(name==='moderation'&&'modlog' in data){assert(Object.keys(data).length===1,400,'Save mod log settings separately.');await modlogUpdate(guild,data,identity);return plugin(guild,name);}
    if(name==='moderation'&&Object.keys(data).some(k=>k!=='enabled')){
      // Moderation policy (formerly /mod-settings): only the current owner configures it; each change is a case.
      assert(identity.owner,403,'Only the current server owner can change moderation settings.');
      const g=cached(guild),cfg=modConfig(guild),patch={},snow=v=>v===null||typeof v==='string'&&/^\d{17,20}$/.test(v);
      for(const key of ['modRole','privacyRole'])if(key in data){
        assert(snow(data[key]),400,'Choose a role.');
        if(data[key]&&g){const r=g.roles.cache.get(data[key]);assert(r&&!r.managed&&r.id!==guild,400,'Choose a custom server role.');}
        patch[key]=data[key];
      }
      assert((patch.modRole??cfg.modRole)===null||(patch.modRole??cfg.modRole)!==(patch.privacyRole??cfg.privacyRole),400,'Protected and moderator roles must differ.');
      if('retentionDays' in data){assert(Number.isInteger(data.retentionDays)&&data.retentionDays>=30&&data.retentionDays<=3650,400,'Case retention must be 30 to 3650 days.');patch.retentionDays=data.retentionDays;}
      for(const k of ['dmMembers'])if(k in data){assert(typeof data[k]==='boolean',400,'Choose on or off.');patch[k]=data[k];}
      if(Object.keys(patch).length){
        const core=new Moderation(store);
        const result=await core.run({guild,id:'dash-'+randomUUID().slice(0,12),actor:identity.id,target:'configuration',action:'configure',reason:'Updated moderation settings on the dashboard',details:{before:cfg,patch},effect:()=>core.saveConfig(guild,patch)});
        assert(result.state==='succeeded',500,'Moderation settings could not be saved.');
      }
    }
    if(name==='automod'){
      // Only the current owner configures moderation policy. only the current owner configures moderation policy.
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
    // All bot role handlers share this Store instance. Read the live verification
    // policy instead of maintaining a second, potentially stale role registry.
    bindVerification(root){store.verificationRolePolicy=guild=>root.forGuild(guild).protectedRoles();},
    verificationRoleConflicts(guild,roles){
      return store.list(guild,'reaction-role').some(group=>(group.entries||[]).some(entry=>roles.includes(entry.role)))||
        store.list(guild,'rr-temp').some(entry=>roles.includes(entry.role));
    },
    dashboardIdentity,
    dashboardCandidate(guild,id){return cached(guild)?.ownerId===id||!!store?.get(guild,'dashboard-access',id);},
    async handle({method,endpoint,data,guild,identity,verification}){
      if(endpoint!=='overview'&&!endpoint.startsWith('plugins/'))return undefined;
      assert(identity.owner||identity.dashboard,403,'Only the server owner or members they approve can manage this dashboard.');
      available();
      if(endpoint==='overview'){assert(method==='GET',405,'Method not allowed.');return overview(guild,{verification,identity});}
      const name=endpoint.slice('plugins/'.length);
      assert(PLUGINS.includes(name)&&!['overview','verification'].includes(name),404,'Unknown dashboard plugin.');
      if(name==='access')assert(identity.owner,403,'Only the current server owner can manage access.');
      if(method==='GET')return plugin(guild,name,identity);
      assert(method==='PUT',405,'Method not allowed.');
      return update(guild,name,data,identity);
    }
  };
}
