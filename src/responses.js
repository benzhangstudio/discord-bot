import {MessageFlags} from 'discord.js';
import {sendInteractionResponse} from './interaction-transport.js';
import {UserError} from './user-error.js';
import {randomUUID} from 'node:crypto';
import {publicErrorMessage} from './public-errors.js';
import {queueReplyRecovery,cancelReplyRecovery} from './reply-recovery.js';
const acknowledgements=new WeakMap();
export function cancelAcknowledgement(i) {
  const pending=acknowledgements.get(i);
  if (pending?.timer) clearTimeout(pending.timer);
  acknowledgements.delete(i);
  i.acknowledgementScheduled=false;
}
async function finishAcknowledgement(i) {
  const pending=acknowledgements.get(i);
  try {
    if (pending?.timer) {
      clearTimeout(pending.timer);
    } else if (pending?.promise) {
      await pending.promise;
      if (pending.error) throw pending.error;
    }
  } finally {
    cancelAcknowledgement(i);
  }
}
export async function withDeadline(promise,ms=15000,message='This request took too long. Try again later.') {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new UserError(message)),ms);})]);}
  finally{clearTimeout(timer);}
}
export function step(i,promise,{uncertain=false}={}) {
  i.operationDeadline??=Date.now()+(i.operationTimeoutMs??15000);
  const remaining=i.operationDeadline-Date.now();
  if(remaining<=0)throw new UserError('This request took too long. Try again.');
  return withDeadline(typeof promise==='function'?promise():promise,remaining,uncertain?'Discord did not confirm whether the message was sent. Check the destination before retrying to avoid a duplicate.':'The service took too long to respond. Try again later.');
}
export async function acknowledge(i,update=false) {
  if (i.deferred || i.replied || acknowledgements.has(i)) return;
  if (update) return withDeadline(i.deferUpdate(),8000,'Discord did not accept the setup action.');
  const pending={};
  i.acknowledgementScheduled=true;
  pending.timer=setTimeout(()=>{
    pending.timer=null;
    pending.promise=withDeadline(i.deferReply(i.privateResponse?{flags:MessageFlags.Ephemeral}:{}),8000,'Discord did not acknowledge the request.').catch(error=>{pending.error=error;});
  },i.acknowledgementDelayMs??1500);
  acknowledgements.set(i,pending);
}
export async function respond(i,payload,{editTimeoutMs=8000,fallbackTimeoutMs=8000}={}) {
  if(i.privateResponse && payload.flags===undefined)payload={...payload,flags:MessageFlags.Ephemeral};
  await finishAcknowledgement(i);
  if(i.deferred || i.replied) {
    const transport=i.confirmationTransport || (i.applicationId&&i.token?sendInteractionResponse:null);
    const {flags,...body}=payload;
    function preserve(failure,method='PATCH',copy=body){
      failure.replyDeliveryFailed=true;failure.result=payload;
      failure.replyRecoveryScheduled=queueReplyRecovery(i,method,copy,transport,failure);
      return failure;
    }
    try {
      const result=await withDeadline(transport?transport(i,'PATCH',body,{timeoutMs:editTimeoutMs}):i.editReply(body),editTimeoutMs,'Discord did not confirm the response update.');
      cancelReplyRecovery(i);return result;
    } catch(error) {
      if(error.code==='HTTP_429'||Number(error.code)===429)throw preserve(error);
      if([10015,10062].includes(Number(error.code))||['HTTP_401','HTTP_403','HTTP_404'].includes(error.code))throw error;
      console.warn(`Confirmation update failed (${error.code||error.name}); trying a separate, time-limited follow-up.`);
      const fallbackFlags=flags??(i.ephemeral===true||i.privateResponse?MessageFlags.Ephemeral:undefined);
      const fallback={...body,...(fallbackFlags===undefined?{}:{flags:fallbackFlags})};
      if(!transport&&!i.followUp)throw preserve(error);
      try{const result=await withDeadline(transport?transport(i,'POST',fallback,{timeoutMs:fallbackTimeoutMs}):i.followUp(fallback),fallbackTimeoutMs,'Discord could not deliver the result. Check the destination before repeating the action.');cancelReplyRecovery(i);return result;}
      catch(failure){throw preserve(failure);}
    }
  }
  return withDeadline(i.reply(payload),8000,'Discord did not accept the reply.');
}
export function updateResponse(i,payload) {return i.deferred || i.replied?respond(i,payload):withDeadline(i.update(payload),8000,'Discord did not accept the menu update.');}
export function showForm(i,form){return withDeadline(i.showModal(form),8000,'Discord did not accept the reply.');}
export function safeError(error) {
  let message=String(error.message || error.name || 'Unknown error');
  for(const key of ['DISCORD_TOKEN','OPENAI_API_KEY'])if(process.env[key])message=message.split(process.env[key]).join('[secret removed]');
  return message.replace(/https?:\/\/\S+/g,'[URL omitted]').replace(/(?:github_pat_|ghp_|sk-)[\w-]+/g,'[secret removed]').slice(0,800);
}
export async function reportFailure(i,error,log=console.error) {
  const reference=randomUUID().slice(0,8),code=String(error.code || error.name || 'Error');
  if(error.replyDeliveryFailed){
    log(`[${reference}] Action result is ready; ${error.replyRecoveryScheduled?'reply queued for delivery after cooldown':'its confirmation is unavailable'} (${code}). The action was not repeated.`);return;
  }
  log(`[${reference}] /${i.commandName || 'component'} failed (${code}): ${safeError(error)}`);
  const message=publicErrorMessage(error);
  try {
    const payload={content:message,...(i.privateResponse||i.ephemeral||i.instagramSetupUpdate||(i.privateErrors&&!i.deferred&&!i.replied)?{flags:MessageFlags.Ephemeral}:{}),allowedMentions:{parse:[]},embeds:[],components:[]};
    // Keep the setup controls available so a failed validation can be corrected.
    if(i.instagramSetupUpdate&&i.deferred){const transport=i.confirmationTransport || (i.applicationId&&i.token?sendInteractionResponse:null);try{await withDeadline(transport?transport(i,'POST',payload):i.followUp(payload),8000,'Discord could not deliver the error.');}catch(failure){if(failure.code==='HTTP_429'&&queueReplyRecovery(i,'POST',payload,transport,failure)){failure.replyRecoveryScheduled=true;}throw failure;}}
    else await respond(i,payload);
  }
  catch(replyError) {log(`[${reference}] ${replyError.replyRecoveryScheduled?'Error reply queued for delivery after cooldown':'Error reply could not be delivered'} (${String(replyError.code || replyError.name)}). The action was not repeated.`);}
}
