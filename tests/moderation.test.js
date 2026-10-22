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
const never=()=>new Promise(()=>{});
const perm=bits=>new PermissionsBitField(bits);
const scenarios={
 'mod warn':{},'mod kick':{},'mod ban':{},'mod unban':{},'mod untimeout':{},'mod timeout':{minutes:10},'mod purge':{count:10,confirm:'yes'},
 'mod case':{},'mod history':{},'mod note':{},'mod void':{},'mod reconcile':{case:'uncertain',outcome:'failed'},
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
 const guild={id:'guild',ownerId:authorized?'owner':'other-owner',fetch:async()=>guild,members:{fetch:async opt=>((opt.user||opt)==='target'?target:actor),fetchMe:async()=>bot},roles:{everyone:'everyone',fetch:async()=>new Map()},channels:{fetch:async()=>channel,cache:new Map([['channel',channel]])},bans:{fetch:async()=>({})}};
 guild.members.unban=async()=>effects.push('unban');channel.guild=guild;client.guilds.cache.set(guild.id,guild);
 const app=createApp(client,store,{operationTimeoutMs:40,acknowledgementDelayMs:100});
 const core=app.moderation.core;
 store.put('guild','mod-case',{id:'saved',guild:'guild',actor:'original-mod',target:'target',action:'warn',reason:'Original reason',created:Date.now(),state:'succeeded',events:[]});
 store.put('guild','mod-case',{id:'uncertain',guild:'guild',actor:'original-mod',target:'other',action:'warn',reason:'Original reason',created:Date.now(),state:'uncertain',events:[]});
 core.appeal('guild','appeal','target','saved','Please review');
 let seq=0;
 function interaction(name,sub,values={}){const v={user:'target',case:'saved',reason:'Test reason',...values};return {
  id:String(++seq),guildId:'guild',guild,channelId:'channel',user:actor.user,member:actor,memberPermissions:actor.permissions,commandName:name,
  inGuild:()=>true,isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,
  options:{getSubcommand:()=>sub,getUser:()=>({id:v.user}),getString:k=>v[k]??null,getInteger:k=>v[k]??null,getBoolean:k=>v[k]??null,getRole:()=>null,getChannel:()=>channel},
  reply:async function(p){this.replied=true;outputs.push(p);},deferReply:async function(){this.deferred=true;},editReply:async p=>outputs.push(p),followUp:async p=>outputs.push(p),showModal:async p=>outputs.push(p.toJSON()),
 };}
 return {app,store,core,client,actor,bot,target,channel,outputs,effects,interaction,close(){app.stop();store.close();}};
}
test('moderation scenarios exactly cover every registered subcommand',()=>{
 assert.deepEqual(Object.keys(scenarios).sort(),moderationCommands.flatMap(c=>c.options.map(s=>c.name+' '+s.name)).sort());
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
  const h=harness({authorized:false});try{const i=h.interaction(...name.split(' '),values);i.options=new Proxy({}, {get(){throw Error('Options accessed before authorization');}});await assert.rejects(h.app.handle(i),/permission/);assert.equal(h.effects.length,0);assert.equal(i.privateResponse,true);}finally{h.close();}
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
test('member appeal status stays private and cannot reveal another member’s appeal',async()=>{
 const h=harness();try{
  const i=h.interaction('component','');i.commandName=undefined;i.customId='mod-appeal-status-submit';i.isChatInputCommand=()=>false;i.user={id:'target'};i.fields={getTextInputValue:()=> 'saved'};await h.app.handle(i);assert.match(h.outputs.at(-1).content,/open/);assert.equal(h.outputs.at(-1).flags,64);
  i.user={id:'stranger'};await assert.rejects(h.app.handle(i),/No appeal found/);
 }finally{h.close();}
});
test('access removed during preflight prevents an already-prepared action',async()=>{
 const h=harness();try{const i=h.interaction('mod','ban');let fetches=0;i.guild.fetch=async()=>{if(++fetches===2){i.guild.ownerId='new-owner';h.actor.permissions=perm([]);}return i.guild;};await assert.rejects(h.app.handle(i),/access was removed/);assert.equal(h.effects.length,0);}finally{h.close();}
});
