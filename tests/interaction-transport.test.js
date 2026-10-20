import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {EmbedBuilder} from 'discord.js';
import {sendInteractionResponse} from '../src/interaction-transport.js';
import {respond,reportFailure,acknowledge,WORKING_MESSAGE,step} from '../src/responses.js';

function requestStub(status=200,{stall=false}={}) {
  const calls=[];
  const request=(url,options,callback)=>{
    const req=new EventEmitter();req.destroy=()=>{calls.at(-1).destroyed=true;};
    req.end=body=>{calls.push({url,options,body:JSON.parse(body)});if(stall)return;queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.resume=()=>{};callback(res);res.emit('data',Buffer.from('{"id":"confirmed"}'));res.emit('end');});};return req;
  };
  return {request,calls};
}
const credentials=()=>({applicationId:'234567890123456789',token:'private-interaction-token',replied:true,ephemeral:true});
test('confirmation bypasses stalled SDK methods through a separate HTTPS connection',async()=>{
  const h=requestStub(),i=credentials();i.editReply=i.followUp=()=>new Promise(()=>{});
  i.confirmationTransport=(i,m,p)=>sendInteractionResponse(i,m,p,{request:h.request});
  const result=await respond(i,{content:'Success',embeds:[new EmbedBuilder().setDescription('Saved')],allowedMentions:{parse:[],roles:[]},flags:64});
  assert.equal(result.id,'confirmed');assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'PATCH');assert.equal(h.calls[0].url.hostname,'discord.com');assert.match(h.calls[0].url.pathname,/\/messages\/@original$/);
  assert.deepEqual(h.calls[0].body.allowed_mentions,{parse:[],roles:[]});assert.equal(h.calls[0].body.allowedMentions,undefined);assert.equal(h.calls[0].body.embeds[0].description,'Saved');assert.equal(h.calls[0].body.flags,undefined);
});
test('native transport aborts a connection that never replies', {timeout:1000},async()=>{
  const h=requestStub(200,{stall:true});await assert.rejects(sendInteractionResponse(credentials(),'PATCH',{content:'Done'},{request:h.request,timeoutMs:5}),/timed out/);assert.equal(h.calls[0].destroyed,true);
});
test('native follow-ups keep results private and do not retry Discord HTTP failures',async()=>{
  const h=requestStub();await sendInteractionResponse(credentials(),'POST',{content:'Done',flags:64},{request:h.request});assert.equal(h.calls[0].body.flags,64);assert.equal(h.calls[0].url.search,'?wait=true');
  const bad=requestStub(429);await assert.rejects(sendInteractionResponse(credentials(),'PATCH',{content:'Done'},{request:bad.request}),/rejected/);assert.equal(bad.calls.length,1);
});
test('both stalled confirmation attempts terminate and preserve the completed result', {timeout:1000},async()=>{
  const i={replied:true,confirmationTransport:()=>new Promise(()=>{})};let error;
  try{await respond(i,{content:'Message shared: private link'},{editTimeoutMs:5,fallbackTimeoutMs:5});}catch(e){error=e;}
  assert.equal(error.replyDeliveryFailed,true);assert.equal(error.result.content,'Message shared: private link');
  let directMessages=0;i.user={send:async()=>{directMessages++;}};const logs=[];await reportFailure(i,error,line=>logs.push(line));assert.equal(directMessages,0);assert.ok(logs.some(line=>line.includes('Result delivery failed')));
});
test('slow actions immediately show a normal private message, never a thinking callback',async()=>{
  const sent=[];const i={reply:async p=>sent.push(p),deferReply:()=>{throw Error('No thinking callback');}};await acknowledge(i);assert.equal(sent[0].content,WORKING_MESSAGE);assert.equal(sent[0].flags,64);assert.match(sent[0].content,/30 seconds/);
});
test('expired operation budget never starts a late mutation',async()=>{
  let writes=0;assert.throws(()=>step({operationDeadline:Date.now()-1},()=>{writes++;}),/timed out/);assert.equal(writes,0);
});
