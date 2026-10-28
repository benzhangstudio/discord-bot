import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {commands} from '../src/commands.js';
import {canUseCommand,commandPermission,dashboardAccess} from '../src/permissions.js';
import {createApp} from '../src/app.js';
import {createDashboardApi} from '../src/dashboard-api.js';
import {Store} from '../src/store.js';
import {Store as AgeStore,DEMO_GUILDS} from '../age-verification/core.js';
import {application} from '../age-verification/server.js';

const G=DEMO_GUILDS[0].id,OTHER=DEMO_GUILDS[1].id,R='333333333333333333',V='444444444444444444';
const permission=bits=>new PermissionsBitField(bits);

test('every command has an explicit native Discord permission and denies ordinary members',()=>{
  for(const command of commands){
    const ordinary={guild:{ownerId:'owner'},user:{id:'member'},memberPermissions:permission([])};
    assert.equal(canUseCommand(ordinary,command.name),false,command.name);
    assert.equal(command.default_member_permissions,String(commandPermission(command.name)));
    assert.equal(canUseCommand({...ordinary,user:{id:'owner'}},command.name),true);
    assert.equal(canUseCommand({...ordinary,memberPermissions:permission([P.Administrator])},command.name),true);
    assert.equal(canUseCommand({...ordinary,memberPermissions:permission([commandPermission(command.name)])},command.name),true);
  }
  const manager={guild:{ownerId:'owner'},user:{id:'manager'},memberPermissions:permission([P.ManageGuild])};
  for(const command of ['ban','kick','warn','purge','timeout'])assert.equal(canUseCommand(manager,command),false,command);
  assert.equal(canUseCommand({...manager,memberPermissions:null,member:{permissions:permission([P.Administrator])}},'settings'),false);
});

for(const customId of ['help:topic','help:manual','rsvp:event:1:going','embed:draft:publish','embedform:draft:form','eventform:event:edit','instagram:draft:save','modpage:history:member:2:staff','mod-appeal:case'])test(`ordinary members cannot access component ${customId}`,async t=>{
  const store=new Store(':memory:'),client=new EventEmitter(),app=createApp(client,store);t.after(()=>{app.stop();store.close();});
  store.put(G,'access',{id:'member',grantedBy:'owner'});store.put(G,'dashboard-access',{id:'member',grantedBy:'owner'});
  const before=store.db.prepare('SELECT * FROM records').all(),outputs=[];
  const i={guildId:G,guild:{ownerId:'owner'},user:{id:'member'},memberPermissions:permission([]),customId,inGuild:()=>true,isChatInputCommand:()=>false,isButton:()=>true,isModalSubmit:()=>false,
    options:new Proxy({}, {get(){throw Error('No unauthorized data access');}}),reply:async payload=>outputs.push(payload)};
  await app.dispatch(i);assert.equal(outputs.length,1);assert.match(outputs[0].embeds[0].description,/Discord permission/);assert.deepEqual(outputs[0].components,[]);
  assert.deepEqual(store.db.prepare('SELECT * FROM records').all(),before);
});

test('dashboard access depends on native privileges and ignores legacy grants',()=>{
  assert.equal(dashboardAccess({owner:false,manager:false,dashboard:true}).dashboard,false);
  assert.equal(dashboardAccess({manager:true}).dashboard,true);
  assert.equal(dashboardAccess({administrator:true}).securityAdmin,true);
  assert.equal(dashboardAccess({manager:true}).securityAdmin,false);
});

test('every dashboard write rejects revoked or stalled authorization without changing storage',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const api=createDashboardApi({store,accessTimeoutMs:10});
  for(const reauthorize of [async()=>({id:'manager',manager:false}),()=>new Promise(()=>{})]){
    await assert.rejects(api.handle({guild:G,endpoint:'plugins/embeds',method:'PUT',data:{enabled:false},identity:{id:'manager',manager:true,reauthorize}}));
    assert.equal(store.get(G,'dashboard-plugins','main'),undefined);
  }
});

test('dashboard managers cannot read hidden schedules or moderation evidence',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const member={id:'manager',permissions:permission([P.ManageGuild]),user:{bot:false}},channels=new Map([
    ['visible',{id:'visible',type:0,name:'public',permissionsFor:()=>permission([P.ViewChannel])}],
    ['secret',{id:'secret',type:0,name:'secret',permissionsFor:()=>permission([])}]
  ]);
  const guild={members:{fetch:async()=>member},channels:{cache:channels},roles:{cache:new Map()}};
  const api=createDashboardApi({store,client:{guilds:{cache:new Map([[G,guild]])}}});
  for(const channel of ['visible','secret'])store.put(G,'event',{id:channel,title:channel,channel,start:Date.now()+60000,duration:60,zone:'UTC'});
  store.put(G,'mod-case',{id:'private',reason:'Private evidence',state:'succeeded',created:Date.now(),events:[]});
  const schedule=await api.handle({guild:G,endpoint:'plugins/scheduler',method:'GET',identity:{id:'manager',manager:true}});
  assert.deepEqual(schedule.items.map(e=>e.id),['visible']);assert.deepEqual(schedule.channels.map(c=>c.id),['visible']);
  const moderation=await api.handle({guild:G,endpoint:'plugins/moderation',method:'GET',identity:{id:'manager',manager:true}});
  assert.deepEqual(moderation.recentCases,[]);assert.doesNotMatch(JSON.stringify(moderation),/Private evidence/);
});

