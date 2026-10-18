import test from 'node:test';
import assert from 'node:assert/strict';
import {reportFailure} from '../src/responses.js';
test('permission errors explain the problem, include a reference, and edit deferred replies',async()=>{
  const logs=[],sent=[];
  await reportFailure({commandName:'schedule',deferred:true,editReply:async p=>sent.push(p)},Object.assign(Error('Missing Permissions'),{code:50013}),s=>logs.push(s));
  assert.match(sent[0].content,/permissions/);assert.match(sent[0].content,/Reference:/);assert.equal(sent[0].flags,undefined);assert.match(logs[0],/50013/);
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
