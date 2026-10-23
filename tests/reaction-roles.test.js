import {textOf} from './text-of.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {commands} from '../src/commands.js';
import {createReactionRoles,planReaction,parseEmoji,parseDuration,parseMessageRef,groupEmbed} from '../src/reaction-roles.js';
import {createDashboardApi} from '../src/dashboard-api.js';
import {setPluginEnabled} from '../src/plugins.js';
import {application,config} from '../age-verification/server.js';
import {Store as AgeStore,DEMO_GUILDS} from '../age-verification/core.js';

const G=DEMO_GUILDS[0].id,CH='234567890123456789',R1='300000000000000001',R2='300000000000000002',R3='300000000000000003',HIGH='300000000000000009',REQ='300000000000000004';
function world({botPerms=[P.ManageRoles],clock}={}){
  const store=new Store(':memory:'),messages=new Map(),logs=[],sent=[];
  const role=(id,position,extra={})=>({id,position,managed:false,...extra});
  const roles=new Map([[G,role(G,0)],[R1,role(R1,1)],[R2,role(R2,2)],[R3,role(R3,3)],[REQ,role(REQ,4)],[HIGH,role(HIGH,20)]]);
  const me={id:'bot',permissions:new PermissionsBitField(botPerms),roles:{highest:{position:10}}};
  const reactions=msg=>({cache:new Map()});
  const message=(id,ch)=>{const m={id,channel:ch,reacts:[],edits:[],deleted:false,react:async e=>{if(e==='💥')throw Object.assign(Error('Unknown Emoji'),{code:10014});m.reacts.push(e);},edit:async p=>m.edits.push(p),delete:async()=>{m.deleted=true;},reactions:reactions()};messages.set(id,m);return m;};
  let n=0;
  const channel={id:CH,type:0,permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.AddReactions,P.ReadMessageHistory]),send:async p=>{sent.push(p);return message('9'+String(++n).padStart(17,'0'),channel);},messages:{fetch:async id=>{const m=messages.get(id);if(!m)throw Object.assign(Error('Unknown Message'),{code:10008});return m;}}};
  const members=new Map();
  const member=(id,held=[],highest=15)=>{const m={id,roles:{cache:new Map(held.map(r=>[r,roles.get(r)])),highest:{position:highest},add:async ids=>{for(const r of [].concat(ids))m.roles.cache.set(r,roles.get(r));},remove:async ids=>{for(const r of [].concat(ids))m.roles.cache.delete(r);}}};members.set(id,m);return m;};
  const guild={id:G,ownerId:'999999999999999999',roles:{cache:roles,fetch:async id=>roles.get(id)||null},channels:{cache:new Map([[CH,channel]]),fetch:async id=>id===CH?channel:null},members:{me,fetchMe:async()=>me,fetch:async id=>{const m=members.get(typeof id==='object'?id.user:id);if(!m)throw Object.assign(Error('Unknown Member'),{code:10007});return m;}}};
  channel.guild=guild;
  const client=Object.assign(new EventEmitter(),{user:{id:'bot'},isReady:()=>true,guilds:{cache:new Map([[G,guild]])},channels:{fetch:async()=>channel}});
  let t=clock??1_000_000;
  const rr=createReactionRoles({store,client,log:{log:s=>logs.push(s),warn:s=>logs.push(s)},now:()=>t});
  const react=(msgId,emoji,userId,{bot=false,partial=false}={})=>{
    const msg=messages.get(msgId);msg.guild=guild;
    const removed=[];const r={partial,emoji:/^\d+$/.test(emoji)?{id:emoji,name:'x'}:{id:null,name:emoji},message:msg,users:{remove:async id=>removed.push(id)},removed};
    if(partial)r.fetch=async()=>({...r,partial:false});
    return {r,user:{id:userId,bot}};
  };
  return {store,rr,guild,channel,messages,member,members,me,roles,react,logs,sent,client,tick:ms=>{t+=ms;}};
}

