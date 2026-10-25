import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,processSynthetic,adult,DEMO_GUILDS} from '../core.js';
import {boundedFetch,Discord} from '../discord.js';
import {application,config} from '../server.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const A=DEMO_GUILDS[0].id,B=DEMO_GUILDS[1].id,R='333333333333333333',V='444444444444444444';
const settings={reviewerRole:R,verifiedRole:V,enabled:true,betaAcknowledged:true};
function scoped(root=new Store(),guild=A){const s=root.forGuild(guild);s.configure('owner',R,V,true);return s;}

test('only trusted fixtures release portrait and full DOB; birthday boundary',()=>{
  assert.deepEqual(Object.keys(processSynthetic('adult')).sort(),['dob','portrait','synthetic','verified']);
  for(const input of ['unverified','https://id.example',{},'__proto__'])assert.throws(()=>processSynthetic(input),/unverified/);
  assert.equal(adult('2008-10-21',new Date('2026-10-21')),true);assert.equal(adult('2008-10-22',new Date('2026-10-21')),false);assert.equal(adult('2000-02-31'),false);
});
test('exclusive claims, self-review denial, expiry and manual under-18 denial',()=>{
  const s=scoped(),id=s.submit('member','minor',true);assert.throws(()=>s.submit('member','adult',true),/already/);
  assert.throws(()=>s.claim(id,'member'),/own/);assert.throws(()=>s.evidence(id,'r'),/Claim/);s.claim(id,'r');assert.throws(()=>s.claim(id,'r2'),/claimed/);
  assert.throws(()=>s.evidence(id,'r2'),/Claim/);assert.throws(()=>s.decide(id,'r','approved'),/Under 18/);assert.equal(s.get(id).status,'pending');
  s.db.prepare('UPDATE age_cases SET claimUntil=0 WHERE id=?').run(id);s.claim(id,'r2');s.decide(id,'r2','denied');assert.equal(s.get(id).dob,null);assert.equal(s.get(id).status,'denied');assert.throws(()=>s.decide(id,'r2','approved'),/Claim/);s.db.close();
});
test('expired evidence fails closed; deletion/export are scoped to a server',()=>{
  const root=new Store(),a=scoped(root,A),b=scoped(root,B);const id=a.submit('member','adult',true),other=b.submit('member','minor',true);a.claim(id,'r');
  a.db.prepare('UPDATE age_cases SET evidenceUntil=0 WHERE id=?').run(id);assert.throws(()=>a.evidence(id,'r'),/expired/);assert.throws(()=>a.decide(id,'r','approved'),/expired/);
  a.request('member','delete');b.request('member','delete');assert.equal(a.export('member').guild,A);a.erase('member');assert.equal(a.mine('member'),undefined);assert.equal(a.requests().length,0);assert(b.get(other));assert.equal(b.requests().length,1);assert.equal(a.audits().length,2);root.db.close();
});
test('every Store method requires server scope and cannot reach another server’s IDs',()=>{
  const root=new Store(),a=scoped(root,A),b=scoped(root,B);assert.throws(()=>root.list(),/scope/);const id=a.submit('m','adult',true);const request=a.request('m','delete');
  assert.equal(b.get(id),undefined);assert.equal(b.deletion(request),undefined);assert.equal(b.mine('m'),undefined);assert.equal(b.list().length,0);assert.throws(()=>b.claim(id,'r'),/unavailable/);assert.throws(()=>b.evidence(id,'r'),/Claim/);assert.throws(()=>b.decide(id,'r','approved'),/Claim/);assert.throws(()=>b.delivery(id,'roleState','delivered'),/not found/);
  b.erase('m');assert(a.get(id));assert(a.deletion(request));root.db.close();
});
test('SQLite persistence and restart recovery preserve tenant settings and role snapshot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'number-one-age-')),path=join(dir,'test.sqlite');
  try{let root=new Store(path),s=scoped(root);const id=s.submit('m','adult',true);s.claim(id,'r');s.decide(id,'r','approved');s.configure('owner',R,'555555555555555555',true);root.db.close();
    root=new Store(path);s=root.forGuild(A);assert.equal(s.get(id).roleState,'uncertain');assert.equal(s.get(id).roleId,V);assert.equal(s.settings().verifiedRole,'555555555555555555');assert.equal(s.get(id).dob,null);root.db.close();
  }finally{rmSync(dir,{recursive:true});}
});
test('legacy unscoped cases cannot appear under a selected server',()=>{
  const root=new Store();root.db.exec("CREATE TABLE cases(id TEXT, dob TEXT, portrait TEXT); INSERT INTO cases VALUES('old','1995-01-01','legacy');");root.purge();assert.equal(root.db.prepare('SELECT dob FROM cases').get().dob,null);assert.equal(root.forGuild(A).list().length,0);root.db.close();
});
test('JSON parsing hangs are bounded and Discord messages never contain evidence',async()=>{
  await assert.rejects(boundedFetch('unused',{},()=>new Promise(()=>{}),10),/uncertain/);await assert.rejects(boundedFetch('unused',{},async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),10),/uncertain/);
  const calls=[],d=new Discord({},async(url,o)=>{calls.push({url,...o});return {ok:true,status:200,json:async()=>({id:'dm'})};});await d.role(A,'person',V);await d.dm(A,'person','approved');assert(calls[0].url.endsWith(`/guilds/${A}/members/person/roles/${V}`));assert(!JSON.stringify(calls).includes('1995'));assert(!calls.at(-1).body.includes('portrait'));
  await assert.rejects(boundedFetch('unused',{},async()=>({ok:false,status:429,json:async()=>({retry_after:2})})),/rate limited/);
});
async function harness(t,{mode='demo',discord,configure=true}={}){
  const c={mode,origin:'',clientId:'999999999999999999'},root=new Store();if(configure){scoped(root,A);scoped(root,B);}const server=application(c,root,discord);await new Promise(r=>server.listen(0,'127.0.0.1',r));c.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));root.db.close();});
  async function client(cookie){const who=await(await fetch(c.origin+'/api/session',{headers:{Cookie:cookie}})).json();return async(endpoint,data,guild=A,extra={})=>{
    const path=endpoint.startsWith('/')?endpoint:`/api/guilds/${guild}/${endpoint}`;const r=await fetch(c.origin+path,{method:data?'POST':'GET',headers:{Cookie:cookie,Origin:c.origin,'Content-Type':'application/json','X-CSRF-Token':who.csrf,...extra},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};};}
  async function login(identity){const r=await fetch(c.origin+'/api/demo-login',{method:'POST',headers:{Origin:c.origin,'Content-Type':'application/json'},body:JSON.stringify({identity})});return client(r.headers.get('set-cookie').split(';')[0]);}
  return {c,root,login,client};
}
test('public onboarding: owner selects verification roles; members and Discord managers need approval to configure',async t=>{
  const {root,login}=await harness(t,{configure:false}),member=await login('member'),manager=await login('manager'),owner=await login('owner');
  assert.equal((await member('context')).data.enabled,false);assert.equal((await member('submit',{fixture:'adult',consent:true})).status,409);
  assert.equal((await member('settings',settings)).status,403);assert.equal((await manager('settings')).status,403);
  assert.equal((await owner('settings',{...settings,betaAcknowledged:false})).status,400);assert.equal((await owner('settings',{...settings,verifiedRole:R})).status,400);
  assert.equal((await owner('settings',settings)).status,200);assert.equal((await member('context')).data.enabled,true);assert.equal((await member('context',null,B)).data.enabled,false);
  assert.equal((await manager('queue')).status,403);assert.equal((await owner('queue')).status,200);assert.equal(root.forGuild(A).settings().verifiedRole,V);
});
test('HTTP member/reviewer/owner paths and independent cases in multiple communities',async t=>{
  const {root,login}=await harness(t),m=await login('member'),r=await login('reviewer'),r2=await login('reviewer2'),o=await login('owner');
  assert.equal((await m('queue')).status,403);assert.equal((await r('admin')).status,403);assert.equal((await r('settings')).status,403);
  assert.equal((await m('submit',{fixture:'adult',consent:true},A,{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await m('submit',{fixture:'adult',consent:true,rawId:'secret'})).status,400);assert.equal((await m('submit',{fixture:'unverified',consent:true})).status,422);
  const id=(await m('submit',{fixture:'adult',consent:true})).data.id,other=(await m('submit',{fixture:'minor',consent:true},B)).data.id;
  assert.equal((await m('evidence?id='+id)).status,403);assert.equal((await r('evidence?id='+id)).status,409);assert.equal((await r('claim',{id})).status,200);assert.equal((await r2('claim',{id})).status,409);
  assert.deepEqual(Object.keys((await r('evidence?id='+id)).data).sort(),['dob','portrait','synthetic']);assert.equal((await r('decision',{id,decision:'approved'})).data.roleState,'simulated');assert.equal((await r('decision',{id,decision:'denied'})).status,409);
  await m('privacy',{kind:'export'});assert.equal((await m('privacy/export')).data.case.status,'approved');const requestId=(await m('privacy',{kind:'delete'})).data.id;
  assert.equal((await r('admin/delete',{requestId})).status,403);assert.equal((await o('admin/delete',{requestId})).status,200);assert.equal((await m('context')).data.case,null);assert.equal(root.forGuild(B).get(other).status,'pending');
});
test('all tenant endpoints reject guessed IDs from another community',async t=>{
  const {login}=await harness(t),m=await login('member'),r=await login('reviewer'),o=await login('owner');const id=(await m('submit',{fixture:'adult',consent:true})).data.id,requestId=(await m('privacy',{kind:'delete'})).data.id;
  for(const[endpoint,data]of[['claim',{id}],['decision',{id,decision:'approved'}],['admin/delete',{requestId}],['admin/reconcile',{id}]])assert((await o(endpoint,data,B)).status>=400,endpoint);
  assert.equal((await r('evidence?id='+id,null,B)).status,409);assert.equal((await r('queue',null,B)).data.length,0);assert.equal((await o('admin',null,B)).data.requests.length,0);assert.equal((await m('privacy/export',null,B)).data.case,null);
  assert.equal((await r('queue',null,'777777777777777777')).status,403);assert.equal((await m('context')).data.case.id,id);
});
test('self review, forged origins and nonmembers fail closed; paused servers stop submissions',async t=>{
  const {login}=await harness(t),r=await login('reviewer'),outsider=await login('outsider'),o=await login('owner');assert.equal((await outsider('context')).status,403);
  const id=(await r('submit',{fixture:'adult',consent:true})).data.id;assert.equal((await r('claim',{id},A,{Origin:'https://evil.example'})).status,403);assert.equal((await r('claim',{id})).status,409);
  await o('settings',{...settings,enabled:false});assert.equal((await o('claim',{id})).status,409);
});
test('configuration needs application credentials, never a globally fixed server or role',()=>{
  assert.throws(()=>config({AGE_ORIGIN:'http://0.0.0.0:3100'}),/loopback/);assert.throws(()=>config({AGE_MODE:'discord',AGE_ORIGIN:'http://localhost'}),/HTTPS/);
  assert.doesNotThrow(()=>config({AGE_MODE:'discord',AGE_ORIGIN:'https://example.com',AGE_CLIENT_ID:'999999999999999999',AGE_CLIENT_SECRET:'secret',AGE_BOT_TOKEN:'token'}));
});
test('OAuth state, server link, fresh access and uncertain delivery cannot repeat decisions',async t=>{
  let reviewer=true,roles=0,dms=0,exchanges=0,manager=false;const args=[];
  const discord={exchange:async()=>{exchanges++;return {id:'reviewer',guilds:DEMO_GUILDS};},identity:async(guild,id)=>({id,name:'Live test',reviewer,owner:false,manager}),validateVerified:async()=>{},role:async(...a)=>{args.push(a);roles++;throw Error('timeout');},dm:async()=>{dms++;throw Error('closed');}};
  const {c,root,client}=await harness(t,{mode:'discord',discord});
  const login=await fetch(c.origin+'/auth/login?guild='+A,{redirect:'manual'});assert.equal(new URL(login.headers.get('location')).searchParams.get('scope'),'identify guilds');let state=new URL(login.headers.get('location')).searchParams.get('state');
  assert.equal((await fetch(c.origin+'/auth/callback?code=x&state='+state,{redirect:'manual'})).status,403);assert.equal(exchanges,0);
  const login2=await fetch(c.origin+'/auth/login?guild='+A,{redirect:'manual'});state=new URL(login2.headers.get('location')).searchParams.get('state');const binding=login2.headers.get('set-cookie').split(';')[0];
  const callback=await fetch(c.origin+'/auth/callback?code=x&state='+state,{redirect:'manual',headers:{Cookie:binding}});assert.equal(callback.headers.get('location'),'/verify?guild='+A);assert.equal((await fetch(c.origin+'/auth/callback?code=x&state='+state,{redirect:'manual',headers:{Cookie:binding}})).status,403);
  const call=await client(callback.headers.get('set-cookie').split(';')[0]);const id=root.forGuild(A).submit('member','adult',true);await call('claim',{id});
  assert.equal((await call('decision',{id,decision:'approved'})).status,200);assert.equal(root.forGuild(A).get(id).roleState,'uncertain');assert.equal(root.forGuild(A).get(id).dmState,'uncertain');assert.deepEqual(args[0],[A,'member',V]);
  assert.equal((await call('decision',{id,decision:'approved'})).status,409);assert.equal(roles,1);assert.equal(dms,1);reviewer=false;assert.equal((await call('queue')).status,403);assert.equal((await call('settings',settings)).status,403);
});

test('ownership removal during role validation prevents saving settings',async t=>{
  let owner=true;const discord={exchange:async()=>({id:'manager',guilds:DEMO_GUILDS}),identity:async(guild,id)=>({id,name:'Community',manager:true,owner,reviewer:false}),validateRoles:async()=>{owner=false;}};
  const {c,root,client}=await harness(t,{mode:'discord',discord,configure:false});const start=await fetch(c.origin+'/auth/login',{redirect:'manual'});const state=new URL(start.headers.get('location')).searchParams.get('state');const cookie=start.headers.get('set-cookie').split(';')[0];
  const callback=await fetch(c.origin+'/auth/callback?code=test&state='+state,{headers:{Cookie:cookie},redirect:'manual'});const call=await client(callback.headers.get('set-cookie').split(';')[0]);assert.equal((await call('settings',settings)).status,403);assert.equal(root.forGuild(A).settings(),null);
});

test('reviewer removal during approval preflight prevents the decision and role grant',async t=>{
  let reviewer=true,grants=0;const discord={exchange:async()=>({id:'r',guilds:DEMO_GUILDS}),identity:async(guild,id)=>({id,name:'Community',manager:false,owner:false,reviewer}),validateVerified:async()=>{reviewer=false;},role:async()=>{grants++;}};
  const {c,root,client}=await harness(t,{mode:'discord',discord});const id=root.forGuild(A).submit('m','adult',true);root.forGuild(A).claim(id,'r');
  const start=await fetch(c.origin+'/auth/login',{redirect:'manual'});const state=new URL(start.headers.get('location')).searchParams.get('state');const cookie=start.headers.get('set-cookie').split(';')[0];const callback=await fetch(c.origin+'/auth/callback?code=test&state='+state,{headers:{Cookie:cookie},redirect:'manual'});const call=await client(callback.headers.get('set-cookie').split(';')[0]);
  assert.equal((await call('decision',{id,decision:'approved'})).status,403);assert.equal(root.forGuild(A).get(id).status,'pending');assert.equal(grants,0);
});
