import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {EmbedBuilder} from 'discord.js';
import {sendInteractionResponse} from '../src/interaction-transport.js';
import {respond,reportFailure,acknowledge,step} from '../src/responses.js';

function requestStub(status=200,{stall=false,retryAfter}={}) {
  const calls=[];
  const request=(url,options,callback)=>{
    const req=new EventEmitter();req.destroy=()=>{calls.at(-1).destroyed=true;};
    req.end=body=>{calls.push({url,options,body:JSON.parse(body)});if(stall)return;queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=Array.isArray(status)?status[Math.min(calls.length-1,status.length-1)]:status;res.headers={};if(retryAfter!==undefined)res.headers['retry-after']=String(retryAfter);res.resume=()=>{};callback(res);res.emit('data',Buffer.from(JSON.stringify(res.statusCode===429&&retryAfter!==undefined?{retry_after:retryAfter}:{id:'confirmed'})));res.emit('end');});};return req;
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
  let directMessages=0;i.user={send:async()=>{directMessages++;}};const logs=[];await reportFailure(i,error,line=>logs.push(line));assert.equal(directMessages,0);assert.ok(logs.some(line=>line.includes('Action result is ready')));
});
test('fast actions send only their final success message, without a receipt or deferral',async()=>{
  const sent=[];const i={reply:async p=>sent.push(p),deferReply:()=>{throw Error('Fast action must not defer');}};
  await acknowledge(i);assert.equal(sent.length,0);await respond(i,{content:'Message sent.',flags:64});assert.equal(sent.length,1);assert.equal(sent[0].content,'Message sent.');
});

test('longer actions acknowledge before expiry, then replace the loading state with the final result',async()=>{
  const sent=[];const i={acknowledgementDelayMs:2,deferReply:async p=>{i.deferred=true;sent.push({type:5,...p});},editReply:async p=>sent.push({type:4,...p})};
  await acknowledge(i);await new Promise(resolve=>setTimeout(resolve,10));await respond(i,{content:'Message sent.',flags:64});
  assert.equal(sent.length,2);assert.equal(sent[0].type,5);assert.equal(sent[0].content,undefined);assert.equal(sent[1].content,'Message sent.');assert.equal(i.acknowledgementScheduled,false);
});

test('failed delayed acknowledgement is cleared so a user-facing error can still be sent',async()=>{
  const sent=[];const i={acknowledgementDelayMs:2,deferReply:async()=>{throw Error('Acknowledgement failed');},reply:async p=>sent.push(p)};
  await acknowledge(i);await new Promise(resolve=>setTimeout(resolve,10));
  await assert.rejects(respond(i,{content:'Done'}),/Acknowledgement failed/);assert.equal(i.acknowledgementScheduled,false);
  await reportFailure(i,Error('Backend unavailable'),()=>{});assert.equal(sent.length,1);assert.match(sent[0].content,/Something went wrong/);assert.equal(sent[0].flags,64);
});

test('429 retry waits for Retry-After before repeating the same confirmation request', {timeout:1000},async()=>{
  const h=requestStub([429,200],{retryAfter:0.02}),started=Date.now();
  const result=await sendInteractionResponse(credentials(),'PATCH',{content:'Manual sent.'},{request:h.request,timeoutMs:500});
  assert.equal(result.id,'confirmed');assert.equal(h.calls.length,2);assert.ok(Date.now()-started>=20);assert.ok(h.calls.every(call=>call.options.method==='PATCH'));
});

test('a long 429 cooldown stops confirmation attempts and does not immediately try a follow-up', {timeout:1000},async()=>{
  const h=requestStub(429,{retryAfter:60}),i=credentials();
  i.confirmationTransport=(i,method,payload)=>sendInteractionResponse(i,method,payload,{request:h.request,timeoutMs:20});
  let error;try{await respond(i,{content:'Full manual sent to your DMs.',flags:64},{editTimeoutMs:40,fallbackTimeoutMs:40});}catch(e){error=e;}
  assert.equal(error.code,'HTTP_429');assert.equal(error.replyDeliveryFailed,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'PATCH');
  const logs=[];await reportFailure(i,error,line=>logs.push(line));assert.ok(logs.every(line=>!line.includes('/component failed')));assert.ok(logs.some(line=>line.includes('Action result is ready')));
  await assert.rejects(sendInteractionResponse(i,'PATCH',{content:'Done'},{request:h.request,timeoutMs:10}),{code:'HTTP_429'});assert.equal(h.calls.length,1);
});
test('expired operation budget never starts a late mutation',async()=>{
  let writes=0;assert.throws(()=>step({operationDeadline:Date.now()-1},()=>{writes++;}),/timed out/);assert.equal(writes,0);
});
