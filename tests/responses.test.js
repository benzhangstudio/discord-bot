import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFailure,respond} from '../src/responses.js';
import {UserError} from '../src/user-error.js';
test('permission errors explain the problem, keep references in logs, and edit deferred replies',async()=>{
  const logs=[],sent=[];
  await reportFailure({commandName:'schedule',deferred:true,editReply:async p=>sent.push(p)},Object.assign(Error('Missing Permissions'),{code:50013}),s=>logs.push(s));
  assert.match(sent[0].content,/permissions/);assert.doesNotMatch(sent[0].content,/Reference:/);assert.equal(sent[0].flags,undefined);assert.match(logs[0],/50013/);
});

test('Instagram validation errors preserve the setup menu and send public correction guidance',async()=>{
  const sent=[];
  await reportFailure({deferred:true,instagramSetupUpdate:true,followUp:async p=>sent.push(p),editReply:async()=>{throw Error('Must preserve the menu');}},new UserError('Choose a channel before saving.'),()=>{});
  assert.equal(sent[0].flags,undefined);assert.match(sent[0].content,/Choose a channel/);
});

test('confirmation fallback preserves its completed reply and honors explicit privacy',async()=>{
  const sent=[];let removed=0;
  await respond({deferred:true,ephemeral:false,editReply:async()=>{throw Error('PATCH failed');},followUp:async p=>sent.push(p),deleteReply:async()=>{removed++;}},{content:'Done',flags:64});
  assert.equal(sent[0].flags,64);assert.equal(removed,0);
});

test('expired interaction replies are not retried as follow-ups',async()=>{
  let followups=0;
  await assert.rejects(respond({deferred:true,editReply:async()=>{throw Object.assign(Error('Expired'),{code:10015});},followUp:async()=>{followups++;}},{content:'Done'}));assert.equal(followups,0);
});
test('expired replies log the delivery failure without throwing out of the gateway listener',async()=>{
  const logs=[];
  await assert.doesNotReject(reportFailure({commandName:'events',reply:async()=>{throw Object.assign(Error('expired'),{code:10062});}},Error('Unavailable'),s=>logs.push(s)));
  assert.ok(logs.some(s=>s.includes('Error reply could not be delivered')));
});
test('private source URLs are omitted from public error replies and logs',async()=>{
  const logs=[],sent=[];
  await reportFailure({commandName:'feed',reply:async p=>sent.push(p)},Error('Failed https://provider.example/rss?token=private-value'),s=>logs.push(s));
  assert.ok(!JSON.stringify({logs,sent}).includes('private-value'));assert.match(logs[0],/URL omitted/);
});

for(const privateResponse of [false,true])test(`delayed acknowledgements and fallback keep ${privateResponse?'private':'public'} visibility`,async()=>{
  const {acknowledge}=await import('../src/responses.js');const sent=[];
  const i={privateResponse,acknowledgementDelayMs:0,deferReply:async p=>{sent.push(p);i.deferred=true;i.ephemeral=Boolean(p.flags&64);},editReply:async()=>{throw Error('Stalled update');},followUp:async p=>sent.push(p)};
  await acknowledge(i);await new Promise(resolve=>setTimeout(resolve,10));await respond(i,{content:'Message sent.'});
  assert.equal(Boolean(sent[0].flags&64),privateResponse);assert.equal(Boolean(sent[1].flags&64),privateResponse);assert.equal(sent[1].content,'Message sent.');
});

for(const error of [new UserError('Choose a channel before publishing.'),Object.assign(Error('Too many requests'),{code:'HTTP_429'}),Error('Internal database failure')])test(`errors contain useful guidance without technical details: ${error.name}/${error.code||'none'}`,async()=>{
  const sent=[],logs=[];await reportFailure({reply:async p=>sent.push(p)},error,p=>logs.push(p));
  assert.equal(sent[0].flags,undefined);assert.doesNotMatch(sent[0].content,/Reference:|HTTP_429|database|Error:/);assert.match(logs[0],/^\[[a-f0-9]{8}\]/);
});
test('policy: replies and errors inside a server are always public and still delivered',async()=>{
  const sent=[];const i={guildId:'g',privateResponse:true,reply:async function(p){this.replied=true;sent.push(p);},followUp:async p=>sent.push(p),editReply:async p=>sent.push(p)};
  await respond(i,{content:'Done',flags:64});assert.equal(sent.length,1);assert.ok(!((sent[0].flags||0)&64));
  const j={guildId:'g',reply:async function(p){this.replied=true;sent.push(p);}};
  await reportFailure(j,new UserError('Choose a channel before saving.'),()=>{});assert.equal(sent.length,2);assert.ok(!((sent[1].flags||0)&64));assert.match(sent[1].content,/channel/);
});
