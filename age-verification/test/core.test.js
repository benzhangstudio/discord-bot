import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, processSynthetic, adult } from '../core.js';
import { boundedFetch, Discord } from '../discord.js';
import { application, config } from '../server.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('only verified server fixtures release portrait and full DOB; no raw fields',()=>{
  assert.deepEqual(Object.keys(processSynthetic('adult')).sort(),['dob','portrait','synthetic','verified']);
  for(const input of ['unverified','https://id.example',{},'__proto__']) assert.throws(()=>processSynthetic(input),/unverified/);
  assert.equal(adult('2008-10-21',new Date('2026-10-21')),true);
  assert.equal(adult('2008-10-22',new Date('2026-10-21')),false);
  assert.equal(adult('2000-02-31'),false);
});
test('exclusive claims, expiry, explicit minor denial and irreversible decisions',()=>{
  const s=new Store();const id=s.submit('member','minor',true);
  assert.throws(()=>s.submit('member','adult',true),/already/);
  assert.throws(()=>s.evidence(id,'r'),/Claim/);s.claim(id,'r');
  assert.throws(()=>s.claim(id,'r2'),/claimed/);
  assert.throws(()=>s.evidence(id,'r2'),/Claim/);
  assert.throws(()=>s.decide(id,'r','approved'),/Under 18/);assert.equal(s.get(id).status,'pending');
  s.db.prepare('UPDATE cases SET claimUntil=0 WHERE id=?').run(id);s.claim(id,'r2');
  s.decide(id,'r2','denied');assert.equal(s.get(id).dob,null);assert.equal(s.get(id).status,'denied');
  assert.throws(()=>s.decide(id,'r2','approved'),/Claim/);s.db.close();
});
test('expired evidence fails closed; privacy deletion removes linking records',()=>{
  const s=new Store();const id=s.submit('member','adult',true);s.claim(id,'r');
  s.db.prepare('UPDATE cases SET evidenceUntil=0 WHERE id=?').run(id);
  assert.throws(()=>s.evidence(id,'r'),/expired/);assert.throws(()=>s.decide(id,'r','approved'),/expired/);
  s.request('member','delete');assert(s.export('member').case);s.erase('member');
  assert.equal(s.mine('member'),undefined);assert.equal(s.db.prepare('SELECT count(*) AS n FROM privacy').get().n,0);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM audit WHERE actor IS NOT NULL OR caseId IS NOT NULL').get().n,0);s.db.close();
});
test('network and JSON-body hangs finish; role and DM payloads contain no evidence',async()=>{
  await assert.rejects(boundedFetch('unused',{},()=>new Promise(()=>{}),10),/uncertain/);
  await assert.rejects(boundedFetch('unused',{},async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),10),/uncertain/);
  const calls=[];const d=new Discord({botToken:'secret',guild:'guild',verifiedRole:'role'},async(url,o)=>{calls.push({url,...o});return {ok:true,status:200,json:async()=>({id:'dm'})};});
  await d.role('person');await d.dm('person','approved');
  assert(calls[0].url.endsWith('/guilds/guild/members/person/roles/role'));
  assert(!JSON.stringify(calls).includes('1995'));assert(!calls.at(-1).body.includes('portrait'));
  await assert.rejects(boundedFetch('unused',{},async()=>({ok:false,status:429,json:async()=>({retry_after:2})})),/rate limited/);
});
async function harness(t) {
  const c={mode:'demo',origin:'',verifiedRole:'verified'};const s=new Store();const server=application(c,s);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));c.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));s.db.close();});
  async function login(identity) {
    const r=await fetch(c.origin+'/api/demo-login',{method:'POST',headers:{Origin:c.origin,'Content-Type':'application/json'},body:JSON.stringify({identity})});
    const cookie=r.headers.get('set-cookie').split(';')[0];
    const who=await (await fetch(c.origin+'/api/me',{headers:{Cookie:cookie}})).json();
    return async(path,data,extra={})=>{const response=await fetch(c.origin+path,{method:data?'POST':'GET',headers:{Cookie:cookie,Origin:c.origin,'Content-Type':'application/json','X-CSRF-Token':who.csrf,...extra},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()};};
  }
  return {c,s,login};
}
test('HTTP member, reviewer, owner boundaries; complete approve/export/delete demo',async t=>{
  const {s,login}=await harness(t),m=await login('member'),r=await login('reviewer'),r2=await login('reviewer2'),o=await login('owner');
  assert.equal((await m('/api/queue')).status,403);assert.equal((await r('/api/admin')).status,403);
  assert.equal((await m('/api/submit',{fixture:'adult',consent:true},{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await m('/api/submit',{fixture:'adult',consent:true,rawId:'secret'})).status,400);
  assert.equal((await m('/api/submit',{fixture:'unverified',consent:true})).status,422);assert.equal(s.list().length,0);
  const id=(await m('/api/submit',{fixture:'adult',consent:true})).data.id;
  assert.equal((await m('/api/evidence?id='+id)).status,403);
  assert.equal((await r('/api/evidence?id='+id)).status,409);
  assert.equal((await r('/api/claim',{id})).status,200);assert.equal((await r2('/api/claim',{id})).status,409);
  const e=await r('/api/evidence?id='+id);assert.deepEqual(Object.keys(e.data).sort(),['dob','portrait','synthetic']);
  assert.equal((await r('/api/decision',{id,decision:'approved'})).data.roleState,'simulated');
  assert.equal((await r('/api/decision',{id,decision:'denied'})).status,409);
  await m('/api/privacy',{kind:'export'});assert.equal((await m('/api/privacy/export')).data.case.status,'approved');
  const requestId=(await m('/api/privacy',{kind:'delete'})).data.id;
  assert.equal((await r('/api/admin/delete',{requestId})).status,403);
  assert.equal((await o('/api/admin/delete',{requestId})).status,200);assert.equal((await m('/api/me')).status,401);
});
test('HTTP requires membership and CSRF origin; no self review',async t=>{
  const {login}=await harness(t);const outsider=await login('outsider');assert.equal((await outsider('/api/me')).status,403);
  const r=await login('reviewer');const id=(await r('/api/submit',{fixture:'adult',consent:true})).data.id;
  assert.equal((await r('/api/claim',{id},{Origin:'https://evil.example'})).status,403);
  await r('/api/claim',{id});assert.equal((await r('/api/decision',{id,decision:'approved'})).status,403);
});
test('configuration rejects exposed demo and unsafe Discord roles',()=>{
  assert.throws(()=>config({AGE_ORIGIN:'http://0.0.0.0:3100'}),/loopback/);
  assert.throws(()=>config({AGE_MODE:'discord',AGE_ORIGIN:'http://localhost'}),/HTTPS/);
  assert.throws(()=>config({AGE_MODE:'discord',AGE_ORIGIN:'https://example.com'}),/credentials/);
});
test('SQLite cases, claims, decisions and privacy requests survive reopening',()=>{
  const dir=mkdtempSync(join(tmpdir(),'number-one-age-'));const path=join(dir,'test.sqlite');
  try{let s=new Store(path);const id=s.submit('m','adult',true);s.claim(id,'r');const request=s.request('m','delete');s.db.close();
    s=new Store(path);assert.equal(s.get(id).claimant,'r');s.decide(id,'r','approved');s.db.close();
    s=new Store(path);assert.equal(s.get(id).status,'approved');assert.equal(s.get(id).dob,null);assert(s.db.prepare('SELECT id FROM privacy WHERE id=?').get(request));s.db.close();
  }finally{rmSync(dir,{recursive:true});}
});
test('OAuth state binding, fresh permissions and uncertain delivery never repeat decisions',async t=>{
  const c={mode:'discord',origin:'',clientId:'client',verifiedRole:'verified',guild:'guild'};const s=new Store();let reviewer=true,roles=0,dms=0,exchanges=0;
  const discord={exchange:async()=>{exchanges++;return {id:'reviewer'};},identity:async id=>({id,reviewer,owner:false}),role:async()=>{roles++;throw Error('timeout');},dm:async()=>{dms++;throw Error('blocked');}};
  const server=application(c,s,discord);await new Promise(r=>server.listen(0,'127.0.0.1',r));c.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));s.db.close();});
  const login=await fetch(c.origin+'/auth/login',{redirect:'manual'});const state=new URL(login.headers.get('location')).searchParams.get('state');const binding=login.headers.get('set-cookie').split(';')[0];
  const bad=await fetch(c.origin+'/auth/callback?code=x&state='+state,{redirect:'manual'});assert.equal(bad.status,403);assert.equal(exchanges,0);
  const login2=await fetch(c.origin+'/auth/login',{redirect:'manual'});const state2=new URL(login2.headers.get('location')).searchParams.get('state');const binding2=login2.headers.get('set-cookie').split(';')[0];
  const callback=await fetch(c.origin+'/auth/callback?code=x&state='+state2,{redirect:'manual',headers:{Cookie:binding2}});assert.equal(callback.status,302);
  assert.equal((await fetch(c.origin+'/auth/callback?code=x&state='+state2,{redirect:'manual',headers:{Cookie:binding2}})).status,403);
  const cookie=callback.headers.get('set-cookie').split(';')[0];const me=await(await fetch(c.origin+'/api/me',{headers:{Cookie:cookie}})).json();
  const call=(path,data)=>fetch(c.origin+path,{method:data?'POST':'GET',headers:{Cookie:cookie,Origin:c.origin,'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(data?{body:JSON.stringify(data)}:{})});
  const id=s.submit('member','adult',true);await call('/api/claim',{id});
  const decision=await call('/api/decision',{id,decision:'approved'});assert.equal(decision.status,200);assert.equal(s.get(id).roleState,'uncertain');assert.equal(s.get(id).dmState,'uncertain');
  assert.equal((await call('/api/decision',{id,decision:'approved'})).status,409);assert.equal(roles,1);assert.equal(dms,1);
  reviewer=false;assert.equal((await call('/api/queue')).status,403);
});
