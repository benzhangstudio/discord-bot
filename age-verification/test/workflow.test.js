import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,DEMO_GUILDS} from '../core.js';
import {VerificationWorkflow} from '../workflow.js';

const A=DEMO_GUILDS[0].id,B=DEMO_GUILDS[1].id,R='333333333333333333',V='444444444444444444';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(t,options={}){
  const root=new Store(),store=root.forGuild(A),calls=[];t.after(()=>root.db.close());
  store.configure('owner',R,V,true);
  const discord={
    validateVerified:async()=>{},member:async()=>({roles:[],user:{bot:false}}),
    role:async(...args)=>calls.push(['role',...args]),dm:async(...args)=>calls.push(['dm',...args]),
    removeRole:async(...args)=>calls.push(['remove',...args]),...options.discord
  };
  const authorize=options.authorize||((guild,session)=>({id:session.id,reviewer:session.id==='reviewer',owner:session.id==='owner'}));
  const workflow=new VerificationWorkflow({root,discord,authorize,mode:'discord',timeout:options.timeout??1000});
  const id=store.submit('member','adult',true);store.claim(id,'reviewer');
  return {root,store,id,workflow,calls,discord};
}
const reviewer={id:'reviewer'},owner={id:'owner'};

test('decision commits once; role and notification have independent delivery results',async t=>{
  const {store,id,workflow,calls}=setup(t,{discord:{dm:async()=>{throw Object.assign(Error(),{discordStatus:403});}}});
  const result=await workflow.decide(store,id,reviewer,'approved');
  assert.equal(result.status,'approved');assert.equal(result.roleState,'delivered');assert.equal(result.dmState,'failed');
  assert.equal(store.get(id).dob,null);assert.equal(store.get(id).portrait,null);
  await assert.rejects(workflow.decide(store,id,reviewer,'approved'),e=>e.status===409);
  assert.equal(calls.filter(c=>c[0]==='role').length,1);
});

test('a pending deletion immediately blocks claims, evidence and decisions',async t=>{
  const {store,id,workflow,calls}=setup(t);store.request('member','delete');
  assert.throws(()=>workflow.claim(store,id,'reviewer'),/deletion/);
  assert.throws(()=>workflow.evidence(store,id,'reviewer'),/deletion/);
  await assert.rejects(workflow.decide(store,id,reviewer,'approved'),/deletion/);
  assert.equal(store.get(id).status,'pending');assert.equal(calls.length,0);
});

test('verification roles cannot be repurposed as reviewer credentials',t=>{
  const {store,id}=setup(t);
  assert.throws(()=>store.configure('owner',V,'555555555555555555',true),/separate reviewer/);
  store.decide(id,'reviewer','approved');
  assert.throws(()=>store.configure('owner',V,'555555555555555555',true),/separate reviewer/);
  assert.equal(store.settings().reviewerRole,R);
});

test('configuration changes during approval preflight stop the decision and delivery',async t=>{
  let store;
  const context=setup(t,{discord:{validateVerified:async()=>store.configure('owner',R,V,true)}});store=context.store;
  await assert.rejects(context.workflow.decide(store,context.id,reviewer,'approved'),/settings changed/);
  assert.equal(store.get(context.id).status,'pending');assert.equal(context.calls.length,0);
});

test('two concurrent decisions cannot both pass preflight or deliver',async t=>{
  const gate=deferred(),entered=deferred();
  const {store,id,workflow,calls}=setup(t,{discord:{validateVerified:()=>{entered.resolve();return gate.promise;}}});
  const first=workflow.decide(store,id,reviewer,'approved');await entered.promise;
  await assert.rejects(workflow.decide(store,id,reviewer,'denied'),/being updated/);
  assert.throws(()=>workflow.claim(store,id,'other'),/being updated/);
  gate.resolve();await first;assert.equal(calls.filter(c=>c[0]==='role').length,1);
});

test('deletion cannot race an approval or erase records during delivery',async t=>{
  const gate=deferred(),entered=deferred();
  const {store,id,workflow}=setup(t,{discord:{role:()=>{entered.resolve();return gate.promise;}}});
  const decision=workflow.decide(store,id,reviewer,'approved');await entered.promise;
  const request=store.request('member','delete');
  await assert.rejects(workflow.erase(store,request,owner),/being updated/);assert(store.get(id));
  gate.resolve();await decision;await workflow.erase(store,request,owner);assert.equal(store.get(id),undefined);
});

