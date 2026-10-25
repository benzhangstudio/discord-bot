import test from 'node:test';
import assert from 'node:assert/strict';
import {application,config} from '../age-verification/server.js';
import {Store as AgeStore,DEMO_GUILDS} from '../age-verification/core.js';
import {Store} from '../src/store.js';
import {createDashboardApi} from '../src/dashboard-api.js';
import {pluginStates,commandPluginEnabled,COMMAND_PLUGINS} from '../src/plugins.js';
import {commands} from '../src/commands.js';
const A=DEMO_GUILDS[0].id,OTHER='555555555555555555';
const MEMBER='666666666666666666';
function accessClient(){
  const guild={ownerId:'owner',members:{fetch:async({user})=>({id:user,user:{bot:false}})}};
  guild.fetch=async()=>guild;
  return {guild,client:{guilds:{cache:new Map([[A,guild]])}}};
}

async function start(t,env={},client=null){
  const bot=new Store(':memory:'),root=new AgeStore();
  const probe=application({mode:'demo',origin:'http://127.0.0.1:1',port:1},root);await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const c=config({AGE_MODE:'demo',AGE_ORIGIN:`http://127.0.0.1:${port}`,AGE_PORT:String(port)});
  const server=application(c,root,undefined,createDashboardApi({store:bot,env,demo:true,client}));await new Promise(r=>server.listen(port,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});bot.close();root.db.close();});
  async function login(identity){
    const r=await fetch(c.origin+'/api/demo-login',{method:'POST',headers:{'Content-Type':'application/json',Origin:c.origin},body:JSON.stringify({identity})});
    const cookie=r.headers.get('set-cookie').split(';')[0];const session=await (await fetch(c.origin+'/api/session',{headers:{Cookie:cookie}})).json();
    const call=(path,{method='GET',data,csrf=session.csrf,origin=c.origin}={})=>fetch(c.origin+path,{method,headers:{Cookie:cookie,...(data?{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:origin}:{})},...(data?{body:JSON.stringify(data)}:{})});
    return {call,session};
  }
  return {c,bot,login};
}