test('emoji, duration and message link parsing',()=>{
  assert.deepEqual(parseEmoji('🎮'),{key:'🎮',display:'🎮',custom:false});
  assert.equal(parseEmoji('❤️').key,'❤');
  assert.deepEqual(parseEmoji('<:party:123456789012345678>'),{key:'123456789012345678',display:'<:party:123456789012345678>',custom:true});
  assert.equal(parseEmoji('<a:spin:123456789012345678>').key,'123456789012345678');
  for(const bad of ['','abc','🎮 🎮 x',':smile:','@everyone'])assert.throws(()=>parseEmoji(bad),/emoji/,bad);
  assert.equal(parseDuration('30m'),30);assert.equal(parseDuration('12h'),720);assert.equal(parseDuration('2w'),20160);assert.equal(parseDuration('off'),0);
  assert.throws(()=>parseDuration('31d'));assert.throws(()=>parseDuration('soon'));
  assert.deepEqual(parseMessageRef(`https://discord.com/channels/${G}/${CH}/345678901234567890`,G),{channel:CH,message:'345678901234567890'});
  assert.throws(()=>parseMessageRef(`https://discord.com/channels/555555555555555555/${CH}/345678901234567890`,G));
  assert.throws(()=>parseMessageRef('nope',G));
});

test('mapping, unique mode, limits, required role and add-only plans',()=>{
  const entries=[{key:'a',role:R1},{key:'b',role:R2},{key:'c',role:R3}];
  const normal={mode:'normal',entries,removeOnUnreact:true};
  assert.deepEqual(planReaction(normal,'a',new Set(),true).add,[R1]);
  assert.deepEqual(planReaction(normal,'zzz',new Set(),true).add,[]);
  assert.deepEqual(planReaction(normal,'a',new Set([R1]),false).remove,[R1]);
  const unique=planReaction({...normal,mode:'unique'},'b',new Set([R1,R3]),true);
  assert.deepEqual(unique.add,[R2]);assert.deepEqual(unique.remove.sort(),[R1,R3].sort());assert.deepEqual(unique.clearReactions.sort(),['a','c']);
  const limited=planReaction({...normal,maxRoles:2},'c',new Set([R1,R2]),true);assert.equal(limited.denied,'limit');assert.equal(limited.removeReaction,true);assert.deepEqual(limited.add,[]);
  assert.deepEqual(planReaction({...normal,maxRoles:2},'b',new Set([R1]),true).add,[R2]);
  assert.equal(planReaction({...normal,requiredRole:REQ},'a',new Set(),true).denied,'required');
  assert.deepEqual(planReaction({...normal,requiredRole:REQ},'a',new Set([REQ]),true).add,[R1]);
  assert.deepEqual(planReaction({...normal,removeOnUnreact:false},'a',new Set([R1]),false).remove,[]);
  const e=groupEmbed({title:null,entries:[{display:'🎮',role:R1}],mode:'unique',duration:1440}).embeds[0].toJSON();
  assert.equal(e.title,'Reaction roles');assert.equal(e.color,0x5865f2);assert.match(e.description,/🎮 – <@&300000000000000001>/);assert.match(e.footer.text,/Pick one role · Roles last 1d/);
});

test('create posts a blurple embed and adds reactions; attach uses an existing message',async()=>{
  const w=world();
  const g=await w.rr.create(w.guild,{channel:CH,title:'Games',entries:[{emoji:'🎮',role:R1},{emoji:'<:party:123456789012345678>',role:R2}]},{id:'999999999999999999'});
  assert.equal(g.owned,true);assert.equal(w.sent[0].embeds[0].toJSON().title,'Games');
  assert.deepEqual(w.messages.get(g.message).reacts,['🎮','123456789012345678']);
  assert.equal(w.store.get(G,'reaction-role',g.id).entries.length,2);
  const existing='345678901234567890';w.messages.set(existing,{id:existing,reacts:[],react:async e=>w.messages.get(existing).reacts.push(e),reactions:{cache:new Map()}});
  const a=await w.rr.create(w.guild,{channel:CH,message:`https://discord.com/channels/${G}/${CH}/${existing}`,entries:[{emoji:'✅',role:R3}]},{id:'999999999999999999'});
  assert.equal(a.owned,false);assert.deepEqual(w.messages.get(existing).reacts,['✅']);
  await assert.rejects(w.rr.create(w.guild,{channel:CH,message:existing},null),/already has reaction roles/);
  await w.rr.addEntry(w.guild,g.id,{emoji:'🎲',role:R3},null);assert.equal(w.messages.get(g.message).edits.length,1);
  await assert.rejects(w.rr.addEntry(w.guild,g.id,{emoji:'🎲',role:REQ},null),/already used/);
  await assert.rejects(w.rr.addEntry(w.guild,g.id,{emoji:'🃏',role:R1},null),/role is already used/);
  await assert.rejects(w.rr.addEntry(w.guild,g.id,{emoji:'💥',role:REQ},null),/cannot use that emoji/);
  await w.rr.removeEntry(w.guild,g.id,'🎲');assert.equal(w.store.get(G,'reaction-role',g.id).entries.length,2);
  await w.rr.remove(w.guild,g.id);assert.equal(w.store.get(G,'reaction-role',g.id),undefined);assert.equal(w.messages.get(g.message).deleted,true);
});

