import {UserError} from './user-error.js';

// The guild is taken from Discord's interaction, never from a user-supplied option.
// Opening a portal grants no website permissions and changes no server settings.
export function portalMessage(guildId,action,origin=process.env.AGE_ORIGIN || 'https://number-one.wispbyte.app') {
  let base;
  try {base=new URL(origin);} catch {throw new UserError('The dashboard address is unavailable. Ask the bot operator to correct its public website address.');}
  if(base.protocol!=='https:'||base.origin!==origin||base.username||base.password)throw new UserError('The dashboard needs a valid HTTPS address. Ask the bot operator to correct its public website address.');
  if(!guildId||!['open','setup'].includes(action))throw new UserError('Use /portal open or /portal setup inside your server.');
  const link=new URL('/verify',base);link.searchParams.set('guild',guildId);
  if(action==='setup')link.hash='settings';
  return {
    content:action==='setup'
      ?'**Set up this server’s verification portal**\nSign in with Discord. The server owner, an Administrator, or someone with Manage Server can choose reviewer and Beta test roles and open this server’s verification on the website. No approval from the bot operator is needed.\n\nSynthetic test cases only; real ID uploads are disabled.'
      :'**This server’s verification portal**\nSign in with Discord to see your status or this server’s reviewer queue if authorized. Share this link with members. Staff can use /portal setup to configure this server on the website.\n\nSynthetic test cases only; real ID uploads are disabled.',
    components:[{type:1,components:[{type:2,style:5,label:action==='setup'?'Set up this server':'Open this server’s portal',url:link.href}]}],
    allowedMentions:{parse:[]}
  };
}
