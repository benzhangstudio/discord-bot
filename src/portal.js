import {UserError} from './user-error.js';

// The guild is taken from Discord's interaction, never from a user-supplied option.
// Opening a portal grants no website permissions and changes no server settings.
export function portalMessage(guildId,origin=process.env.AGE_ORIGIN || 'https://number-one.wispbyte.app') {
  let base;
  try {base=new URL(origin);} catch {throw new UserError('The dashboard address is unavailable. Ask the bot operator to correct its public website address.');}
  if(base.protocol!=='https:'||base.origin!==origin||base.username||base.password)throw new UserError('The dashboard needs a valid HTTPS address. Ask the bot operator to correct its public website address.');
  if(!guildId)throw new UserError('Use /dashboard inside your server.');
  const link=new URL(`/dashboard/${encodeURIComponent(guildId)}`,base),verify=new URL(`/dashboard/${encodeURIComponent(guildId)}/verification`,base);
  return {
    content:'**Server dashboard**\nSign in with Discord to manage this server. Dashboard access is limited to the server owner and members the owner approves. Members can use Verification to check their own status.\n\nVerification runs in test mode; real ID uploads are disabled.',
    components:[{type:1,components:[{type:2,style:5,label:'Open dashboard',url:link.href},{type:2,style:5,label:'Verification',url:verify.href}]}],
    allowedMentions:{parse:[]}
  };
}