test('setup permissions: Manage Roles, role hierarchy (bot and moderator), managed roles, limits',async()=>{
  await assert.rejects(world({botPerms:[]}).rr.create(world({botPerms:[]}).guild,{channel:CH},null),/Manage Roles/);
  const w=world();
  await assert.rejects(w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:HIGH}]},null),/above the bot/);
  await assert.rejects(w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:G}]},null),/@everyone/);
  w.roles.get(R2).managed=true;await assert.rejects(w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R2}]},null),/managed/);
  const mod=w.member('400000000000000001',[],2);
  await assert.rejects(w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R3}]},mod),/below your own highest role/);
  await w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R1}]},mod);
  w.channel.permissionsFor=()=>new PermissionsBitField([P.ViewChannel,P.SendMessages]);
  await assert.rejects(w.rr.create(w.guild,{channel:CH},null),/Add Reactions/);
  await assert.rejects(w.rr.create(w.guild,{channel:CH,maxRoles:99},null));
  const many=world();for(let k=0;k<50;k++)many.store.put(G,'reaction-role',{entries:[],message:String(k)});
  await assert.rejects(many.rr.create(many.guild,{channel:CH},null),/50 reaction-role messages/);
});

test('reaction events: add/remove, unique, limits, required role, bots, partials, disabled plugin; never posts in channels',async()=>{
  const w=world();
  const g=await w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R1},{emoji:'🎲',role:R2},{emoji:'🎯',role:R3}],maxRoles:2},null);
  const u=w.member('500000000000000001');const sentBefore=w.sent.length;
  let {r,user}=w.react(g.message,'🎮',u.id,{partial:true});await w.rr.onReaction(r,user,true);assert.ok(u.roles.cache.has(R1));
  ({r,user}=w.react(g.message,'🎲',u.id));await w.rr.onReaction(r,user,true);assert.ok(u.roles.cache.has(R2));
  ({r,user}=w.react(g.message,'🎯',u.id));await w.rr.onReaction(r,user,true);assert.ok(!u.roles.cache.has(R3));assert.deepEqual(r.removed,[u.id]);
  ({r,user}=w.react(g.message,'🎮',u.id));await w.rr.onReaction(r,user,false);assert.ok(!u.roles.cache.has(R1));
  ({r,user}=w.react(g.message,'🎮','bot',{bot:true}));await w.rr.onReaction(r,user,true);
  await w.rr.edit(w.guild,g.id,{mode:'unique'});
  const cleared=[];w.messages.get(g.message).reactions.cache.set('🎲',{users:{remove:async id=>cleared.push(id)}});
  ({r,user}=w.react(g.message,'🎯',u.id));await w.rr.onReaction(r,user,true);assert.ok(u.roles.cache.has(R3));assert.ok(!u.roles.cache.has(R2));assert.deepEqual(cleared,[u.id]);
  await w.rr.edit(w.guild,g.id,{requiredRole:REQ});const v=w.member('500000000000000002');
  ({r,user}=w.react(g.message,'🎮',v.id));await w.rr.onReaction(r,user,true);assert.equal(v.roles.cache.size,0);assert.deepEqual(r.removed,[v.id]);
  setPluginEnabled(w.store,G,'reactionroles',false,'x');v.roles.cache.set(REQ,{});
  ({r,user}=w.react(g.message,'🎮',v.id));await w.rr.onReaction(r,user,true);assert.ok(!v.roles.cache.has(R1));
  setPluginEnabled(w.store,G,'reactionroles',true,'x');
  u.roles.add=async()=>{throw Object.assign(Error('Missing Permissions'),{code:50013});};u.roles.cache.set(REQ,{});u.roles.cache.delete(R3);
  ({r,user}=w.react(g.message,'🎮',u.id));await w.rr.onReaction(r,user,true);assert.deepEqual(r.removed,[u.id]);assert.match(w.logs.at(-1),/failed \(50013\)/);
  assert.equal(w.sent.length,sentBefore);
});

