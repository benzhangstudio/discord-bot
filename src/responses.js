import {MessageFlags} from 'discord.js';
import {randomUUID} from 'node:crypto';
export async function acknowledge(i,update=false) {
  if(i.deferred || i.replied)return;
  if(update)return i.deferUpdate();
  return i.deferReply({flags:MessageFlags.Ephemeral});
}
export function respond(i,payload) {
  if(i.deferred || i.replied) {const {flags,...body}=payload;return i.editReply(body);}
  return i.reply(payload);
}
export function updateResponse(i,payload) {return i.deferred || i.replied?i.editReply(payload):i.update(payload);}
export function safeError(error) {
  let message=String(error.message || error.name || 'Unknown error');
  for(const key of ['DISCORD_TOKEN','OPENAI_API_KEY'])if(process.env[key])message=message.split(process.env[key]).join('[secret removed]');
  return message.replace(/https?:\/\/\S+/g,'[URL omitted]').replace(/(?:github_pat_|ghp_|sk-)[\w-]+/g,'[secret removed]').slice(0,800);
}
export async function reportFailure(i,error,log=console.error) {
  const reference=randomUUID().slice(0,8),code=String(error.code || error.name || 'Error');
  log(`[${reference}] /${i.commandName || 'component'} failed (${code}): ${safeError(error)}`);
  let message;
  if(Number(error.code)===50013 || Number(error.code)===50001)message='Number One cannot access that channel or perform that action. Ask a server administrator to check its permissions.';
  else if(Number(error.code)===10062)message='Discord expired this action. Run the command again.';
  else if(error.name==='UserError')message=safeError(error);
  else message='Something went wrong while processing this action. Please try again.';
  try {
    const payload={content:`${message}\nReference: ${reference}`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]},embeds:[],components:[]};
    // Keep the setup controls available so a failed validation can be corrected.
    if(i.instagramSetupUpdate&&i.deferred&&i.followUp)await i.followUp(payload);
    else await respond(i,payload);
  }
  catch(replyError) {log(`[${reference}] Could not send the error reply (${String(replyError.code || replyError.name)}). Verify the bot is online and Discord is reachable.`);}
}