for(const stage of ['validateVerified','member','authorize'])test(`stalled ${stage} cannot complete a late decision`,async t=>{
  const gate=deferred();const options={timeout:15};
  if(stage==='authorize')options.authorize=()=>gate.promise;else options.discord={[stage]:()=>gate.promise};
  const {store,id,workflow,calls}=setup(t,options);
  await assert.rejects(workflow.decide(store,id,reviewer,'approved'),e=>e.status===504);
  gate.resolve(stage==='authorize'?{id:'reviewer',reviewer:true}:{roles:[]});await new Promise(setImmediate);
  assert.equal(store.get(id).status,'pending');assert.equal(calls.length,0);
});

for(const stage of ['role','dm'])test(`stalled ${stage} ends uncertain, saves the decision and never retries`,async t=>{
  let attempts=0;const gate=deferred();
  const {store,id,workflow}=setup(t,{timeout:15,discord:{[stage]:()=>{attempts++;return gate.promise;}}});
  await workflow.decide(store,id,reviewer,'approved');
  assert.equal(store.get(id).status,'approved');assert.equal(store.get(id)[stage==='role'?'roleState':'dmState'],'uncertain');
  gate.resolve();await new Promise(setImmediate);assert.equal(attempts,1);
  await assert.rejects(workflow.decide(store,id,reviewer,'approved'));assert.equal(attempts,1);
});

test('lost ownership during role removal preserves the privacy request and records',async t=>{
  let owns=true;
  const {store,id,workflow}=setup(t,{authorize:(guild,session)=>({id:session.id,reviewer:true,owner:owns}),discord:{removeRole:async()=>{owns=false;}}});
  await workflow.decide(store,id,reviewer,'approved');const request=store.request('member','delete');
  await assert.rejects(workflow.erase(store,request,owner),e=>e.status===403);
  assert(store.get(id));assert(store.deletion(request));
});

test('reconciliation handles a departed member without retrying a grant',async t=>{
  const {store,id,workflow,calls,discord}=setup(t,{discord:{role:async()=>{throw Error('unknown');}}});
  await workflow.decide(store,id,reviewer,'approved');
  discord.member=async()=>{throw Object.assign(Error(),{discordStatus:404,discordCode:10007});};
  await workflow.reconcile(store,id,owner);assert.equal(store.get(id).roleState,'not_delivered');
  assert.equal(calls.filter(c=>c[0]==='role').length,0);
});

test('failed audit persistence rolls back decision and evidence removal together',t=>{
  const {store,id}=setup(t);
  store.db.exec("CREATE TRIGGER fail_decision BEFORE INSERT ON age_audit WHEN NEW.action='approved' BEGIN SELECT RAISE(ABORT,'write failure'); END;");
  assert.throws(()=>store.decide(id,'reviewer','approved'),/write failure/);
  assert.equal(store.get(id).status,'pending');assert.equal(store.get(id).dob,'1995-04-12');assert.equal(store.get(id).roleState,'not_requested');
});

test('workflow operations cannot reach another community’s cases or privacy requests',async t=>{
  const {root,store,id,workflow,calls}=setup(t);const request=store.request('member','delete'),other=root.forGuild(B);other.configure('owner',R,V,true);
  await assert.rejects(workflow.decide(other,id,reviewer,'approved'));
  await assert.rejects(workflow.erase(other,request,owner));assert(store.get(id));assert.equal(calls.length,0);
});

test('deleting a reviewer’s personal case cannot erase their decisions on another member',t=>{
  const {store,id}=setup(t);const own=store.submit('reviewer','adult',true);
  store.decide(id,'reviewer','approved');store.request('reviewer','delete');store.erase('reviewer');
  assert.equal(store.get(own),undefined);assert.equal(store.get(id).status,'approved');
  assert(store.audits().some(row=>row.caseId===id&&row.actor==='reviewer'&&row.action==='approved'));
});