test('dashboard pages: /, /dashboard deep links and legacy /verify?guild= links serve the app shell',async t=>{
  const {c}=await start(t);
  for(const path of ['/','/dashboard','/dashboard/'+A,'/dashboard/'+A+'/moderation','/verify','/verify?guild='+A]){const r=await fetch(c.origin+path);assert.equal(r.status,200,path);assert.match(await r.text(),/id="app"/);}
  assert.equal((await fetch(c.origin+'/dashboard/not-a-guild')).status,401);
  for(const file of ['/dashboard.js','/app.js','/style.css'])assert.equal((await fetch(c.origin+file)).status,200);
});
test('general APIs require sign-in',async t=>{
  const {c}=await start(t);
  for(const path of ['/api/guilds','/api/guilds/'+A+'/overview','/api/guilds/'+A+'/plugins/moderation'])assert.equal((await fetch(c.origin+path)).status,401,path);
  assert.equal((await fetch(c.origin+'/api/guilds/'+A+'/plugins/embeds',{method:'PUT',headers:{'Content-Type':'application/json',Origin:c.origin},body:'{"enabled":false}'})).status,401);
});
test('server list marks bot presence and manageability',async t=>{
  const {login}=await start(t);
  const manager=await (await (await login('manager')).call('/api/guilds')).json();
  assert.equal(manager.guilds.length,2);assert.equal(manager.guilds[0].botPresent,true);assert.equal(manager.guilds[1].botPresent,false);assert(manager.guilds.every(g=>g.manageable));
  const member=await (await (await login('member')).call('/api/guilds')).json();assert(member.guilds.every(g=>!g.manageable));
  assert.deepEqual((await (await (await login('outsider')).call('/api/guilds')).json()).guilds,[]);
});
test('plugin APIs require Manage Server/owner and server membership',async t=>{
  const {login}=await start(t);
  for(const who of ['member','reviewer']){const {call}=await login(who);
    assert.equal((await call('/api/guilds/'+A+'/overview')).status,403);assert.equal((await call('/api/guilds/'+A+'/plugins/moderation')).status,403);
    assert.equal((await call('/api/guilds/'+A+'/plugins/embeds',{method:'PUT',data:{enabled:false}})).status,403);}
  const {call}=await login('manager');assert.equal((await call('/api/guilds/'+OTHER+'/overview')).status,403);
  const overview=await (await call('/api/guilds/'+A+'/overview')).json();assert.deepEqual(overview.plugins,{moderation:true,embeds:true,scheduler:true,instagram:true,reactionroles:true});assert.equal(overview.verification.enabled,false);
  for(const name of ['moderation','automod','embeds','scheduler','instagram','settings'])assert.equal((await call('/api/guilds/'+A+'/plugins/'+name)).status,200,name);
  assert.equal((await call('/api/guilds/'+A+'/plugins/access')).status,403);
  assert.equal((await call('/api/guilds/'+A+'/plugins/unknown')).status,404);assert.equal((await call('/api/guilds/'+A+'/plugins/verification')).status,404);
});
test('writes require CSRF token and same origin',async t=>{
  const {login,bot}=await start(t);const {call}=await login('manager');
  assert.equal((await call('/api/guilds/'+A+'/plugins/embeds',{method:'PUT',data:{enabled:false},csrf:''})).status,403);
  assert.equal((await call('/api/guilds/'+A+'/plugins/embeds',{method:'PUT',data:{enabled:false},csrf:'a'.repeat(64)})).status,403);
  assert.equal((await call('/api/guilds/'+A+'/plugins/embeds',{method:'PUT',data:{enabled:false},origin:'http://evil.example'})).status,403);
  assert.equal(pluginStates(bot,A).embeds,true);
});
test('plugin toggles persist in the bot store and gate their slash commands',async t=>{
  const {login,bot}=await start(t);const {call}=await login('manager');
  const r=await call('/api/guilds/'+A+'/plugins/embeds',{method:'PUT',data:{enabled:false}});assert.equal(r.status,200);assert.equal((await r.json()).enabled,false);
  assert.equal(pluginStates(bot,A).embeds,false);assert.equal(pluginStates(bot,DEMO_GUILDS[1].id).embeds,true);
  assert.equal((await (await call('/api/guilds/'+A+'/overview')).json()).plugins.embeds,false);
  assert.equal(commandPluginEnabled(bot,A,'embed'),false);assert.equal(commandPluginEnabled(bot,A,'schedule'),true);assert.equal(commandPluginEnabled(bot,A,'help'),true);assert.equal(commandPluginEnabled(bot,A,'access'),true);
  assert.equal(COMMAND_PLUGINS.ban,'moderation');
  await call('/api/guilds/'+A+'/plugins/embeds',{method:'PUT',data:{enabled:true}});assert.equal(commandPluginEnabled(bot,A,'embed'),true);
  for(const [name,data] of [['settings',{enabled:false}],['embeds',{enabled:'no'}],['embeds',{enabled:false,extra:1}]])assert.equal((await call('/api/guilds/'+A+'/plugins/'+name,{method:'PUT',data})).status,400,name);
  assert.equal((await call('/api/guilds/'+A+'/plugins/embeds',{method:'POST',data:{enabled:false}})).status,405);
});
test('settings timezone is editable by managers and validated',async t=>{
  const {login,bot}=await start(t);const {call}=await login('manager');
  assert.equal((await call('/api/guilds/'+A+'/plugins/settings',{method:'PUT',data:{timezone:'Mars/Olympus'}})).status,400);
  assert.equal((await call('/api/guilds/'+A+'/plugins/settings',{method:'PUT',data:{timezone:'Asia/Seoul'}})).status,200);assert.equal(bot.get(A,'settings','main').zone,'Asia/Seoul');
});
test('automod edits are owner-only, validated, audited, and need Message Content',async t=>{
  const {login,bot}=await start(t);
  assert.equal((await (await login('manager')).call('/api/guilds/'+A+'/plugins/automod',{method:'PUT',data:{blockInvites:false}})).status,403);
  const {call}=await login('owner');
  assert.equal((await call('/api/guilds/'+A+'/plugins/automod',{method:'PUT',data:{mentionLimit:99}})).status,400);
  assert.equal((await call('/api/guilds/'+A+'/plugins/automod',{method:'PUT',data:{automod:true}})).status,409);
  const r=await call('/api/guilds/'+A+'/plugins/automod',{method:'PUT',data:{blockInvites:false,mentionLimit:5,blockedWords:'foo, bar'}});assert.equal(r.status,200);
  const cfg=bot.get(A,'mod-config','main');assert.equal(cfg.blockInvites,false);assert.equal(cfg.mentionLimit,5);assert.deepEqual(cfg.blockedWords,['foo','bar']);
  assert(bot.list(A,'mod-case').some(c=>c.action==='configure'&&c.actor==='owner'));
});
test('automod can be enabled when Message Content is configured',async t=>{
  const {login,bot}=await start(t,{MODERATION_MESSAGE_CONTENT:'1'});const {call}=await login('owner');
  assert.equal((await call('/api/guilds/'+A+'/plugins/automod',{method:'PUT',data:{enabled:true}})).status,200);assert.equal(bot.get(A,'mod-config','main').automod,true);
});
test('read-only plugin data is scoped to the selected server',async t=>{
  const {login,bot}=await start(t);bot.put(A,'embed',{name:'Welcome',embed:{title:'Hi'}});bot.put(DEMO_GUILDS[1].id,'embed',{name:'Other',embed:{}});bot.put(A,'access',{id:'123',grantedBy:'owner',grantedAt:1});
  const {call}=await login('manager');const embeds=await (await call('/api/guilds/'+A+'/plugins/embeds')).json();assert.deepEqual(embeds.items.map(e=>e.name),['Welcome']);
  const owner=await login('owner');assert.equal((await (await owner.call('/api/guilds/'+A+'/plugins/access')).json()).items[0].user,'123');
});