test('temporary roles persist expiry and are removed by the sweep, including after a restart',async()=>{
  const w=world();
  const g=await w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R1}],duration:'1h'},null);
  const u=w.member('500000000000000001');const {r,user}=w.react(g.message,'🎮',u.id);await w.rr.onReaction(r,user,true);
  const temp=w.store.get(G,'rr-temp',`${u.id}-${R1}`);assert.equal(temp.expires,1_000_000+3600000);
  await w.rr.sweep();assert.ok(u.roles.cache.has(R1));
  // A fresh instance over the same store (a restart) restores the timer from the persisted expiry.
  const restarted=createReactionRoles({store:w.store,client:w.client,log:{log(){},warn(){}},now:()=>1_000_000+3600001});
  await restarted.sweep();assert.ok(!u.roles.cache.has(R1));assert.equal(w.store.get(G,'rr-temp',`${u.id}-${R1}`),undefined);
  w.store.put(G,'rr-temp',{id:'gone-x',user:'600000000000000000',role:R1,group:g.id,expires:0});await restarted.sweep();assert.equal(w.store.get(G,'rr-temp','gone-x'),undefined);
});

test('deleted messages, roles and channels mark setups as needing attention',async()=>{
  const w=world();const app=createApp(w.client,w.store);
  const g=await w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R1}]},null);
  w.client.emit('roleDelete',{id:R1,guild:{id:G}});assert.match(w.store.get(G,'reaction-role',g.id).broken,/role/);
  w.client.emit('messageDelete',{id:g.message,guildId:G});assert.match(w.store.get(G,'reaction-role',g.id).broken,/message was deleted/);
  w.client.emit('channelDelete',{id:CH,guildId:G});assert.match(w.store.get(G,'reaction-role',g.id).broken,/channel/);
  app.stop();
});

function slash(w,sub,values={},{member,perms=[P.ManageGuild]}={}){
  const outputs=[];
  const i={id:'700000000000000001',guildId:G,guild:w.guild,user:{id:member?.id||'999999999999999999'},member:member||{id:'999999999999999999',roles:{highest:{position:99}}},memberPermissions:new PermissionsBitField(perms),commandName:'reaction-roles',inGuild:()=>true,isButton:()=>false,isModalSubmit:()=>false,isChatInputCommand:()=>true,
    options:{getSubcommand:()=>sub,getString:k=>values[k]??null,getInteger:k=>values[k]??null,getBoolean:k=>values[k]??null,getRole:k=>values[k]?{id:values[k]}:null,getChannel:()=>w.channel},
    reply:async function(p){this.replied=true;outputs.push(p);},editReply:async function(p){outputs.push(p);},deferReply:async function(p){this.deferred=true;},followUp:async p=>outputs.push(p)};
  return {i,outputs};
}
test('every /reaction-roles subcommand confirms publicly; errors and denials reply publicly without diagnostics',async()=>{
  const w=world(),app=createApp(w.client,w.store);
  const subs=commands.find(c=>c.name==='reaction-roles').options.map(o=>o.name);
  const existing='345678901234567890';w.messages.set(existing,{id:existing,react:async()=>{},reactions:{cache:new Map()}});
  const g=await w.rr.create(w.guild,{channel:CH,entries:[{emoji:'🎮',role:R1}]},null);
  const values={create:{emoji:'🎲',role:R2,title:'Pick'},attach:{link:existing},add:{message:g.id,emoji:'🎯',role:R3},remove:{message:g.id,emoji:'🎯'},edit:{message:g.id,mode:'unique'},list:{},delete:{message:g.id}};
  assert.deepEqual(Object.keys(values).sort(),subs.sort());
  for(const sub of ['create','attach','add','remove','edit','list','delete']){
    const {i,outputs}=slash(w,sub,values[sub]);await app.dispatch(i);
    assert.equal(outputs.length,1,sub);assert.ok(!((outputs[0].flags||0)&64),sub);assert.ok(outputs[0].content.length>5,sub);assert.doesNotMatch(textOf(outputs[0]),/wrong|permission/i,sub);
  }
  const err=slash(w,'add',{message:'missing',emoji:'🎮',role:R1});await app.dispatch(err.i);
  assert.match(textOf(err.outputs[0]),/no longer available/);assert.ok(!((err.outputs[0].flags||0)&64));
  const high=slash(w,'create',{emoji:'🎮',role:HIGH});await app.dispatch(high.i);assert.match(textOf(high.outputs[0]),/above the bot’s highest role/);
  const denied=slash(w,'list',{},{member:{id:'400000000000000009',roles:{highest:{position:1}}},perms:[]});await app.dispatch(denied.i);
  assert.match(textOf(denied.outputs[0]),/permission/);assert.ok(!((denied.outputs[0].flags||0)&64));
  setPluginEnabled(w.store,G,'reactionroles',false,'x');const off=slash(w,'list');await app.dispatch(off.i);assert.match(textOf(off.outputs[0]),/turned off/);
  app.stop();
});

