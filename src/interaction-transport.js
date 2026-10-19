import https from 'node:https';

// Interaction confirmations use a separate connection, not the shared SDK queue.
// Never log the URL: its path contains the private interaction token.
export function sendInteractionResponse(i,method,payload,{request=https.request,timeoutMs=8000}={}) {
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
        if(response.statusCode<200||response.statusCode>=300){response.resume();finish(Object.assign(Error('Discord rejected the confirmation'),{code:`HTTP_${response.statusCode}`}));return;}
        let size=0;const chunks=[];
        response.on('data',chunk=>{size+=chunk.length;if(size>500000){finish(Error('Discord confirmation was too large'));response.destroy();}else chunks.push(chunk);});
        response.on('error',()=>finish(Error('Discord confirmation connection failed')));
        response.on('end',()=>{let result={};try{result=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{}i.replied=true;finish(null,result);});
      });
      req.on('error',()=>finish(Error('Discord confirmation connection failed')));
      req.end(JSON.stringify(body));
    } catch {finish(Error('Discord confirmation could not be sent'));}
  });
}