test('access is dashboard-only; owner can grant, list and revoke with CSRF and server isolation',async t=>{
  assert(!commands.some(c=>c.name==='access'));
  const {client}=accessClient(),{login,bot}=await start(t,{},client),{call}=await login('owner');
  const path='/api/guilds/'+A+'/plugins/access';
  for(const who of ['member','reviewer','manager']){
    const session=await login(who);
    assert.equal((await session.call(path)).status,403);
    for(const data of [{add:MEMBER},{remove:MEMBER}])assert.equal((await session.call(path,{method:'PUT',data})).status,403);
  }
  assert.equal((await call(path,{method:'PUT',data:{add:MEMBER},csrf:''})).status,403);
  assert.equal((await call(path,{method:'PUT',data:{add:MEMBER},origin:'http://evil.example'})).status,403);
  assert.equal((await call('/api/guilds/'+OTHER+'/plugins/access',{method:'PUT',data:{add:MEMBER}})).status,403);
  assert.equal((await call(path,{method:'PUT',data:{add:MEMBER}})).status,200);
  const record=bot.get(A,'access',MEMBER);assert.equal(record.grantedBy,'owner');assert(record.grantedAt);
  assert.equal(bot.get(DEMO_GUILDS[1].id,'access',MEMBER),undefined);
  const view=await (await call(path)).json();assert.equal(view.editable,true);assert.deepEqual(view.commands,[]);assert.equal(view.items[0].user,MEMBER);
  assert.equal((await call(path,{method:'PUT',data:{add:MEMBER}})).status,200);assert.deepEqual(bot.get(A,'access',MEMBER),record);
  assert.equal((await call(path,{method:'PUT',data:{remove:MEMBER}})).status,200);assert.equal(bot.get(A,'access',MEMBER),undefined);
  assert.equal((await call(path,{method:'PUT',data:{remove:MEMBER}})).status,200);
});

test('access rejects invalid fields, bots, nonmembers, full grants, and ownership changes',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const {guild,client}=accessClient();
  const api=createDashboardApi({store,client});
  const write=data=>api.handle({method:'PUT',endpoint:'plugins/access',guild:A,identity:{id:'owner',owner:true,manager:true},data});
  for(const data of [{},{enabled:false},{add:'bad'},{add:MEMBER,remove:MEMBER},{add:MEMBER,grantedBy:'attacker'},{add:null}])await assert.rejects(write(data),e=>e.status===400);
  guild.members.fetch=async()=>({id:MEMBER,user:{bot:true}});await assert.rejects(write({add:MEMBER}),e=>e.status===400);
  guild.members.fetch=async()=>{throw {code:10007};};await assert.rejects(write({add:MEMBER}),e=>e.status===400);
  guild.members.fetch=async()=>({id:MEMBER,user:{bot:false}});
  for(let n=0;n<100;n++)store.put(A,'access',{id:String(n),grantedBy:'owner'});
  await assert.rejects(write({add:MEMBER}),e=>e.status===400);store.remove(A,'access','0');
  guild.fetch=async()=>({ownerId:'new-owner'});
  for(const data of [{add:MEMBER},{remove:'1'.repeat(18)}])await assert.rejects(write(data),e=>e.status===403);
  assert.equal(store.get(A,'access',MEMBER),undefined);
});

for(const stage of ['member','owner'])test(`stalled access ${stage} lookup times out without a late write`,async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const {guild,client}=accessClient();let release;
  const pending=new Promise(resolve=>{release=resolve;});
  if(stage==='member')guild.members.fetch=()=>pending;else guild.fetch=()=>pending;
  const api=createDashboardApi({store,client,accessTimeoutMs:5});
  await assert.rejects(api.handle({method:'PUT',endpoint:'plugins/access',guild:A,identity:{id:'owner',owner:true,manager:true},data:{add:MEMBER}}),e=>e.status===504);
  release(stage==='member'?{id:MEMBER,user:{bot:false}}:guild);await new Promise(setImmediate);
  assert.deepEqual(store.list(A,'access'),[]);
});
