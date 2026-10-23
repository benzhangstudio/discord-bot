import test from 'node:test';
import assert from 'node:assert/strict';
import {errorPayload,errorTitle,ERROR_COLOR} from '../src/error-embed.js';
import {reportFailure} from '../src/responses.js';
import {UserError} from '../src/user-error.js';

test('error embeds are neutral, titled and mention-free',()=>{
  const p=errorPayload('Choose a source first.',{fields:[{name:'Case',value:'#4'}]});
  assert.equal(p.content,'');assert.equal(p.embeds.length,1);
  const e=p.embeds[0].toJSON?p.embeds[0].toJSON():p.embeds[0];
  assert.equal(e.color,ERROR_COLOR);assert.equal(e.color,0x4F545C);assert.ok(e.title);assert.equal(e.description,'Choose a source first.');
  assert.deepEqual(p.allowedMentions,{parse:[]});assert.deepEqual(p.components,[]);
  assert.equal(errorTitle('Choose a source first.'),'Check your input');
});
test('server errors are public embeds; DM appeal flow errors stay private',async()=>{
  for(const priv of [false,true]){
    const out=[];const i={commandName:'x',...(priv?{privateResponse:true}:{}),reply:async p=>out.push(p)};
    await reportFailure(i,new UserError('Choose a source first.'),()=>{});
    assert.equal(out.length,1);assert.equal(out[0].content,'');assert.equal(out[0].embeds.length,1);
    assert.equal(Boolean((out[0].flags||0)&64),priv);
  }
});