test('dashboard API: managers create, edit and delete with CSRF; members are refused',async t=>{
  const w=world();const root=new AgeStore();
  const probe=application({mode:'demo',origin:'http://127.0.0.1:1',port:1},root);await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const c=config({AGE_MODE:'demo',AGE_ORIGIN:`http://127.0.0.1:${port}`,AGE_PORT:String(port)});
  const server=application(c,root,undefined,createDashboardApi({store:w.store,client:w.client,demo:true}));await new Promise(r=>server.listen(port,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});w.store.close();root.db.close();});
  async function login(identity){
    const r=await fetch(c.origin+'/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json',Origin:c.origin},body:JSON.stringify({identity})});
    const cookie=r.headers.get('set-cookie').split(';')[0];const session=await (await fetch(c.origin+'/api/session',{headers:{Cookie:cookie}})).json();
    return (path,{method='GET',data,csrf=session.csrf}={})=>fetch(c.origin+path,{method,headers:{Cookie:cookie,...(data?{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:c.origin}:{})},...(data?{body:JSON.stringify(data)}:{})});
  }
  const url='/api/guilds/'+G+'/plugins/reactionroles';
  const member=await login('member');assert.equal((await member(url)).status,403);
  assert.equal((await member(url,{method:'PUT',data:{create:{channel:CH}}})).status,403);
  const manager=await login('owner');
  const view=await (await manager(url)).json();assert.equal(view.enabled,true);assert.ok(view.channels.some(x=>x.id===CH));assert.equal(view.roles.find(x=>x.id===HIGH).assignable,false);
  assert.equal((await manager(url,{method:'PUT',data:{create:{channel:CH}},csrf:''})).status,403);assert.equal(w.store.list(G,'reaction-role').length,0);
  let r=await manager(url,{method:'PUT',data:{create:{channel:CH,title:'Colors',mode:'unique',entries:[{emoji:'🔴',role:R1}]}}});assert.equal(r.status,200);
  const item=(await r.json()).items[0];assert.equal(item.title,'Colors');assert.equal(item.entries[0].emoji,'🔴');
  r=await manager(url,{method:'PUT',data:{update:{id:item.id,maxRoles:0,duration:'7d',entries:[{emoji:'🔴',role:R1},{emoji:'🔵',role:R2}]}}});assert.equal(r.status,200);
  const updated=(await r.json()).items[0];assert.equal(updated.entries.length,2);assert.equal(updated.duration,10080);
  r=await manager(url,{method:'PUT',data:{update:{id:item.id,entries:[{emoji:'🔴',role:HIGH}]}}});assert.equal(r.status,400);assert.match((await r.json()).error||'',/above the bot/);
  assert.equal((await manager(url,{method:'PUT',data:{create:{channel:CH},delete:item.id}})).status,400);
  assert.equal((await manager(url,{method:'PUT',data:{bogus:1}})).status,400);
  assert.equal((await manager(url,{method:'PUT',data:{delete:item.id}})).status,200);assert.equal(w.store.list(G,'reaction-role').length,0);
  assert.equal((await manager(url,{method:'PUT',data:{enabled:false}})).status,200);
});
