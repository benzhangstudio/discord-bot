import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {Store} from '../src/store.js';
import {Moderation} from '../src/moderation-core.js';
import {createApp} from '../src/app.js';
import {moderationCommands} from '../src/moderation-commands.js';
import {durationMinutes} from '../src/moderation.js';
import {suggestions} from '../src/suggestions.js';
const never=()=>new Promise(()=>{});
const perm=bits=>new PermissionsBitField(bits);
const scenarios={
 warn:{},kick:{},ban:{},unban:{},untimeout:{},unmute:{},timeout:{duration:'10m'},mute:{duration:'1h'},purge:{count:10},
 case:{id:'saved'},warnings:{},modlogs:{},reason:{},delwarn:{},'mod-reconcile':{case:'uncertain',outcome:'failed'},
 'mod-settings view':{},'mod-settings set':{'retention-days':90},'mod-settings clear-role':{kind:'privacyRole'},
 'appeals panel':{},'appeals list':{},'appeals show':{appeal:'appeal'},'appeals review':{appeal:'appeal',decision:'accepted'},
 'appeals record':{statement:'Externally received appeal'},
 'emergency on':{},'emergency off':{},'emergency status':{},
};
function harness({authorized=true}={}){
 const store=new Store(':memory:'),client=new EventEmitter(),outputs=[],effects=[];
 client.guilds={cache:new Map()};client.user={id:'bot'};
 const member=(id,position,bits=[])=>({id,user:{id,bot:false},permissions:perm(bits),roles:{highest:{position},cache:new Map()},timeout:async()=>effects.push('timeout'),kick:async()=>effects.push('kick'),ban:async()=>effects.push('ban')});
 const actor=member('owner',20,authorized?[P.Administrator]:[]),bot=member('bot',30,[P.Administrator]),target=member('target',1);
 const overwrite={id:'guild',type:0,allow:perm([P.ViewChannel,P.SendMessages]),deny:perm([])};
 const channel={id:'channel',type:0,permissionsFor:m=>perm(m==='everyone'?[]:[P.Administrator]),send:async()=>effects.push('send'),messages:{fetch:async()=>new Map([['recent',{id:'recent',pinned:false,createdTimestamp:Date.now()}],['old',{id:'old',createdTimestamp:0}],['pinned',{id:'pinned',pinned:true,createdTimestamp:Date.now()}]])},bulkDelete:async ids=>{effects.push(ids);return new Map(ids.map(id=>[id,{}]));},permissionOverwrites:{cache:new Map([['guild',overwrite]]),edit:async(id,changes)=>{effects.push('overwrite');let o=channel.permissionOverwrites.cache.get(id);if(!o){o={id,type:0,allow:perm([]),deny:perm([])};channel.permissionOverwrites.cache.set(id,o);}for(const [name,value]of Object.entries(changes)){o.allow.remove(P[name]);o.deny.remove(P[name]);if(value===true)o.allow.add(P[name]);if(value===false)o.deny.add(P[name]);}}}};
 const guild={id:'guild',ownerId:authorized?'owner':'other-owner',fetch:async()=>guild,members:{me:bot,fetch:async opt=>((opt.user||opt)==='target'?target:actor),fetchMe:async()=>bot},roles:{everyone:'everyone',cache:new Map(),fetch:async()=>new Map()},channels:{fetch:async()=>channel,cache:new Map([['channel',channel]])},bans:{fetch:async()=>({})}};
 guild.members.unban=async()=>effects.push('unban');channel.guild=guild;client.guilds.cache.set(guild.id,guild);
 const app=createApp(client,store,{operationTimeoutMs:40,acknowledgementDelayMs:100});
 const core=app.moderation.core;
 store.put('guild','mod-case',{id:'saved',guild:'guild',actor:'original-mod',target:'target',action:'warn',reason:'Original reason',created:Date.now(),state:'succeeded',events:[]});
 store.put('guild','mod-case',{id:'uncertain',guild:'guild',actor:'original-mod',target:'other',action:'warn',reason:'Original reason',created:Date.now(),state:'uncertain',events:[]});
 core.appeal('guild','appeal','target','saved','Please review');
 let seq=0;
 function interaction(name,sub,values={}){
  if(sub&&typeof sub==='object'){values=sub;sub=undefined;}
  if(name==='mod')name=({history:'modlogs',note:'reason',void:'delwarn',reconcile:'mod-reconcile'})[sub]||sub;
  const v={user:name==='purge'?null:'target',id:'saved',case:'saved',duration:'10m',reason:'Test reason',...values};return {
  id:String(++seq),guildId:'guild',guild,channelId:'channel',user:actor.user,member:actor,memberPermissions:actor.permissions,commandName:name,
  inGuild:()=>true,isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,
  options:{getSubcommand:()=>sub,getUser:()=>v.user?{id:v.user}:null,getMember:()=>v.user==='target'?target:null,getString:k=>v[k]??null,getInteger:k=>v[k]??null,getBoolean:k=>v[k]??null,getRole:()=>null,getChannel:()=>channel},
  reply:async function(p){this.replied=true;outputs.push(p);},deferReply:async function(){this.deferred=true;},editReply:async p=>outputs.push(p),followUp:async p=>outputs.push(p),showModal:async p=>outputs.push(p.toJSON()),
 };}
 return {app,store,core,client,actor,bot,target,channel,outputs,effects,interaction,close(){app.stop();store.close();}};
}
test('moderation scenarios exactly cover every registered subcommand',()=>{
 assert.deepEqual(Object.keys(scenarios).sort(),moderationCommands.flatMap(c=>c.options.some(o=>o.type===1)?c.options.map(s=>c.name+' '+s.name):[c.name]).sort());
});
test('common commands are standalone with simple inputs and no mandatory purge confirmation',()=>{
 assert.ok(!moderationCommands.some(c=>c.name==='mod'));
 for(const name of ['ban','kick','warn','mute','timeout','purge','warnings','modlogs','case'])assert.ok(moderationCommands.find(c=>c.name===name).options.every(o=>o.type!==1));
 assert.deepEqual(moderationCommands.find(c=>c.name==='purge').options.filter(o=>o.required).map(o=>o.name),['count']);
 for(const c of moderationCommands){let optional=false;for(const o of c.options){if(o.type===1)continue;if(!o.required)optional=true;else assert.equal(optional,false,c.name);}}
});
test('human-readable durations accept common units and reject invalid or excessive values',()=>{
 for(const [value,minutes]of [['10m',10],['1h',60],['2d',2880],['4w',40320],[' 1 H ',60]])assert.equal(durationMinutes(value),minutes);
 for(const value of ['',0,'forever','-1h','1.5h','29d','0m','99999999999999999999w'])assert.throws(()=>durationMinutes(value),/duration/);
});
test('simple ban records an omitted reason and replies with a clear result',async()=>{
 const h=harness();try{await h.app.handle(h.interaction('ban',{reason:null}));const c=h.core.cases('guild').find(c=>c.action==='ban');assert.equal(c.reason,'No reason provided');assert.match(h.outputs.at(-1).content,/^Banned /);const e=h.outputs.at(-1).embeds[0];assert.equal(e.title,'Member banned');assert.equal(e.color,0x5865f2);assert.deepEqual(e.fields.map(f=>f.name),['User','Moderator','Reason','Case']);assert.ok(e.fields.at(-1).value.includes(c.id));}finally{h.close();}
});
test('warning list hides voided warnings while modlogs retains them',async()=>{
 const h=harness();try{await h.app.handle(h.interaction('delwarn'));await h.app.handle(h.interaction('warnings'));assert.match(h.outputs.at(-1).content,/No active warnings/);await h.app.handle(h.interaction('modlogs'));assert.match(h.outputs.at(-1).content,/voided/);}finally{h.close();}
});
test('case suggestions search by member name, scope servers, and deny unprivileged members',()=>{
 const h=harness();try{const c=h.core.get('guild','saved');c.details={memberName:'Alex'};h.store.put('guild','mod-case',c);const i=h.interaction('case');i.options.getFocused=()=>({name:'id',value:'Alex'});assert.deepEqual(suggestions(h.store,i,{canManage:true}).map(v=>v.value),['saved']);i.guildId='other';assert.deepEqual(suggestions(h.store,i,{canManage:true}),[]);i.guildId='guild';i.memberPermissions=perm([P.ManageGuild]);i.user={id:'manager'};assert.deepEqual(suggestions(h.store,i,{canManage:true}),[]);}finally{h.close();}
});
test('moderation rejections and uncertain outcomes show concise public errors, not case or server dumps',async()=>{
 for(const uncertain of [false,true]){
  const h=harness();try{
   h.target.ban=uncertain?never:async()=>{throw Object.assign(Error('SQLITE diagnostic Wispbyte restart at C:/private/.env'),{status:403,code:50013});};
   await h.app.handle(h.interaction('ban'));
   const message=h.outputs.at(-1).content;assert.ok(message.length<200);assert.doesNotMatch(message,/SQLITE|Wispbyte|\.env|50013|\bfailed\b|\buncertain\b|Reason:|Member:/);
   assert.match(message,uncertain?/Check the result/:/permissions/);
  }finally{h.close();}
 }
});
test('settings and emergency status show readable summaries without internal delivery state dumps',async()=>{
 const h=harness();try{
  await h.app.handle(h.interaction('mod-settings','view'));assert.match(h.outputs.at(-1).content,/Moderation settings/);assert.doesNotMatch(h.outputs.at(-1).content,/"id":|logChannel|retentionDays|queued|sending|uncertain/);
  h.store.put('guild','mod-lock',{id:'channel',state:'needs-review'});await h.app.handle(h.interaction('emergency','status'));assert.match(h.outputs.at(-1).content,/Needs review/);assert.doesNotMatch(h.outputs.at(-1).content,/needs-review/);
 }finally{h.close();}
});
test('purge member filter excludes other members without deleting pinned messages',async()=>{
 const h=harness();try{h.channel.messages.fetch=async()=>new Map([['a',{id:'a',author:{id:'target'},createdTimestamp:Date.now()}],['b',{id:'b',author:{id:'other'},createdTimestamp:Date.now()}],['c',{id:'c',pinned:true,author:{id:'target'},createdTimestamp:Date.now()}]]);await h.app.handle(h.interaction('purge',{count:20,user:'target'}));assert.deepEqual(h.effects,[['a']]);}finally{h.close();}
});
for(const [name,values]of Object.entries(scenarios)){
 test(`authorized scenario /${name} finishes`,async()=>{
  const h=harness();try{
   if(name==='emergency off')await h.app.handle(h.interaction('emergency','on'));
   if(name==='appeals record')h.store.remove('guild','mod-appeal','appeal');
   await h.app.handle(h.interaction(...name.split(' '),values));assert.ok(h.outputs.length);assert.ok(h.outputs.at(-1).flags===64||h.outputs.at(-1).flags===undefined);
  }finally{h.close();}
 });
 test(`unauthorized /${name} denies before reading options`,async()=>{
  const h=harness({authorized:false});try{const i=h.interaction(...name.split(' '),values);i.options=new Proxy({}, {get(){throw Error('Options accessed before authorization');}});await assert.rejects(h.app.handle(i),/permission/);assert.equal(h.effects.length,0);assert.ok(!i.privateResponse);}finally{h.close();}
 });
}
test('persistent cases deduplicate interactions, scope tenants, and keep append-only warning history',async()=>{
 const h=harness();try{
  const i=h.interaction('mod','warn');await h.app.handle(i);await h.app.handle({...i,replied:false});
  assert.equal(h.core.cases('guild').filter(c=>c.id===i.id).length,1);assert.throws(()=>h.core.get('other',i.id),/not found/);
  await h.app.handle(h.interaction('mod','void'));assert.equal(h.core.get('guild','saved').voided,true);assert.equal(h.core.get('guild','saved').reason,'Original reason');
 }finally{h.close();}
});
for(const step of ['guild','actor','bot','roles','target','mutation'])test(`never-settling ${step} request is bounded and cannot repeat a mutation`,async()=>{
 const h=harness();try{
  const guild=h.interaction('mod','kick').guild;
  if(step==='guild')guild.fetch=never;
  if(step==='actor')guild.members.fetch=never;
  if(step==='bot')guild.members.fetchMe=never;
  if(step==='roles')guild.roles.fetch=never;
  if(step==='target'){const previous=guild.members.fetch;guild.members.fetch=opt=>opt.user==='target'?never():previous(opt);}
  if(step==='mutation')h.target.kick=never;
  const i=h.interaction('mod','kick');
  if(step==='mutation'){await h.app.handle(i);assert.equal(h.core.get('guild',i.id).state,'uncertain');await assert.rejects(h.app.handle(h.interaction('mod','kick')),/earlier action/);}
  else await assert.rejects(h.app.handle(i),/respond/);
 }finally{h.close();}
});
for(const networkStep of ['channel','messages','ban-lookup','panel-send','overwrite','restore-fetch','modal'])test(`never-settling moderation ${networkStep} step finishes with error or an uncertain case`,async()=>{
 const h=harness();try{
  let i=h.interaction('mod','purge',{count:10,confirm:'yes'}),guild=i.guild;
  if(networkStep==='channel')guild.channels.fetch=never;
  if(networkStep==='messages')h.channel.messages.fetch=never;
  if(networkStep==='ban-lookup'){i=h.interaction('mod','unban');guild.bans.fetch=never;}
  if(networkStep==='panel-send'){i=h.interaction('appeals','panel');h.channel.send=never;}
  if(networkStep==='overwrite'){i=h.interaction('emergency','on');h.channel.permissionOverwrites.edit=never;}
  if(networkStep==='restore-fetch'){
   await h.app.handle(h.interaction('emergency','on'));i=h.interaction('emergency','off');let calls=0;guild.channels.fetch=()=>++calls===1?Promise.resolve(h.channel):never();
  }
  if(networkStep==='modal'){i.commandName=undefined;i.customId='mod-appeal-open';i.isChatInputCommand=()=>false;i.showModal=never;}
  if(['panel-send','overwrite','restore-fetch'].includes(networkStep)){await h.app.handle(i);assert.equal(h.core.get('guild',i.id).state,'uncertain');}
  else await assert.rejects(h.app.handle(i),/respond/);
 }finally{h.close();}
});
test('revoked access, owner changes, peer hierarchy, administrators and moderator roles are protected',async()=>{
 for(const variant of ['revoked','owner-change','peer','admin','mod-role']){
  const h=harness();try{
   if(variant==='revoked'){h.actor.permissions=perm([]);h.actor.id='revoked';h.actor.user={id:'revoked'};}
   if(variant==='owner-change'){h.actor.permissions=perm([P.ModerateMembers]);h.actor.id='grantee';h.actor.user={id:'grantee'};h.store.put('guild','access',{id:'grantee',grantedBy:'old-owner'});}
   if(variant==='peer'){h.target.roles.highest.position=30;}
   if(variant==='admin')h.target.permissions=perm([P.Administrator]);
   if(variant==='mod-role'){h.core.saveConfig('guild',{modRole:'moderator'});h.target.roles.cache.set('moderator',{});}
   await assert.rejects(h.app.handle(h.interaction('mod','ban')));assert.equal(h.effects.length,0);
  }finally{h.close();}
 }
});
test('purge excludes pinned and old messages and records exact selected IDs',async()=>{
 const h=harness();try{await h.app.handle(h.interaction('mod','purge',{count:100,confirm:'yes'}));assert.deepEqual(h.effects,[['recent']]);const c=h.core.cases('guild').find(c=>c.action==='purge');assert.equal(c.details.deleted,1);}finally{h.close();}
});
test('lockdown restores writing bits while preserving independent privacy changes',async()=>{
 const h=harness();try{
  const o=h.channel.permissionOverwrites.cache.get('guild');const before=o.allow.bitfield;
  await h.app.handle(h.interaction('emergency','on'));assert.equal(o.allow.has(P.SendMessages),false);
  o.allow.remove(P.ViewChannel);o.deny.add(P.ViewChannel);
  await h.app.handle(h.interaction('emergency','off'));assert.equal(o.allow.bitfield,before&~P.ViewChannel);assert.ok(o.deny.has(P.ViewChannel));assert.equal(h.store.list('guild','mod-lock').length,0);
 }finally{h.close();}
});
test('lockdown refuses conflicting writing changes and retains restoration journal',async()=>{
 const h=harness();try{
  await h.app.handle(h.interaction('emergency','on'));const o=h.channel.permissionOverwrites.cache.get('guild');o.allow.add(P.SendMessages);o.deny.remove(P.SendMessages);
  await h.app.handle(h.interaction('emergency','off'));assert.equal(h.store.get('guild','mod-lock','channel').state,'needs-review');assert.equal(h.core.cases('guild').find(c=>c.action==='emergency-off').state,'uncertain');
 }finally{h.close();}
});
test('appeals reject cross-server IDs, self review, original moderator and duplicate submissions',()=>{
 const h=harness();try{
  assert.throws(()=>h.core.appeal('other','x','target','saved','hi'),/not found/);
  assert.throws(()=>h.core.appeal('guild','x','target','saved','hi'),/already exists/);
  assert.throws(()=>h.core.review('guild','appeal','target','accepted','yes'),/different moderator/);
  assert.throws(()=>h.core.review('guild','appeal','original-mod','accepted','yes'),/different moderator/);
 }finally{h.close();}
});
test('automod detects literal phrases, invites, mention floods and spam with isolated guild windows',()=>{
 const store=new Store(':memory:'),core=new Moderation(store);try{
  core.saveConfig('a',{automod:true,blockedWords:['bad phrase'],spamLimit:3});
  assert.equal(core.filter('a','one','BAD PHRASE',0),'Blocked phrase');assert.equal(core.filter('a','two','https://discord.gg/abc',0),'Discord invite');assert.equal(core.filter('a','three','hello',10),'Excessive mentions');
  for(let n=0;n<3;n++)assert.equal(core.filter('a','four','hi',0),null);assert.equal(core.filter('a','four','hi',0),'Message flood');assert.equal(core.filter('b','four','hi',100),null);
 }finally{store.close();}
});
test('retention preserves unresolved operations and open appeals but deletes completed records',()=>{
 const h=harness();try{
  const old=Date.now()-400*86400000;for(const c of h.core.cases('guild')){c.created=old;h.store.put('guild','mod-case',c);}
  h.core.sweep();assert.ok(h.core.get('guild','saved'));assert.ok(h.core.get('guild','uncertain'));
  h.core.review('guild','appeal','owner','denied','Review complete');h.core.sweep();assert.throws(()=>h.core.get('guild','saved'),/not found/);
 }finally{h.close();}
});
test('maintenance does not retry an uncertain log send',async()=>{
 const h=harness();try{h.core.saveConfig('guild',{logChannel:'channel'});for(const row of h.store.list('guild','mod-log'))h.store.remove('guild','mod-log',row.id);h.store.put('guild','mod-log',{id:'saved',caseId:'saved',state:'queued'});let sends=0;h.channel.send=()=>{sends++;return never();};await h.app.moderation.tick();assert.equal(h.store.get('guild','mod-log','saved').state,'uncertain');await h.app.moderation.tick();assert.equal(sends,1);}finally{h.close();}
});
test('case and outbox rollback together when storage fails',()=>{
 const h=harness();try{const put=h.store.put.bind(h.store);h.store.put=(g,kind,v)=>{if(kind==='mod-log')throw Error('disk failure');return put(g,kind,v);};const c=h.core.get('guild','saved');assert.throws(()=>h.core.append('guild',c,'note','owner','new note'),/disk failure/);assert.equal(h.core.get('guild','saved').events.length,1);}finally{h.close();}
});
test('restart preserves cases, configuration and unresolved operation barriers',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'number-one-moderation-')),path=join(dir,'test.sqlite');let store;
 try{store=new Store(path);let core=new Moderation(store,{timeoutMs:5});core.saveConfig('guild',{modRole:'moderator'});await core.run({guild:'guild',id:'first',actor:'mod',target:'target',action:'ban',reason:'test',effect:never});store.close();store=new Store(path);core=new Moderation(store);assert.equal(core.config('guild').modRole,'moderator');assert.equal(core.get('guild','first').state,'uncertain');await assert.rejects(core.run({guild:'guild',id:'second',actor:'mod',target:'target',action:'ban',reason:'test'}),/earlier action/);}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('in-server appeal status replies publicly and cannot reveal another member’s appeal',async()=>{
 const h=harness();try{
  const i=h.interaction('component','');i.commandName=undefined;i.customId='mod-appeal-status-submit';i.isChatInputCommand=()=>false;i.user={id:'target'};i.fields={getTextInputValue:()=> 'saved'};await h.app.handle(i);assert.match(h.outputs.at(-1).content,/open/);assert.equal(h.outputs.at(-1).flags,undefined);
  i.user={id:'stranger'};await assert.rejects(h.app.handle(i),/No appeal found/);
 }finally{h.close();}
});
test('access removed during preflight prevents an already-prepared action',async()=>{
 const h=harness();try{const i=h.interaction('mod','ban');let fetches=0;i.guild.fetch=async()=>{if(++fetches===2){i.guild.ownerId='new-owner';h.actor.permissions=perm([]);}return i.guild;};await assert.rejects(h.app.handle(i),/access was removed/);assert.equal(h.effects.length,0);}finally{h.close();}
});
test('protected targets get an immediate error without network calls, a deferral or a warning case',async()=>{
 for(const target of ['owner','bot']){
  const h=harness();try{
   const i=h.interaction('warn',{user:target});let networkCalls=0,deferred=0;
   i.guild.fetch=async()=>{networkCalls++;throw Error('Must not wait on this request');};i.deferReply=async()=>{deferred++;};
   await h.app.dispatch(i);assert.equal(networkCalls,0);assert.equal(deferred,0);assert.equal(h.outputs.length,1);assert.match(h.outputs[0].content,/cannot moderate yourself/);assert.equal(h.core.cases('guild').length,2);
  }finally{h.close();}
 }
});
test('ban DMs the member first with server and reason; DM failures never block the action',async()=>{
 const h=harness();try{
  const sent=[];const orig=h.interaction('ban',{reason:'Spam'});
  const realFetch=orig.guild.members.fetch.bind(orig.guild.members);
  orig.guild.members.fetch=async(...a)=>{const m=await realFetch(...a);if(m&&typeof m==='object')m.send=async p=>{sent.push(p);throw new Error('DMs closed');};return m;};
  await h.app.handle(orig);
  const c=h.core.cases('guild').find(c=>c.action==='ban');assert.equal(c.state,'succeeded');
  assert.equal(sent.length,1);assert.match(sent[0].content,/^You were banned from \*\*.+\*\*\.\nReason: Spam/);assert.deepEqual(sent[0].allowedMentions,{parse:[]});
 }finally{h.close();}
});
function dmInteraction(h,customId,{user='target',body=null}={}){
 return {id:'dm'+customId.length+(body?'s':'b')+Math.random().toString(36).slice(2,8),guildId:null,guild:null,channelId:'dm',user:{id:user},customId,inGuild:()=>false,
  isChatInputCommand:()=>false,isButton:()=>body===null,isModalSubmit:()=>body!==null,isAutocomplete:()=>false,
  fields:{getTextInputValue:()=>body},replied:false,deferred:false,
  reply:async function(p){this.replied=true;h.outputs.push(p);},deferReply:async function(){this.deferred=true;},editReply:async p=>h.outputs.push(p),followUp:async p=>h.outputs.push(p),showModal:async p=>h.outputs.push(p.toJSON())};
}
test('ban sends the DM with an Appeal button before the ban, and the member can appeal from DMs after removal',async()=>{
 const h=harness();try{
  const order=[];let dm;h.target.send=async p=>{order.push('dm');dm=p;};const ban=h.target.ban;h.target.ban=async(...a)=>{order.push('ban');return ban(...a);};
  const i=h.interaction('ban',{reason:'Spam'});await h.app.handle(i);
  assert.deepEqual(order,['dm','ban']);assert.match(dm.content,/You were banned from .*\nReason: Spam\nCase: /);
  const button=dm.components[0].components[0];assert.equal(button.label,'Appeal');assert.equal(button.custom_id,`mod-appeal-dm:guild:${i.id}`);
  await h.app.handle(dmInteraction(h,button.custom_id));assert.equal(h.outputs.at(-1).custom_id,`mod-appeal-dm-submit:guild:${i.id}`);
  await h.app.handle(dmInteraction(h,`mod-appeal-dm-submit:guild:${i.id}`,{body:'I was hacked'}));
  assert.match(h.outputs.at(-1).content,/submitted for case/);
  const appeal=h.store.list('guild','mod-appeal').find(a=>a.caseId===i.id);assert.equal(appeal.actor,'target');assert.equal(appeal.body,'I was hacked');
  // Duplicate submission is blocked.
  await h.app.handle(dmInteraction(h,`mod-appeal-dm-submit:guild:${i.id}`,{body:'Again'})).catch(()=>{});
  assert.equal(h.store.list('guild','mod-appeal').filter(a=>a.caseId===i.id).length,1);
 }finally{h.close();}
});
test('DM appeal from a different user is rejected and stores nothing',async()=>{
 const h=harness();try{
  h.target.send=async()=>{};const i=h.interaction('kick',{reason:'Rule 2'});await h.app.handle(i);
  const before=h.store.list('guild','mod-appeal').length;
  await assert.rejects(h.app.handle(dmInteraction(h,`mod-appeal-dm-submit:guild:${i.id}`,{user:'intruder',body:'Let me in'})),/not valid/);
  await assert.rejects(h.app.handle(dmInteraction(h,`mod-appeal-dm:guild:${i.id}`,{user:'intruder'})),/not valid/);
  await assert.rejects(h.app.handle(dmInteraction(h,'mod-appeal-dm:other-guild:'+i.id)),/not valid/);
  assert.equal(h.store.list('guild','mod-appeal').length,before);
 }finally{h.close();}
});
test('closed DMs never block the sanction; the case records it and the moderator is told to use /appeals record',async()=>{
 const h=harness();try{
  h.target.send=async()=>{const e=new Error('Cannot send messages to this user');e.code=50007;e.status=403;throw e;};
  const i=h.interaction('ban',{reason:'Spam'});await h.app.handle(i);
  const c=h.core.get('guild',i.id);assert.equal(c.state,'succeeded');assert.equal(c.details.dm,'failed');assert.ok(h.effects.includes('ban'));
  assert.match(h.outputs.at(-1).content,/Could not DM the member\. If they contact staff another way, use \/appeals record\./);
 }finally{h.close();}
});
test('appeal review never reverses the sanction and says so plainly',async()=>{
 const h=harness();try{
  const i=h.interaction('appeals','review',{appeal:'appeal',decision:'accepted',reason:'Fair'});await h.app.handle(i);
  assert.match(h.outputs.at(-1).content,/accepted\. The sanction was not changed; use \/unban or \/untimeout if needed/);assert.ok(!h.effects.includes('unban'));
 }finally{h.close();}
});
test('staff moderation results, including the DM-failure note, are public',async()=>{
 const h=harness();try{
  for(const [name,sub,values] of [['appeals','list',{}],['appeals','show',{appeal:'appeal'}],['warnings',undefined,{}],['modlogs',undefined,{}],['case',undefined,{id:'saved'}],['mod-settings','view',{}],['emergency','status',{}]]){
   const i=h.interaction(name,sub,values);await h.app.handle(i);assert.equal(h.outputs.at(-1).flags,undefined,`${name} ${sub||''}`);
  }
  h.target.send=async()=>{throw Object.assign(new Error('closed'),{code:50007,status:403});};
  const i=h.interaction('ban',{reason:'Spam'});await h.app.handle(i);
  const result=h.outputs.at(-1);assert.equal(result.embeds[0].title,'Member banned');assert.equal(result.flags,undefined);assert.match(result.content,/Could not DM the member/);
 }finally{h.close();}
});
