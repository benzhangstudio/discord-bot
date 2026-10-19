import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFailure} from '../src/responses.js';
import {UserError} from '../src/user-error.js';
test('permission errors explain the problem, include a reference, and edit deferred replies',async()=>{
  const logs=[],sent=[];
  await reportFailure({commandName:'schedule',deferred:true,editReply:async p=>sent.push(p)},Object.assign(Error('Missing Permissions'),{code:50013}),s=>logs.push(s));
  assert.match(sent[0].content,/permissions/);assert.match(sent[0].content,/Reference:/);assert.equal(sent[0].flags,undefined);assert.match(logs[0],/50013/);
});

test('Instagram validation errors preserve the setup menu and send private correction guidance',async()=>{
  const sent=[];
  await reportFailure({deferred:true,instagramSetupUpdate:true,followUp:async p=>sent.push(p),editReply:async()=>{throw Error('Must preserve the menu');}},new UserError('Choose a channel before saving.'),()=>{});
  assert.equal(sent[0].flags,64);assert.match(sent[0].content,/Choose a channel/);
});
test('expired replies log the delivery failure without throwing out of the gateway listener',async()=>{
  const logs=[];
  await assert.doesNotReject(reportFailure({commandName:'events',reply:async()=>{throw Object.assign(Error('expired'),{code:10062});}},Error('Unavailable'),s=>logs.push(s)));
  assert.ok(logs.some(s=>s.includes('Could not send the error reply')));
});
test('private source URLs are omitted from public error replies and logs',async()=>{
  const logs=[],sent=[];
  await reportFailure({commandName:'feed',reply:async p=>sent.push(p)},Error('Failed https://provider.example/rss?token=private-value'),s=>logs.push(s));
  assert.ok(!JSON.stringify({logs,sent}).includes('private-value'));assert.match(logs[0],/URL omitted/);
});
