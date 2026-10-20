import {MessageFlags} from 'discord.js';
import {sendInteractionResponse} from './interaction-transport.js';
import {UserError} from './user-error.js';
import {randomUUID} from 'node:crypto';
export const WORKING_MESSAGE='Request received. If no result arrives within 30 seconds, delivery could not be confirmed. Check the destination before retrying; your saved work is safe.';
export async function withDeadline(promise,ms=15000,message='This request took too long. Please try again later.') {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new UserError(message)),ms);})]);}
  finally{clearTimeout(timer);}
}
export function step(i,promise,{uncertain=false}={}) {
  i.operationDeadline??=Date.now()+(i.operationTimeoutMs??15000);
  const remaining=i.operationDeadline-Date.now();
  if(remaining<=0)throw new UserError('This request timed out before the next step. Your saved work is safe. Check the destination before retrying.');
  return withDeadline(typeof promise==='function'?promise():promise,remaining,uncertain?'Discord did not confirm whether the message was sent. Check the destination before retrying to avoid a duplicate.':'Discord or the feed service took too long to respond. Your saved work is safe; try again later.');
}
export async function acknowledge(i,update=false) {
  if(i.deferred || i.replied)return;
  if(update)return i.deferUpdate();
  return withDeadline(i.reply({content:WORKING_MESSAGE,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}}),8000,'Discord did not acknowledge the request.');
}
export async function respond(i,payload,{editTimeoutMs=8000,fallbackTimeoutMs=8000}={}) {
  if(i.deferred || i.replied) {
    const transport=i.confirmationTransport || (i.applicationId&&i.token?sendInteractionResponse:null);
    const {flags,...body}=payload;
    try {
      return await withDeadline(transport?transport(i,'PATCH',body,{timeoutMs:editTimeoutMs}):i.editReply(body),editTimeoutMs,'Discord did not confirm the response update.');
    } catch(error) {
      if([10015,10062].includes(Number(error.code)))throw error;
      console.warn(`Confirmation update failed (${error.code||error.name}); trying a separate, time-limited follow-up.`);
      const fallbackFlags=flags??(i.ephemeral===false?undefined:MessageFlags.Ephemeral);
      const fallback={...body,...(fallbackFlags===undefined?{}:{flags:fallbackFlags})};
      if(!transport&&!i.followUp)throw error;
      try{return await withDeadline(transport?transport(i,'POST',fallback,{timeoutMs:fallbackTimeoutMs}):i.followUp(fallback),fallbackTimeoutMs,'Discord could not deliver the result. Check the destination before repeating the action.');}
      catch(failure){failure.replyDeliveryFailed=true;failure.result=payload;throw failure;}
    }
  }
  return withDeadline(i.reply(payload),8000,'Discord did not accept the reply.');
}
export function updateResponse(i,payload) {return i.deferred || i.replied?respond(i,payload):withDeadline(i.update(payload),8000,'Discord did not accept the menu update.');}
export function safeError(error) {
  let message=String(error.message || error.name || 'Unknown error');
  for(const key of ['DISCORD_TOKEN','OPENAI_API_KEY'])if(process.env[key])message=message.split(process.env[key]).join('[secret removed]');
  return message.replace(/https?:\/\/\S+/g,'[URL omitted]').replace(/(?:github_pat_|ghp_|sk-)[\w-]+/g,'[secret removed]').slice(0,800);
}
export async function reportFailure(i,error,log=console.error) {
  const reference=randomUUID().slice(0,8),code=String(error.code || error.name || 'Error');
  log(`[${reference}] /${i.commandName || 'component'} failed (${code}): ${safeError(error)}`);
  if(error.replyDeliveryFailed){
    log(`[${reference}] Result delivery failed on both independent attempts; request was not repeated. The initial reply contains the check-before-retrying instruction.`);return;
  }
  let message;
  if(Number(error.code)===50013 || Number(error.code)===50001)message='Number One cannot access that channel or perform that action. Ask a server administrator to check its permissions.';
  else if(Number(error.code)===10062)message='Discord expired this action. Run the command again.';
  else if(error.name==='UserError')message=safeError(error);
  else message='Something went wrong while processing this action. Please try again.';
  try {
    const payload={content:`${message}\nReference: ${reference}`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]},embeds:[],components:[]};
    // Keep the setup controls available so a failed validation can be corrected.
    if(i.instagramSetupUpdate&&i.deferred){const transport=i.confirmationTransport || (i.applicationId&&i.token?sendInteractionResponse:null);await withDeadline(transport?transport(i,'POST',payload):i.followUp(payload),8000,'Discord could not deliver the error.');}
    else await respond(i,payload);
  }
  catch(replyError) {log(`[${reference}] Could not send the error reply (${String(replyError.code || replyError.name)}). Verify the bot is online and Discord is reachable.`);}
}
