import {textOf} from './text-of.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {portalMessage} from '../src/portal.js';

test('dashboard buttons always target the invoking server and never enable verification',()=>{
  const a=portalMessage('111111111111111111'),b=portalMessage('222222222222222222');
  const [open,verify]=a.components[0].components.map(c=>new URL(c.url));
  assert.equal(open.origin,'https://number-one.wispbyte.app');assert.equal(open.pathname,'/dashboard/111111111111111111');assert.equal(verify.pathname,'/dashboard/111111111111111111/verification');
  assert.match(new URL(b.components[0].components[0].url).pathname,/^\/dashboard\/222222222222222222/);
  assert.ok(a.components[0].components.every(c=>c.style===5));assert.deepEqual(a.allowedMentions,{parse:[]});assert.match(textOf(a),/real ID uploads are disabled/);
  assert.match(textOf(a),/Administrator or Manage Server/);
  assert.doesNotMatch(textOf(a),/Managing requires.*Administrator|Managing requires.*Manage Server/);
});
test('dashboard link rejects unsafe dashboard addresses and missing servers',()=>{
  for(const origin of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com?secret=value','invalid'])assert.throws(()=>portalMessage('guild',origin),/address/);
  assert.throws(()=>portalMessage(''),/\/dashboard/);
  assert.equal(new URL(portalMessage('guild','https://dashboard.example.com').components[0].components[0].url).origin,'https://dashboard.example.com');
});
