import {textOf,messageOf} from './text-of.js';
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
import {saveModlog,modlogEmbed} from '../src/modlog.js';
const never=()=>new Promise(()=>{});
const perm=bits=>new PermissionsBitField(bits);
const scenarios={warn:{},kick:{},ban:{},unban:{},untimeout:{},timeout:{duration:'10m'},purge:{count:10},case:{},unwarn:{},lockdown:{}};
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
 core.append('guild',core.get('guild','saved'),'created','original-mod','Original reason');
 let seq=0;
 function interaction(name,sub,values={}){
  if(sub&&typeof sub==='object'){values=sub;sub=undefined;}
  if(name==='mod'){[name,sub]=({history:['case','history'],note:['case','reason'],void:['unwarn'],reconcile:['case','resolve'],case:['case','view'],warnings:['case','history']})[sub]||[sub];}
  if(name==='warnings'){name=sub==='remove'?'unwarn':'case';sub=sub==='remove'?undefined:'history';}
  const v={user:name==='purge'?null:'target',duration:'10m',...(name==='case'?{}:{reason:'Test reason'}),...values};
  if(name==='case'&&sub&&sub!=='history'){v.number=core.get('guild',values.id||values.case||(sub==='resolve'?'uncertain':'saved')).number;if(sub==='reason')v.reason=values.reason||'Test reason';}
  if(name==='case')sub=undefined;
  if(name==='unwarn'){v.warning??=core.get('guild',values.case||'saved').number;sub=undefined;}
  if(name==='lockdown'){if(sub&&sub!=='status')v.locked=sub==='on';else if(!('locked' in v)){v.reason=null;v.channel=null;}sub=undefined;}
  if(name==='settings'){if(sub==='status')v.status=true;sub=undefined;}
  return {
  id:String(++seq),guildId:'guild',guild,channelId:'channel',user:actor.user,member:actor,memberPermissions:actor.permissions,commandName:name,
  inGuild:()=>true,isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,
  options:{getSubcommand:()=>sub,getUser:()=>v.user?{id:v.user}:null,getMember:()=>v.user==='target'?target:null,getString:k=>v[k]??null,getInteger:k=>v[k]??null,getBoolean:k=>v[k]??null,getAttachment:k=>v[k]??null,getRole:()=>null,getChannel:()=>v.channel===null?null:channel},
  reply:async function(p){this.replied=true;outputs.push(p);},deferReply:async function(){this.deferred=true;},editReply:async p=>outputs.push(p),followUp:async p=>outputs.push(p),showModal:async p=>outputs.push(p.toJSON()),
 };}
 return {app,store,core,client,actor,bot,target,channel,outputs,effects,interaction,close(){app.stop();store.close();}};
}
test('moderation scenarios exactly cover every registered subcommand',()=>{
 assert.deepEqual(Object.keys(scenarios).sort(),moderationCommands.flatMap(c=>c.options.some(o=>o.type===1)?c.options.map(s=>c.name+' '+s.name):[c.name]).sort());
});
test('common commands are standalone with simple inputs and no mandatory purge confirmation',()=>{
 assert.ok(!moderationCommands.some(c=>c.name==='mod'));
 for(const name of ['ban','kick','warn','timeout','purge'])assert.ok(moderationCommands.find(c=>c.name===name).options.every(o=>o.type!==1));
 assert.deepEqual(moderationCommands.find(c=>c.name==='purge').options.filter(o=>o.required).map(o=>o.name),['count']);
 for(const c of moderationCommands){let optional=false;for(const o of c.options){if(o.type===1)continue;if(!o.required)optional=true;else assert.equal(optional,false,c.name);}}
});
test('human-readable durations accept common units and reject invalid or excessive values',()=>{
 for(const [value,minutes]of [['10m',10],['1h',60],['2d',2880],['4w',40320],[' 1 H ',60]])assert.equal(durationMinutes(value),minutes);
 for(const value of ['',0,'forever','-1h','1.5h','29d','0m','99999999999999999999w'])assert.throws(()=>durationMinutes(value),/duration/);
});
test('simple ban records an omitted reason and replies with a clear result',async()=>{
 const h=harness();try{await h.app.handle(h.interaction('ban',{reason:null}));const c=h.core.cases('guild').find(c=>c.action==='ban');assert.equal(c.reason,'No reason provided');assert.match(textOf(h.outputs.at(-1)),/^Banned /);const e=h.outputs.at(-1).embeds[0];assert.equal(e.title,'Member banned');assert.equal(e.color,0x5865f2);assert.deepEqual(e.fields.map(f=>f.name),['User','Moderator','Reason','DM']);}finally{h.close();}
});
test('case history excludes permanently deleted warnings',async()=>{
 const h=harness();try{await h.app.handle(h.interaction('warnings','remove'));await h.app.handle(h.interaction('case','history'));assert.match(h.outputs.at(-1).embeds[0].description,/has no moderation history/);}finally{h.close();}
});
test('moderation rejections and uncertain outcomes show concise public errors, not case or server dumps',async()=>{
 for(const uncertain of [false,true]){
  const h=harness();try{
   h.target.ban=uncertain?never:async()=>{throw Object.assign(Error('SQLITE diagnostic Wispbyte restart at C:/private/.env'),{status:403,code:50013});};
   await h.app.handle(h.interaction('ban'));
   const message=messageOf(h.outputs.at(-1));assert.equal(h.outputs.at(-1).embeds[0].title,uncertain?'Result not confirmed':'Action failed');assert.ok(message.length<200);assert.doesNotMatch(message,/SQLITE|Wispbyte|\.env|50013|\bfailed\b|\buncertain\b|Reason:|Member:/);
   assert.match(message,uncertain?/Check the result/:/permissions/);
  }finally{h.close();}
 }
});
test('settings and lockdown status show readable summaries without internal delivery state dumps',async()=>{
 const h=harness();try{
  await h.app.handle(h.interaction('settings','view'));const view=JSON.stringify(h.outputs.at(-1).embeds);assert.ok(h.outputs.at(-1).embeds[0].fields.some(f=>f.name==='Moderation'&&/DM members by default: On/.test(f.value)));assert.doesNotMatch(view,/\\"id\\":|logChannel|retentionDays|queued|sending|uncertain/);
  h.store.put('guild','mod-lock',{id:'channel',state:'needs-review'});await h.app.handle(h.interaction('lockdown','status'));assert.match(textOf(h.outputs.at(-1)),/Needs review/);assert.doesNotMatch(textOf(h.outputs.at(-1)),/needs-review/);
 }finally{h.close();}
});
test('purge member filter excludes other members without deleting pinned messages',async()=>{
 const h=harness();try{h.channel.messages.fetch=async()=>new Map([['a',{id:'a',author:{id:'target'},createdTimestamp:Date.now()}],['b',{id:'b',author:{id:'other'},createdTimestamp:Date.now()}],['c',{id:'c',pinned:true,author:{id:'target'},createdTimestamp:Date.now()}]]);await h.app.handle(h.interaction('purge',{count:20,user:'target'}));assert.deepEqual(h.effects,[['a']]);}finally{h.close();}
});
for(const [name,values]of Object.entries(scenarios)){
 test(`authorized scenario /${name} finishes`,async()=>{
  const h=harness();try{
   if(name==='lockdown off')await h.app.handle(h.interaction('lockdown','on'));
   if(name==='appeals record')h.store.remove('guild','mod-appeal','appeal');
   await h.app.handle(h.interaction(...name.split(' '),values));assert.ok(h.outputs.length);assert.ok(h.outputs.at(-1).flags===64||h.outputs.at(-1).flags===undefined);
  }finally{h.close();}
 });
 test(`unauthorized /${name} denies before reading options`,async()=>{
  const h=harness({authorized:false});try{const i=h.interaction(...name.split(' '),values);i.options=new Proxy({}, {get(){throw Error('Options accessed before authorization');}});await assert.rejects(h.app.handle(i),/permission/);assert.equal(h.effects.length,0);assert.ok(!i.privateResponse);}finally{h.close();}
 });
}
test('persistent cases deduplicate interactions, scope tenants, and permanently remove warnings',async()=>{
 const h=harness();try{
  const i=h.interaction('mod','warn');await h.app.handle(i);await h.app.handle({...i,replied:false});
  assert.equal(h.core.cases('guild').filter(c=>c.id===i.id).length,1);assert.throws(()=>h.core.get('other',i.id),/not found/);
  await h.app.handle(h.interaction('mod','void'));assert.throws(()=>h.core.get('guild','saved'),/not found/);
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
for(const networkStep of ['channel','messages','ban-lookup','overwrite','restore-fetch'])test(`never-settling moderation ${networkStep} step finishes with error or an uncertain case`,async()=>{
 const h=harness();try{
  let i=h.interaction('mod','purge',{count:10,confirm:'yes'}),guild=i.guild;
  if(networkStep==='channel')guild.channels.fetch=never;
  if(networkStep==='messages')h.channel.messages.fetch=never;
  if(networkStep==='ban-lookup'){i=h.interaction('mod','unban');guild.bans.fetch=never;}
  if(networkStep==='panel-send'){i=h.interaction('appeals','panel');h.channel.send=never;}
  if(networkStep==='overwrite'){i=h.interaction('lockdown','on');h.channel.permissionOverwrites.edit=never;}
  if(networkStep==='restore-fetch'){
   await h.app.handle(h.interaction('lockdown','on'));i=h.interaction('lockdown','off');let calls=0;guild.channels.fetch=()=>++calls===1?Promise.resolve(h.channel):never();
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
  await h.app.handle(h.interaction('lockdown','on'));assert.equal(o.allow.has(P.SendMessages),false);
  o.allow.remove(P.ViewChannel);o.deny.add(P.ViewChannel);
  await h.app.handle(h.interaction('lockdown','off'));assert.equal(o.allow.bitfield,before&~P.ViewChannel);assert.ok(o.deny.has(P.ViewChannel));assert.equal(h.store.list('guild','mod-lock').length,0);
 }finally{h.close();}
});
test('lockdown refuses conflicting writing changes and retains restoration journal',async()=>{
 const h=harness();try{
  await h.app.handle(h.interaction('lockdown','on'));const o=h.channel.permissionOverwrites.cache.get('guild');o.allow.add(P.SendMessages);o.deny.remove(P.SendMessages);
  await h.app.handle(h.interaction('lockdown','off'));assert.equal(h.store.get('guild','mod-lock','channel').state,'needs-review');assert.equal(h.core.cases('guild').find(c=>c.action==='emergency-off').state,'uncertain');
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
  h.store.put('guild','mod-appeal',{id:'legacy',caseId:'saved',state:'open'});h.core.sweep();assert.ok(h.core.get('guild','saved'));assert.ok(h.core.get('guild','uncertain'));
  h.store.put('guild','mod-appeal',{id:'legacy',caseId:'saved',state:'denied'});h.core.sweep();assert.throws(()=>h.core.get('guild','saved'),/not found/);
 }finally{h.close();}
});
test('maintenance does not retry an uncertain log send',async()=>{
 const h=harness();try{saveModlog(h.store,'guild',{channel:'channel',enabled:true});for(const row of h.store.list('guild','mod-log'))h.store.remove('guild','mod-log',row.id);h.store.put('guild','mod-log',{id:'saved',caseId:'saved',state:'queued',v:2,event:{action:'note',actor:'owner',reason:'x',at:Date.now()}});let sends=0;h.channel.send=()=>{sends++;return never();};await h.app.moderation.tick();assert.equal(h.store.get('guild','mod-log','saved').state,'uncertain');await h.app.moderation.tick();assert.equal(sends,1);}finally{h.close();}
});
test('case and outbox rollback together when storage fails',()=>{
 const h=harness();try{const put=h.store.put.bind(h.store);h.store.put=(g,kind,v)=>{if(kind==='mod-log')throw Error('disk failure');return put(g,kind,v);};const c=h.core.get('guild','saved');assert.throws(()=>h.core.append('guild',c,'note','owner','new note'),/disk failure/);assert.equal(h.core.get('guild','saved').events.length,1);}finally{h.close();}
});
test('restart preserves cases, configuration and unresolved operation barriers',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'number-one-moderation-')),path=join(dir,'test.sqlite');let store;
 try{store=new Store(path);let core=new Moderation(store,{timeoutMs:5});core.saveConfig('guild',{modRole:'moderator'});await core.run({guild:'guild',id:'first',actor:'mod',target:'target',action:'ban',reason:'test',effect:never});store.close();store=new Store(path);core=new Moderation(store);assert.equal(core.config('guild').modRole,'moderator');assert.equal(core.get('guild','first').state,'uncertain');await assert.rejects(core.run({guild:'guild',id:'second',actor:'mod',target:'target',action:'ban',reason:'test'}),/earlier action/);}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('access removed during preflight prevents an already-prepared action',async()=>{
 const h=harness();try{const i=h.interaction('mod','ban');let fetches=0;i.guild.fetch=async()=>{if(++fetches===2){i.guild.ownerId='new-owner';h.actor.permissions=perm([]);}return i.guild;};await assert.rejects(h.app.handle(i),/access was removed/);assert.equal(h.effects.length,0);}finally{h.close();}
});
test('protected targets get an immediate error without network calls, a deferral or a warning case',async()=>{
 for(const target of ['owner','bot']){
  const h=harness();try{
   const i=h.interaction('warn',{user:target});let networkCalls=0,deferred=0;
   i.guild.fetch=async()=>{networkCalls++;throw Error('Must not wait on this request');};i.deferReply=async()=>{deferred++;};
   await h.app.dispatch(i);assert.equal(networkCalls,0);assert.equal(deferred,0);assert.equal(h.outputs.length,1);assert.match(textOf(h.outputs[0]),/cannot moderate yourself/);assert.equal(h.core.cases('guild').length,2);
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
  assert.equal(sent.length,1);assert.match(textOf(sent[0]),/^You were banned from \*\*.+\*\*\.\nReason: Spam/);assert.deepEqual(sent[0].allowedMentions,{parse:[]});
 }finally{h.close();}
});
function dmInteraction(h,customId,{user='target',body=null}={}){
 return {id:'dm'+customId.length+(body?'s':'b')+Math.random().toString(36).slice(2,8),guildId:null,guild:null,channelId:'dm',user:{id:user},customId,inGuild:()=>false,
  isChatInputCommand:()=>false,isButton:()=>body===null,isModalSubmit:()=>body!==null,isAutocomplete:()=>false,
  fields:{getTextInputValue:()=>body},replied:false,deferred:false,
  reply:async function(p){this.replied=true;h.outputs.push(p);},deferReply:async function(){this.deferred=true;},editReply:async p=>h.outputs.push(p),followUp:async p=>h.outputs.push(p),showModal:async p=>h.outputs.push(p.toJSON())};
}
test('closed DMs never block the sanction; the case records it and the moderator gets a clear delivery notice',async()=>{
 const h=harness();try{
  h.target.send=async()=>{const e=new Error('Cannot send messages to this user');e.code=50007;e.status=403;throw e;};
  const i=h.interaction('ban',{reason:'Spam'});await h.app.handle(i);
  const c=h.core.get('guild',i.id);assert.equal(c.state,'succeeded');assert.equal(c.details.dm,'failed');assert.ok(h.effects.includes('ban'));
  assert.match(textOf(h.outputs.at(-1)),/Could not DM the member\. The moderation action was still completed\./);
 }finally{h.close();}
});
test('staff moderation results, including the DM-failure note, are public',async()=>{
 const h=harness();try{
  for(const [name,sub,values] of [['case','history',{}],['case','view',{id:'saved'}],['settings','view',{}],['lockdown','status',{}]]){
   const i=h.interaction(name,sub,values);await h.app.handle(i);assert.equal(h.outputs.at(-1).flags,undefined,`${name} ${sub||''}`);
  }
  h.target.send=async()=>{throw Object.assign(new Error('closed'),{code:50007,status:403});};
  const i=h.interaction('ban',{reason:'Spam'});await h.app.handle(i);
  const result=h.outputs.at(-1);assert.equal(result.embeds[0].title,'Member banned');assert.equal(result.flags,undefined);assert.match(textOf(result),/Could not DM the member/);
 }finally{h.close();}
});
const DM_ACTIONS=['ban','kick','warn','timeout','untimeout','unban'];
for(const name of DM_ACTIONS)for(const mode of ['true','false','failed','default-off']){
 test(`/${name} dm=${mode} records the DM result and shows it in the public confirmation`,async()=>{
  const h=harness();try{
   let sent=null;h.target.send=async p=>{if(mode==='failed')throw Error('Cannot send messages to this user');sent=p;};
   h.client.users={fetch:async()=>h.target,cache:new Map()};
   if(mode==='default-off')h.core.saveConfig('guild',{dmMembers:false});
   const i=h.interaction(name,{reason:'Spam',...(mode==='true'||mode==='failed'?{dm:true}:mode==='false'?{dm:false}:{})});await h.app.handle(i);
   const out=h.outputs.at(-1);assert.equal(out.flags,undefined);
   const field=out.embeds[0].fields.find(f=>f.name==='DM');
   const expected={true:'Sent',failed:'Failed (DMs closed)',false:'Not sent (disabled)','default-off':'Not sent (disabled)'}[mode];
   assert.equal(field?.value,expected);
   const c=h.core.get('guild',i.id);
   if(mode==='true'){
    assert.doesNotMatch(textOf(sent),/Case:|Appeal/);assert.match(textOf(sent),/Reason: Spam/);
    assert.equal(sent.components,undefined);
   }else assert.equal(sent,null);
  }finally{h.close();}
 });
}
test('dm=false sends no Appeal button even when dm-appeals is on, and every action exposes the dm option',()=>{
 for(const name of DM_ACTIONS){const o=moderationCommands.find(c=>c.name===name).options.find(o=>o.name==='dm');assert.equal(o?.type,5,name);assert.equal(o.description,'Send the member a DM (default: on)');assert.ok(!o.required);}
});
test('cases get sequential per-server numbers, backfilled by creation order, and lookups accept the number or the old id',()=>{
 const store=new Store(':memory:'),core=new Moderation(store);try{
  store.put('g','mod-case',{id:'b',actor:'1',target:'2',action:'warn',reason:'r',created:2,state:'succeeded',events:[]});
  store.put('g','mod-case',{id:'a',actor:'1',target:'2',action:'warn',reason:'r',created:1,state:'succeeded',events:[]});
  store.put('h','mod-case',{id:'z',actor:'1',target:'2',action:'warn',reason:'r',created:1,state:'succeeded',events:[]});
  assert.deepEqual(core.cases('g').map(c=>[c.id,c.number]),[['b',2],['a',1]]);assert.equal(core.cases('h')[0].number,1);
  for(const ref of ['1','#1','case 1','Case #1','a'])assert.equal(core.get('g',ref).id,'a');
  assert.equal(core.reserveNumber('g','new'),3);assert.equal(core.reserveNumber('g','new'),3);
 }finally{store.close();}
});
test('case history paginates with public Previous/Next buttons limited to the invoker or staff',async()=>{
 const h=harness();try{
  for(let n=0;n<12;n++)h.store.put('guild','mod-case',{id:'w'+n,guild:'guild',actor:'mod',target:'target',action:'warn',reason:'R'+n,created:1000+n,state:'succeeded',events:[]});
  await h.app.handle(h.interaction('case','history'));const out=h.outputs.at(-1);
  assert.equal(out.embeds[0].fields.length,10);assert.match(out.embeds[0].footer.text,/^Total: 13 cases · Page 1 of 2$/);
  const next=out.components[0].components[1];assert.equal(next.label,'Next');assert.equal(out.components[0].components[0].disabled,true);
  const b=h.interaction('component','');Object.assign(b,{commandName:undefined,customId:next.custom_id,isChatInputCommand:()=>false,isButton:()=>true,update:async p=>h.outputs.push(p)});
  await h.app.handle(b);assert.equal(h.outputs.at(-1).embeds[0].fields.length,3);assert.equal(h.outputs.at(-1).flags,undefined);
 }finally{h.close();}
});

const shot=(n=1,extra={})=>({url:`https://cdn.discordapp.com/attachments/1/2/shot${n}.png?ex=1`,name:`shot${n}.png`,contentType:'image/png',size:4096,...extra});
for(const name of ['ban','unban','kick','warn','timeout','untimeout','purge'])test(`/${name} stores screenshot proof and shows it in the public confirmation`,async()=>{
 const h=harness();try{
  h.target.send=async()=>{};h.client.users={fetch:async()=>h.target,cache:new Map()};
  const i=h.interaction(name,{reason:'Spam',image:shot(1),image2:shot(2),...(name==='purge'?{count:10,user:null}:{})});await h.app.handle(i);
  const out=h.outputs.at(-1),e=out.embeds[0];assert.equal(out.flags,undefined);
  const field=e.fields.find(f=>f.name==='Attachments');assert.match(field.value,/\[Screenshot 1\]\(https:\/\/cdn\.discordapp\.com\/attachments\/1\/2\/shot1\.png\?ex=1\)\n\[Screenshot 2\]/);
  assert.equal(e.image.url,shot(1).url);
  const c=h.core.get('guild',i.id);assert.equal(c.details.proof.length,2);assert.equal(c.details.proof[0].stored,false);
 }finally{h.close();}
});
test('proof rejects non-images, oversized files and foreign or malformed links with public errors before any action',async()=>{
 for(const [values,pattern]of [[{image:shot(1,{contentType:'application/pdf',name:'a.pdf'})},/PNG, JPEG, GIF or WebP/],[{image:shot(1,{size:11*1024*1024})},/10 MB/],[{'message-link':'https://example.com/x'},/Discord message links/],[{'message-link':'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333'},/Discord message links from this server/]]){
  const h=harness();try{await assert.rejects(h.app.handle(h.interaction('ban',{reason:'x',...values})),pattern);assert.deepEqual(h.effects,[]);assert.equal(h.core.cases('guild').filter(c=>c.action==='ban').length,0);}finally{h.close();}
 }
});
test('readProof accepts this server’s message links (including ptb/canary) and normalises them',async()=>{
 const {readProof}=await import('../src/mod-proof.js');
 const g='123456789012345678',link=(host)=>`https://${host}/channels/${g}/223456789012345678/323456789012345678`;
 const items=readProof({guildId:g,user:{id:'1'},options:{getAttachment:()=>null,getString:()=>`${link('discord.com')} ${link('ptb.discord.com')}, ${link('canary.discordapp.com')}`}});
 assert.deepEqual(items.map(p=>p.url),[link('discord.com')]);assert.equal(items[0].type,'link');
 assert.throws(()=>readProof({guildId:g,options:{getAttachment:()=>null,getString:()=>Array.from({length:6},(_,n)=>link('discord.com')+n).join(' ')}}),/up to 5/);
});
test('screenshots are re-uploaded to the private log channel and the durable copy is stored on the case',async()=>{
 const h=harness();try{
  saveModlog(h.store,'guild',{channel:'channel',enabled:true});const sends=[];
  h.channel.send=async p=>{sends.push(p);return {url:'https://discord.com/channels/1/2/3',attachments:new Map((p.files||[]).map(f=>[f.name,{name:f.name,url:'https://cdn.discordapp.com/attachments/9/9/'+f.name+'?stored'}]))};};
  const i=h.interaction('warn',{reason:'Spam',image:shot(1),dm:false});await h.app.handle(i);
  await h.app.moderation.tick();
  const logged=sends.find(p=>p.files);assert.equal(logged.files[0].attachment,shot(1).url);assert.equal(logged.files[0].name,'image-1.png');
  assert.equal(logged.embeds[0].image.url,'attachment://image-1.png');assert.ok(logged.embeds[0].fields.some(f=>f.name==='Attachments'));
  const p=h.core.get('guild',i.id).details.proof[0];assert.equal(p.stored,true);assert.match(p.storedUrl,/\?stored$/);assert.equal(p.logMessage,'https://discord.com/channels/1/2/3');
  // /case view and history show the stored copy.
  await h.app.handle(h.interaction('case','view',{id:String(h.core.get('guild',i.id).number)}));const view=h.outputs.at(-1).embeds[0];
  assert.match(view.fields.find(f=>f.name==='Attachments').value,/\?stored\).*\[log copy\]\(https:\/\/discord\.com\/channels\/1\/2\/3\)/);assert.match(view.image.url,/\?stored$/);
  await h.app.handle(h.interaction('case','history'));assert.match(h.outputs.at(-1).embeds[0].fields.find(f=>/Warn/.test(f.name)&&/Attachments/.test(f.value)).value,/\*\*Attachments:\*\* \[Screenshot 1\]/);
 }finally{h.close();}
});
test('images can be added later through /case optional inputs, and is never put in member DMs',async()=>{
 const h=harness();try{
  let dm;h.target.send=async p=>{dm=p;};
  const i=h.interaction('warn',{reason:'Spam',image:shot(1)});await h.app.handle(i);assert.ok(dm);assert.doesNotMatch(JSON.stringify(dm),/cdn\.discordapp|Proof|Screenshot/);
  await h.app.handle(h.interaction('case','reason',{case:i.id,image:shot(2)}));assert.match(textOf(h.outputs.at(-1)),/^Case note saved\./);
  await h.app.handle(h.interaction('case','reason',{case:i.id,reason:'More context',image:shot(3)}));
  assert.equal(h.core.get('guild',i.id).details.proof.length,3);

 }finally{h.close();}
});
test('without a log channel the confirmation explains that screenshots are not stored durably',async()=>{
 const h=harness();try{await h.app.handle(h.interaction('kick',{reason:'x',image:shot(1),dm:false}));assert.match(textOf(h.outputs.at(-1)),/The mod log is off/);}finally{h.close();}
});
test('every moderation action offers optional image inputs in the same command',()=>{
 const want=['ban','unban','kick','warn','timeout','untimeout','purge','case','lockdown'];
 for(const key of want){const [n,sub]=key.split(' ');const c=moderationCommands.find(c=>c.name===n);const opts=sub?c.options.find(o=>o.name===sub).options:c.options;
  assert.deepEqual(opts.filter(o=>['image','image2','image3','message-link'].includes(o.name)).map(o=>[o.name,o.type]),[['image',11],['image2',11],['image3',11],['message-link',3]],key);}
});


test('one case history handles 50 warnings; no warning list or internal-ID dropdown is registered',async()=>{
 const h=harness();try{
  h.store.remove('guild','mod-case','saved');
  for(let n=0;n<50;n++)h.store.put('guild','mod-case',{id:'old-warning-'+n,actor:'original-mod',target:'target',action:'warn',reason:'Warning '+(n+1),created:Date.now()+n,state:'succeeded',events:[]});
  await h.app.handle(h.interaction('case',{user:'target',page:5}));const p=h.outputs.at(-1);
  assert.equal(p.embeds[0].fields.length,10);assert.match(p.embeds[0].footer.text,/50 cases · Page 5 of 5/);
  assert.equal(p.components.flatMap(r=>r.components).length,2);
  assert(!moderationCommands.some(c=>c.name==='warnings'||c.name==='appeals'));
  for(const c of moderationCommands)assert(c.options.every(o=>o.type!==1&&!o.autocomplete));
  assert.doesNotMatch(JSON.stringify(p),/old-warning-/);
 }finally{h.close();}
});

test('unwarn uses a short number, verifies the selected member, and permanently deletes the case',async()=>{
 const h=harness();try{
  const n=h.core.get('guild','saved').number;
  await assert.rejects(h.app.handle(h.interaction('unwarn',{user:'other',warning:n})),/does not belong/);
  assert(!h.core.get('guild','saved').voided);
  await h.app.handle(h.interaction('unwarn',{user:'target',warning:n,reason:'Warning issued by mistake'}));
  assert.equal(h.store.get('guild','mod-case','saved'),undefined);assert(!h.store.list('guild','mod-log').some(row=>row.caseId==='saved'));
  assert.match(textOf(h.outputs.at(-1)),/^Warning removed/);assert(!h.outputs.at(-1).embeds[0].fields.some(f=>f.name==='Case'));
  await assert.rejects(h.app.handle(h.interaction('unwarn',{user:'target',warning:n})),/not found/);
 }finally{h.close();}
});

test('case inputs reject ambiguous edits and update only the explicitly numbered record',async()=>{
 const h=harness();try{
  await assert.rejects(h.app.handle(h.interaction('case',{user:null})),/Choose a member/);
  await assert.rejects(h.app.handle(h.interaction('case',{user:'target',reason:'Ambiguous'})),/Enter the case number/);
  const n=h.core.get('guild','saved').number;
  await assert.rejects(h.app.handle(h.interaction('case',{user:'other',number:n})),/does not belong/);
  await h.app.handle(h.interaction('case',{user:'target',number:n,reason:'Added context',image:shot()}));
  assert.equal(h.core.get('guild','saved').details.proof.length,1);assert.equal(h.core.get('guild','saved').events.at(-1).reason,'Added context');
  const resolved=h.core.get('guild','uncertain');
  await h.app.handle(h.interaction('case',{user:null,number:resolved.number,outcome:'failed',reason:'Checked Discord; nothing changed'}));assert.equal(h.core.get('guild','uncertain').state,'failed');
 }finally{h.close();}
});

test('old moderation appeal buttons are disabled and cannot create new appeal records',async()=>{
 const h=harness();try{
  for(const id of ['mod-appeal-open','mod-appeal-status','mod-appeal-dm:guild:saved','mod-appeal-dm-submit:guild:saved']){
   await h.app.handle(dmInteraction(h,id));assert.match(textOf(h.outputs.at(-1)),/Moderation appeals are no longer available/);
  }
  assert.deepEqual(h.store.list('guild','mod-appeal'),[]);
 }finally{h.close();}
});


test('a late warning DM completion cannot restore a warning deleted during the send',async()=>{
 const h=harness();try{
  let release;h.target.send=()=>new Promise(resolve=>{release=resolve;});
  const i=h.interaction('warn',{reason:'Pending notice'}),pending=h.app.handle(i);await new Promise(setImmediate);
  const n=h.core.get('guild',i.id).number;
  await h.app.handle(h.interaction('unwarn',{user:'target',warning:n}));release();await pending;
  assert.equal(h.store.get('guild','mod-case',i.id),undefined);assert(!h.store.list('guild','mod-log').some(row=>row.caseId===i.id));
 }finally{h.close();}
});
