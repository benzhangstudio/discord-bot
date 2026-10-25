import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PermissionsBitField,PermissionFlagsBits as P,AuditLogEvent} from 'discord.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {createDashboardApi} from '../src/dashboard-api.js';
import {modlogConfig,saveModlog,modlogEmbed,eventKey} from '../src/modlog.js';
import {helpMenu} from '../src/help.js';
import {commands} from '../src/commands.js';
const G='123456789012345678',CH='223456789012345678',OWNER='323456789012345678',TARGET='423456789012345678',BOT='523456789012345678',MOD2='623456789012345678';
const perm=bits=>new PermissionsBitField(bits);
const flush=()=>new Promise(r=>setTimeout(r,5));
function harness({botBits=[P.Administrator],channelBits=null}={}){
 const store=new Store(':memory:'),client=new EventEmitter(),outputs=[],sends=[];
 client.guilds={cache:new Map()};client.user={id:BOT};client.users={cache:new Map([[TARGET,{id:TARGET,username:'target_user'}]]),fetch:async id=>({id,send:async()=>{}})};
 const member=(id,position,bits=[])=>({id,user:{id,bot:false,username:id===TARGET?'target_user':'u'},displayName:id===TARGET?'Target':'Mod',permissions:perm(bits),roles:{highest:{position},cache:new Map()},timeout:async()=>{},kick:async()=>{},ban:async()=>{},send:async()=>{}});
 const actor=member(OWNER,20,[P.Administrator]),bot=member(BOT,30,botBits),target=member(TARGET,1);
 let n=0;
 const channel={id:CH,name:'mod-log',type:0,permissionsFor:m=>perm(channelBits??(m==='everyone'?[]:[P.Administrator])),
  send:async p=>{sends.push(p);return {url:`https://discord.com/channels/${G}/${CH}/${++n}`,attachments:new Map()};},messages:{fetch:async()=>new Map()},permissionOverwrites:{cache:new Map()}};
 const guild={id:G,name:'Guild',ownerId:OWNER,fetch:async()=>guild,members:{me:bot,fetch:async opt=>((opt.user||opt)===TARGET?target:actor),fetchMe:async()=>bot,unban:async()=>{}},roles:{everyone:'everyone',cache:new Map(),fetch:async()=>new Map()},channels:{fetch:async()=>channel,cache:new Map([[CH,channel]])},bans:{fetch:async()=>({})}};
 client.guilds.cache.set(G,guild);
 const app=createApp(client,store,{operationTimeoutMs:200,acknowledgementDelayMs:100});
 let seq=0;
 const interaction=(name,sub,values={})=>{if(sub&&typeof sub==='object'){values=sub;sub=undefined;}if(name==='case'&&sub==='history'){values={...values,reason:null};sub=undefined;}else if(name==='case'){const ref=values.number??values.id??values.case;values={reason:sub==='reason'?'Updated':null,...values,number:/^\d{1,9}$/.test(String(ref))?Number(ref):app.moderation.core.get(G,ref).number};sub=undefined;}if(name==='warnings'){name='unwarn';values={...values,warning:Number(values.case)};sub=undefined;}if(name==='settings')sub=undefined;const v={user:TARGET,reason:'Spamming',duration:'1h',dm:false,...values};return {
  id:String(900000000000000000n+BigInt(++seq)),guildId:G,guild,channelId:CH,user:actor.user,member:actor,memberPermissions:actor.permissions,commandName:name,
  inGuild:()=>true,isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,
  options:{getSubcommand:()=>sub,getUser:()=>v.user?{id:v.user}:null,getMember:()=>v.user===TARGET?target:null,getString:k=>v[k]??null,getInteger:k=>v[k]??null,getBoolean:k=>v[k]??null,getAttachment:k=>v[k]??null,getRole:()=>null,getChannel:()=>channel},
  reply:async function(p){this.replied=true;outputs.push(p);},deferReply:async function(){this.deferred=true;},editReply:async p=>outputs.push(p),followUp:async p=>outputs.push(p)};};
 return {app,store,client,guild,channel,sends,outputs,interaction,close(){app.stop();store.close();}};
}
test('mod log starts off for every server and ignores the retired moderation logChannel',()=>{
 const h=harness();try{
  h.store.put(G,'mod-config',{id:'main',logChannel:CH,modRole:null});
  assert.equal(modlogConfig(h.store,G).enabled,false);assert.equal(modlogConfig(h.store,G).channel,null);
  assert.equal('logChannel' in h.app.moderation.core.config(G),false);
 }finally{h.close();}
});
test('a ban posts a Dyno-style "Case #N | Ban" entry and the case links to it',async()=>{
 const h=harness();try{
  saveModlog(h.store,G,{channel:CH,enabled:true});
  const i=h.interaction('ban');await h.app.handle(i);await flush();
  assert.equal(h.sends.length,1);const e=h.sends[0].embeds[0];
  assert.match(e.title,/^Case #\d+ \| Ban$/);assert.equal(e.color,0x5865F2);
  const f=Object.fromEntries(e.fields.map(x=>[x.name,x.value]));
  assert.equal(f.User,`<@${TARGET}> (target_user)`);assert.match(f.Moderator,new RegExp(OWNER));assert.equal(f.Reason,'Spamming');assert.equal(f.DM,'Not sent');
  assert.equal(e.footer.text,`User ID: ${TARGET}`);assert.ok(e.timestamp);assert.deepEqual(h.sends[0].allowedMentions,{parse:[]});
  const c=h.app.moderation.core.get(G,i.id);assert.equal(c.logMessage,`https://discord.com/channels/${G}/${CH}/1`);
  await h.app.handle(h.interaction('case','view',{id:String(c.number)}));
  assert.match(h.outputs.at(-1).embeds[0].fields.find(x=>x.name==='Mod log').value,/Jump to log entry/);
  await h.app.moderation.tick();assert.equal(h.sends.length,1,'never posted twice');
 }finally{h.close();}
});
test('timeouts show a duration; reason updates and warning removals post as case updates',async()=>{
 const h=harness();try{
  saveModlog(h.store,G,{channel:CH,enabled:true});
  await h.app.handle(h.interaction('timeout'));await flush();
  assert.match(h.sends[0].embeds[0].fields.find(x=>x.name==='Duration').value,/^1h \(ends <t:\d+:R>\)$/);
  const w=h.interaction('warn');await h.app.handle(w);await flush();const wc=h.app.moderation.core.get(G,w.id);assert.equal(wc.state,'succeeded',JSON.stringify(h.outputs.at(-1)));const n=wc.number;
  await h.app.handle(h.interaction('case','reason',{case:String(n),reason:'Clarified'}));await flush();
  assert.equal(h.sends.at(-1).embeds[0].title,`Case #${n} updated`);assert.equal(h.sends.at(-1).embeds[0].fields.find(x=>x.name==='Reason').value,'Clarified');
await h.app.handle(h.interaction('warnings','remove',{case:String(n),reason:'Mistake'}));await flush();
  assert.equal(h.sends.at(-1).embeds[0].title,`Case #${n} | Warning removed`);
 }finally{h.close();}
});
test('disabled actions, the mod log being off and pre-existing entries are never posted',async()=>{
 const h=harness();try{
  h.store.put(G,'mod-case',{id:'old',guild:G,number:1,actor:OWNER,target:TARGET,action:'warn',reason:'old',created:Date.now(),state:'succeeded',events:[]});
  h.store.put(G,'mod-log',{id:'old-1',caseId:'old',state:'queued',event:{action:'succeeded'}});
  await h.app.handle(h.interaction('kick'));await flush();assert.equal(h.sends.length,0);
  saveModlog(h.store,G,{channel:CH,enabled:true,events:{warn:false}});await h.app.moderation.tick();
  assert.equal(h.sends.length,0,'no backfill');assert.equal(h.store.get(G,'mod-log','old-1').state,'skipped');
  await h.app.handle(h.interaction('warn'));await flush();assert.equal(h.sends.length,0);
  await h.app.handle(h.interaction('kick'));await flush();assert.equal(h.sends.length,1);
  // Existing cases still show in history.
  await h.app.handle(h.interaction('case','history'));assert.ok(h.outputs.at(-1).embeds[0].fields.some(f=>f.name.startsWith('Case #1')));
 }finally{h.close();}
});
test('missing channel permissions mark the entry failed without sending',async()=>{
 const h=harness({channelBits:[P.ViewChannel,P.SendMessages]});try{
  saveModlog(h.store,G,{channel:CH,enabled:true});await h.app.handle(h.interaction('kick'));await flush();
  assert.equal(h.sends.length,0);const row=h.store.list(G,'mod-log').find(r=>r.v===2);assert.equal(row.state,'failed');assert.deepEqual(row.missing,['Embed Links']);
  await h.app.handle(h.interaction('settings','view'));assert.match(JSON.stringify(h.outputs.at(-1).embeds),/mod log entries weren’t posted/);
 }finally{h.close();}
});
test('bans, unbans, kicks and timeouts done outside the bot are captured from the audit log',async()=>{
 const h=harness();try{
  saveModlog(h.store,G,{channel:CH,enabled:true});
  const m=h.app.moderation;
  await m.onAuditEntry({id:'1',action:AuditLogEvent.MemberBanAdd,executorId:MOD2,targetId:TARGET,reason:'Raid'},h.guild);
  await m.onAuditEntry({id:'1',action:AuditLogEvent.MemberBanAdd,executorId:MOD2,targetId:TARGET,reason:'Raid'},h.guild);
  await m.onAuditEntry({id:'2',action:AuditLogEvent.MemberBanAdd,executorId:BOT,targetId:TARGET,reason:'Case #1'},h.guild);
  await m.onAuditEntry({id:'3',action:AuditLogEvent.MemberUpdate,executorId:MOD2,targetId:TARGET,reason:null,changes:[{key:'communication_disabled_until',new:new Date(Date.now()+3600000).toISOString()}]},h.guild);
  await m.onAuditEntry({id:'4',action:AuditLogEvent.MemberUpdate,executorId:MOD2,targetId:TARGET,changes:[{key:'nick',new:'x'}]},h.guild);
  await m.onAuditEntry({id:'5',action:AuditLogEvent.MemberKick,executorId:MOD2,targetId:TARGET,reason:'Bye'},h.guild);
  assert.deepEqual(h.sends.map(s=>s.embeds[0].title.replace(/#\d+/,'#N')),['Case #N | Ban','Case #N | Timeout','Case #N | Kick']);
  const ban=m.core.get(G,'audit-1');assert.equal(ban.actor,MOD2);assert.equal(ban.reason,'Raid');assert.equal(ban.details.external,true);
  assert.match(h.sends[0].embeds[0].fields.find(f=>f.name==='Source').value,/outside the bot/);
  assert.equal(m.core.get(G,'audit-3').reason,'No reason provided');
  saveModlog(h.store,G,{events:{external:false}});await m.onAuditEntry({id:'6',action:AuditLogEvent.MemberBanRemove,executorId:MOD2,targetId:TARGET},h.guild);
  assert.equal(h.sends.length,3);assert.equal(h.store.get(G,'mod-case','audit-6'),undefined);
 }finally{h.close();}
});
test('event keys cover the requested actions',()=>{
 const c=a=>({action:a,details:{}});
 for(const a of ['ban','unban','kick','warn','timeout','untimeout','purge'])assert.equal(eventKey(c(a),'succeeded'),a);
 assert.equal(eventKey(c('emergency-on'),'succeeded'),'lockdown');assert.equal(eventKey(c('emergency-off'),'succeeded'),'lockdown');
 assert.equal(eventKey(c('warn'),'void'),'void');assert.equal(eventKey(c('ban'),'note'),'update');assert.equal(eventKey(c('ban'),'proof'),'update');
 assert.equal(eventKey(c('ban'),'appeal:accepted'),null);assert.equal(eventKey(c('ban'),'failed'),null);assert.equal(eventKey(c('configure'),'succeeded'),null);
 assert.equal(modlogEmbed({id:'x',number:4,action:'emergency-on',target:'channel:'+CH,actor:OWNER,reason:'Raid',created:0,details:{}},{action:'succeeded'}).title,'Case #4 | Lockdown');
});
test('no /modlogs command; help points to the dashboard for mod log setup',()=>{
 assert.ok(!commands.some(c=>c.name==='modlogs'));
 const text=helpMenu({page:'mod',guildId:G}).embeds[0].toJSON().description;
 assert.match(text,/Mod log:\*\* set up recording on the dashboard: https:\/\/.+\/dashboard\/123456789012345678\/moderation/);
});
test('dashboard Mod log: channel picker, toggles and test message share settings with the bot',async()=>{
 const h=harness();try{
  const api=createDashboardApi({store:h.store,client:h.client});const id={id:OWNER,manager:true,owner:false};
  const put=data=>api.handle({method:'PUT',endpoint:'plugins/moderation',data,guild:G,identity:id});
  let d=await api.handle({method:'GET',endpoint:'plugins/moderation',guild:G,identity:id});
  assert.equal(d.modlog.enabled,false);assert.equal(d.modlog.eventList.length,11);assert.equal('logChannel' in d.config,false);
  await assert.rejects(put({modlog:{enabled:true}}),/Choose a mod log channel/);
  await assert.rejects(put({logChannel:CH}),/Unsupported/);
  d=await put({modlog:{channel:CH,enabled:true,events:{purge:false}}});
  assert.equal(d.modlog.enabled,true);assert.equal(d.modlog.channel.id,CH);assert.equal(d.modlog.events.purge,false);assert.equal(modlogConfig(h.store,G).channel,CH);
  await put({modlog:{test:true}});assert.equal(h.sends.at(-1).embeds[0].title,'Mod log test message');
  await assert.rejects(put({modlog:{events:{bogus:true}}}),/Invalid mod log actions/);
  h.channel.permissionsFor=()=>perm([P.ViewChannel]);
  await assert.rejects(put({modlog:{test:true}}),/needs Send Messages, Embed Links, Attach Files/);
  h.channel.send=()=>new Promise(()=>{});h.channel.permissionsFor=()=>perm([P.Administrator]);
 }finally{h.close();}
});
test('a stalled mod log send never delays the confirmation and is not resent',async()=>{
 const h=harness();try{
  saveModlog(h.store,G,{channel:CH,enabled:true});let calls=0;h.channel.send=()=>{calls++;return new Promise(()=>{});};
  const started=Date.now();await h.app.handle(h.interaction('kick'));assert.ok(Date.now()-started<150);assert.match(JSON.stringify(h.outputs.at(-1)),/Kicked/);
  await new Promise(r=>setTimeout(r,300));const row=h.store.list(G,'mod-log').find(r=>r.v===2);assert.equal(row.state,'uncertain');
  await h.app.moderation.tick();assert.equal(calls,1);
 }finally{h.close();}
});
