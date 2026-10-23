import {UserError} from './user-error.js';

// The guild is taken from Discord's interaction, never from a user-supplied option.
// Opening a portal grants no website permissions and changes no server settings.
export function portalMessage(guildId,action,origin=process.env.AGE_ORIGIN || 'https://number-one.wispbyte.app') {
  let base;
  try {base=new URL(origin);} catch {throw new UserError('The dashboard address is unavailable. Ask the bot operator to correct its public website address.');}
  if(base.protocol!=='https:'||base.origin!==origin||base.username||base.password)throw new UserError('The dashboard needs a valid HTTPS address. Ask the bot operator to correct its public website address.');
  if(!guildId||!['open','setup'].includes(action))throw new UserError('Use /portal open or /portal setup inside your server.');
  const link=new URL(`/dashboard/${encodeURIComponent(guildId)}${action==='setup'?'/overview':''}`,base);
  return {
    content:action==='setup'
      ?'**Dashboard setup**\nSign in with Discord to configure plugins, automod and verification. Requires server owner, Administrator or Manage Server.'
      :'**Server dashboard**\nSign in with Discord to manage this server, or to check your verification status as a member.\n\nVerification runs in test mode; real ID uploads are disabled.',
    components:[{type:1,components:[{type:2,style:5,label:action==='setup'?'Open setup':'Open dashboard',url:link.href}]}],
    allowedMentions:{parse:[]}
  };
}
