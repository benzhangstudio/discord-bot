import test from 'node:test';
import assert from 'node:assert/strict';
import {queueReplyRecovery,cancelReplyRecovery} from '../src/reply-recovery.js';
import {respond,reportFailure} from '../src/responses.js';
import {UserError} from '../src/user-error.js';
function clock(){
 let now=0;const jobs=[],logs=[];
 const options={now:()=>now,expiresAt:600000,timeoutMs:5,log:s=>logs.push(s),schedule:(work,delay)=>{const job={work,delay,cancelled:false};jobs.push(job);return job;},cancel:job=>{if(job)job.cancelled=true;}};
 return {options,jobs,logs,async next({stall=false}={}){const job=jobs.shift();assert.ok(job&&!job.cancelled);now+=job.delay;job.work();await new Promise(resolve=>stall?setTimeout(resolve,15):setImmediate(resolve));}};
}
const limited=(ms=60000)=>Object.assign(Error('rate limited'),{code:'HTTP_429',retryAfterMs:ms});
for(const privateResponse of [true,false])test(`rate-limited ${privateResponse?'private':'public'} reply replaces thinking after its cooldown`,async()=>{
 const c=clock(),calls=[];let attempts=0;
 const i={deferred:true,privateResponse,replyRecoveryOptions:c.options,confirmationTransport:async(_i,method,payload)=>{calls.push({method,payload});if(++attempts===1)throw limited();}};
 let error;try{await respond(i,{content:'Banned Alex.',...(privateResponse?{flags:64}:{})});}catch(e){error=e;}
 assert.equal(error.replyRecoveryScheduled,true);assert.equal(calls.length,1);assert.equal(i.responsePending,true);assert.ok(c.jobs[0].delay>=60000);
 await reportFailure(i,error,s=>c.logs.push(s));assert.equal(calls.length,1);
 await c.next();assert.equal(calls.length,2);assert.ok(calls.every(call=>call.method==='PATCH'));assert.equal(calls[1].payload.content,'Banned Alex.');assert.equal(calls[1].payload.flags,undefined);assert.equal(i.responsePending,false);assert.match(c.logs.at(-1),/reply delivered/);
});
test('the reported protected-target error completes its deferred reply instead of abandoning thinking',async()=>{
 const c=clock(),calls=[];let attempts=0;
 const i={commandName:'warn',deferred:true,privateResponse:true,replyRecoveryOptions:c.options,confirmationTransport:async(_i,method,payload)=>{calls.push({method,payload});if(++attempts===1)throw limited(20000);}};
 await reportFailure(i,new UserError('You cannot moderate yourself, the bot, or the server owner.'),s=>c.logs.push(s));
 assert.equal(calls.length,1);assert.equal(i.responsePending,true);assert.match(c.logs.at(-1),/queued/);
 await c.next();assert.equal(calls.length,2);assert.match(calls[1].payload.content,/cannot moderate yourself/);assert.equal(calls[1].method,'PATCH');assert.equal(i.responsePending,false);
});
test('repeated rate limits update the same reply without switching routes or repeating an action',async()=>{
 const c=clock(),calls=[];let attempts=0;
 const i={replyRecoveryOptions:c.options};const transport=async(_i,method,p)=>{calls.push({method,p});if(++attempts<3)throw limited(1000);};
 assert.equal(queueReplyRecovery(i,'PATCH',{content:'Warning recorded.'},transport,limited(1000)),true);
 assert.equal(queueReplyRecovery(i,'PATCH',{content:'Warning recorded.'},transport,limited(1000)),true);assert.equal(c.jobs.length,1);
 await c.next();await c.next();await c.next();assert.equal(calls.length,3);assert.ok(calls.every(call=>call.method==='PATCH'));assert.equal(i.responsePending,false);
});
test('stalled edit and stalled fallback both finish within bounds and retain a safe original-reply recovery',async()=>{
 const c=clock(),calls=[],i={deferred:true,replyRecoveryOptions:c.options,confirmationTransport:(_i,m)=>{calls.push(m);return new Promise(()=>{});}};
 let error;try{await respond(i,{content:'Deleted 10 messages.'},{editTimeoutMs:5,fallbackTimeoutMs:5});}catch(e){error=e;}
 assert.equal(error.replyRecoveryScheduled,true);assert.deepEqual(calls,['PATCH','POST']);
 await c.next({stall:true});assert.deepEqual(calls,['PATCH','POST','PATCH']);assert.equal(c.jobs.length,1);cancelReplyRecovery(i);
});
test('recovery stops on expiry or permanent rejection and does not keep tokens indefinitely',async()=>{
 const c=clock(),i={replyRecoveryOptions:{...c.options,expiresAt:100}};assert.equal(queueReplyRecovery(i,'PATCH',{},async()=>{},limited(60000)),false);assert.equal(c.jobs.length,0);
 const j={replyRecoveryOptions:c.options};queueReplyRecovery(j,'PATCH',{},async()=>{throw Object.assign(Error('expired'),{code:'HTTP_404'});},limited(1));await c.next();assert.equal(j.responsePending,false);assert.equal(c.jobs.length,0);
});
test('an unspecified cooldown is handled conservatively; no immediate alternate request is sent',()=>{
 const c=clock(),i={replyRecoveryOptions:c.options};let calls=0;
 queueReplyRecovery(i,'PATCH',{content:'Done.'},async()=>{calls++;},Object.assign(Error('limited'),{code:'HTTP_429'}));assert.equal(calls,0);assert.ok(c.jobs[0].delay>=60000);cancelReplyRecovery(i);
});
test('setup-form error recovery preserves its private follow-up and leaves the original form alone',async()=>{
 const c=clock(),calls=[];let count=0;
 const i={deferred:true,instagramSetupUpdate:true,replyRecoveryOptions:c.options,confirmationTransport:async(_i,method,p)=>{calls.push({method,p});if(++count===1)throw limited(1000);}};
 await reportFailure(i,new UserError('Choose a channel before saving.'),s=>c.logs.push(s));assert.equal(i.responsePending,true);await c.next();assert.ok(calls.every(call=>call.method==='POST'));assert.equal(calls.at(-1).p.flags,64);assert.equal(i.responsePending,false);
});
