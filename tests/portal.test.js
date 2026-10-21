import test from 'node:test';
import assert from 'node:assert/strict';
import {portalMessage} from '../src/portal.js';

test('portal buttons always target the invoking server and never enable verification',()=>{
  for(const action of ['open','setup']) {
    const a=portalMessage('111111111111111111',action),b=portalMessage('222222222222222222',action);
    const link=new URL(a.components[0].components[0].url);
    assert.equal(link.origin,'https://number-one.wispbyte.app');assert.equal(link.pathname,'/verify');assert.equal(link.searchParams.get('guild'),'111111111111111111');assert.equal(link.hash,action==='setup'?'#settings':'');
    assert.equal(new URL(b.components[0].components[0].url).searchParams.get('guild'),'222222222222222222');
    assert.equal(a.components[0].components[0].style,5);assert.deepEqual(a.allowedMentions,{parse:[]});assert.match(a.content,/real ID uploads are disabled/);
  }
});
test('portal rejects unsafe dashboard addresses and unknown actions',()=>{
  for(const origin of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com?secret=value','invalid'])assert.throws(()=>portalMessage('guild','open',origin),/address/);
  assert.throws(()=>portalMessage('guild','enable'),/portal open/);
  assert.equal(new URL(portalMessage('guild','open','https://dashboard.example.com').components[0].components[0].url).origin,'https://dashboard.example.com');
});
