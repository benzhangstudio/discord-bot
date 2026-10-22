// Retry only delivery of an already prepared reply, never its command or mutation.
// The transport must be independent of the Discord SDK request queue.
const pending=new WeakMap();
export function cancelReplyRecovery(i){const entry=pending.get(i);if(entry){entry.cancel(entry.timer);pending.delete(i);}i.responsePending=false;}
export function queueReplyRecovery(i,method,payload,transport,error,options=i.replyRecoveryOptions||{}){
 if(!transport)return false;
 if(pending.has(i))return true;
 const now=options.now||Date.now,log=options.log||console.warn;
 const schedule=options.schedule||((work,ms)=>{const timer=setTimeout(work,ms);timer.unref?.();return timer;});
 const cancel=options.cancel||clearTimeout;
 const expires=options.expiresAt??((i.createdTimestamp||now())+14*60000);
 const timeoutMs=options.timeoutMs??8000,maxAttempts=options.maxAttempts??20;
 const entry={timer:null,cancel,attempts:0};
 function waitFor(failure){
  if(String(failure?.code)==='HTTP_429'||Number(failure?.code)===429)return Number.isFinite(failure.retryAfterMs)?Math.max(0,failure.retryAfterMs)+50:60000;
  return Math.min(30000,1000*2**Math.min(entry.attempts,5));
 }
 function arm(failure){
  const delay=waitFor(failure);
  if(now()+delay+timeoutMs>=expires||entry.attempts>=maxAttempts){
   pending.delete(i);i.responsePending=false;
   log(`Reply delivery stopped (${String(failure?.code||failure?.name||'Error')}); interaction unavailable. The action was not repeated.`);return false;
  }
  entry.timer=schedule(()=>void deliver(),delay);return true;
 }
 async function deliver(){
  if(pending.get(i)!==entry)return;
  entry.attempts++;
  let timer;
  try{
   await Promise.race([transport(i,method,payload,{timeoutMs}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Reply recovery timed out'),{code:'REPLY_TIMEOUT'})),timeoutMs);})]);
   // A successful PATCH replaces the original deferred reply and closes "thinking".
   cancelReplyRecovery(i);log('Queued reply delivered. The action was not repeated.');
  }catch(failure){
   if([10015,10062,401,403,404].includes(Number(failure.code))||['HTTP_401','HTTP_403','HTTP_404'].includes(String(failure.code))){cancelReplyRecovery(i);log('Reply delivery stopped; interaction unavailable. The action was not repeated.');}
   else arm(failure);
  }finally{clearTimeout(timer);}
 }
 pending.set(i,entry);i.responsePending=true;
 if(!arm(error))return false;
 return true;
}