async function portal(t){
  const bot=new Store(':memory:'),root=new AgeStore(),members=new Map([
    ['owner',{owner:true,administrator:true,manager:true,reviewer:true}],
    ['admin',{administrator:true,manager:true}],['manager',{manager:true}],['reviewer',{reviewer:true}],['member',{}]
  ]);
  const discord={
    exchange:async id=>({id,guilds:[{id:G,name:'Community',owner:id==='owner',manageable:!!members.get(id)?.manager}]}),
    identity:async(guild,id)=>{assert.equal(guild,G);assert(members.has(id));return {id,name:'Community',ownerId:'owner',...members.get(id)};},
    validateRoles:async()=>{},roleOptions:async()=>[{id:R,name:'Reviewers',canVerify:false},{id:V,name:'Test verified',canVerify:true}]
  };
  const c={mode:'discord',origin:'',clientId:'999999999999999999'},plugins=createDashboardApi({store:bot}),server=application(c,root,discord,plugins);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));c.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});bot.close();root.db.close();});
  async function login(id){
    const start=await fetch(c.origin+'/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state');
    const callback=await fetch(c.origin+'/auth/callback?code='+id+'&state='+state,{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie').split(';')[0]}}),cookie=callback.headers.get('set-cookie').split(';')[0];
    const session=await(await fetch(c.origin+'/api/session',{headers:{Cookie:cookie}})).json();
    return {session,call:async(endpoint,data,method=data?'POST':'GET',guild=G)=>{
      const path=endpoint.startsWith('/')?endpoint:`/api/guilds/${guild}/${endpoint}`;
      const response=await fetch(c.origin+path,{method,headers:{Cookie:cookie,...(data?{Origin:c.origin,'Content-Type':'application/json','X-CSRF-Token':session.csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});
      return {status:response.status,data:await response.json()};
    }};
  }
  return {bot,root,members,discord,login};
}

test('ordinary members can only submit, read/export their own verification and request their own deletion',async t=>{
  const {bot,root,login}=await portal(t);root.forGuild(G).configure('owner',R,V,true);
  bot.put(G,'access',{id:'member',grantedBy:'owner'});bot.put(G,'dashboard-access',{id:'member',grantedBy:'owner'});
  const user=await login('member');assert.deepEqual(user.session.guilds,[]);
  for(const endpoint of ['overview','plugins/access','plugins/embeds','plugins/moderation','plugins/scheduler','plugins/instagram','settings','queue','admin'])assert.equal((await user.call(endpoint)).status,403,endpoint);
  for(const [endpoint,data] of [['claim',{id:'someone-else'}],['decision',{id:'someone-else',decision:'approved'}],['admin/delete',{requestId:'someone-else'}],['settings',{reviewerRole:R,verifiedRole:V,enabled:true,betaAcknowledged:true}]])assert.equal((await user.call(endpoint,data)).status,403,endpoint);
  assert.equal((await user.call('submit',{fixture:'adult',consent:true,member:'other'})).status,400);
  assert.equal((await user.call('submit',{fixture:'adult',consent:true})).status,201);
  root.forGuild(G).submit('other','minor',true);
  const exported=await user.call('privacy/export');assert.equal(exported.data.case.id,root.forGuild(G).mine('member').id);assert.doesNotMatch(JSON.stringify(exported.data),/2015-09-23/);
  assert.equal((await user.call('context',null,'GET',OTHER)).status,403);
  assert.equal((await user.call('privacy',{kind:'delete'})).status,200);
});

test('owners, administrators, managers and reviewers have distinct portal capabilities',async t=>{
  const {login,root}=await portal(t);root.forGuild(G).configure('owner',R,V,true);
  for(const who of ['owner','admin','manager']){
    const user=await login(who);assert.equal(user.session.guilds.length,1,who);assert.equal((await user.call('overview')).status,200);
    const info=(await user.call('context')).data;
    assert.equal(info.capabilities.configure,who!=='manager');
    assert.equal((await user.call('admin')).status,who==='manager'?403:200);
    assert.equal((await user.call('queue')).status,who==='owner'?200:403);
  }
  const reviewer=await login('reviewer');assert.deepEqual(reviewer.session.guilds,[]);assert.equal((await reviewer.call('queue')).status,200);assert.equal((await reviewer.call('overview')).status,403);
});

test('permission revocation blocks the next protected request and asynchronous security save',async t=>{
  const {members,discord,login,root}=await portal(t),manager=await login('manager');
  assert.equal((await manager.call('plugins/embeds',{enabled:false},'PUT')).status,200);
  members.set('manager',{});assert.equal((await manager.call('plugins/embeds')).status,403);assert.equal((await manager.call('plugins/embeds',{enabled:true},'PUT')).status,403);
  const admin=await login('admin');discord.validateRoles=async()=>members.set('admin',{});
  assert.equal((await admin.call('settings',{reviewerRole:R,verifiedRole:V,enabled:true,betaAcknowledged:true})).status,403);assert.equal(root.forGuild(G).settings(),null);
});
