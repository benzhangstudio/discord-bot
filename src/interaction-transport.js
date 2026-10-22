import https from 'node:https';

// Interaction confirmations use a separate connection, not the shared SDK queue.
// Never log the URL: its path contains the private interaction token.
const cooldowns=new WeakMap();
export async function sendInteractionResponse(i,method,payload,{request=https.request,timeoutMs=8000}={}) {
  let limits=cooldowns.get(request);
  if (!limits) {limits=new Map();cooldowns.set(request,limits);}
  const deadline=Date.now()+timeoutMs;
  // A webhook token is a major rate-limit parameter. One server's reply must not
  // impose its route cooldown on every other interaction for the application.
  const key=i.applicationId+':'+i.token;
  for (let attempt=0;attempt<3;attempt++) {
    const wait=Math.max(0,(limits.get(key)||0)-Date.now(),(limits.get('global')||0)-Date.now());
    if (wait>0) {
      if (wait>=deadline-Date.now()) throw Object.assign(Error('Discord confirmation is rate limited'),{code:'HTTP_429',retryAfterMs:wait});
      await new Promise(resolve=>setTimeout(resolve,wait));
    }
    try {
      return await requestOnce(i,method,payload,{request,timeoutMs:Math.max(1,deadline-Date.now())});
    } catch(error) {
      if (error.code!=='HTTP_429') throw error;
      const delay=Number.isFinite(error.retryAfterMs)?error.retryAfterMs+25:60000;
      limits.set(error.globalRateLimit?'global':key,Date.now()+delay);
      for(const [entry,until]of limits)if(until<=Date.now())limits.delete(entry);
      if (!Number.isFinite(error.retryAfterMs)||attempt===2 || delay>=deadline-Date.now()) throw error;
    }
  }
}
function requestOnce(i,method,payload,{request,timeoutMs}) {
  if(!/^\d{17,20}$/.test(i.applicationId)||!i.token)throw Error('Missing interaction credentials');
  const {allowedMentions,flags,...body}=payload;
  if(allowedMentions)body.allowed_mentions={...allowedMentions};
  if(method==='POST'&&flags!==undefined)body.flags=Number(flags);
  const suffix=method==='PATCH'?'/messages/@original':'?wait=true';
  const url=new URL(`https://discord.com/api/v10/webhooks/${i.applicationId}/${encodeURIComponent(i.token)}${suffix}`);
  return new Promise((resolve,reject)=>{
    let timer,req,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    timer=setTimeout(()=>{finish(Object.assign(Error('Discord confirmation timed out'),{code:'REPLY_TIMEOUT'}));req?.destroy();},timeoutMs);
    try {
      req=request(url,{method,headers:{'Content-Type':'application/json','User-Agent':'NumberOneDiscordBot (https://github.com/benzhangstudio/number-one, 0.1)'}},response=>{
        let size=0;const chunks=[];
        response.on('data',chunk=>{size+=chunk.length;if(size>500000){finish(Error('Discord confirmation was too large'));response.destroy();}else chunks.push(chunk);});
        response.on('error',()=>finish(Error('Discord confirmation connection failed')));
        response.on('end',()=>{
          let result={};
          try {result=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');} catch {}
          if (response.statusCode>=200 && response.statusCode<300) {
            i.replied=true;finish(null,result);
          } else {
            const error=Object.assign(Error('Discord rejected the confirmation'),{code:'HTTP_'+response.statusCode});
            if (response.statusCode===429) {
              error.globalRateLimit=result.global===true||response.headers?.['x-ratelimit-global']==='true';
              error.rateLimitScope=String(response.headers?.['x-ratelimit-scope']||'unknown');
              const values=[result.retry_after,response.headers?.['retry-after'],response.headers?.['x-ratelimit-reset-after']].filter(value=>value!==undefined&&value!==null&&value!=='').map(Number).filter(value=>Number.isFinite(value)&&value>=0);
              if (values.length) error.retryAfterMs=Math.ceil(Math.max(...values)*1000);
              console.warn(`Reply rate limited: scope=${error.globalRateLimit?'global':error.rateLimitScope}, retryAfterMs=${error.retryAfterMs??'unavailable'}. Reply content and credentials omitted.`);
            }
            finish(error);
          }
        });
      });
      req.on('error',()=>finish(Error('Discord confirmation connection failed')));
      req.end(JSON.stringify(body));
    } catch {finish(Error('Discord confirmation could not be sent'));}
  });
}
