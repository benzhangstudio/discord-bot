import {UserError} from './user-error.js';
import {acknowledge,respond,step} from './responses.js';

export function isServerOwner(i) {
  if (i.guild?.ownerId && i.user?.id===i.guild.ownerId) {
    return true;
  } else {
    return false;
  }
}

export function createAccessCommands(store) {
  return async function access(i) {
    if (!i.isChatInputCommand() || i.commandName!=='access') {
      return false;
    }
    if (!isServerOwner(i)) {
      throw new UserError('Only the server owner can manage command access. Ask them to add or remove members.');
    }
    const sub=i.options.getSubcommand(false);
    const reply=content=>respond(i,{content,allowedMentions:{parse:[]}});
    if (sub==='list') {
      const records=store.list(i.guildId,'access');
      const total=Math.max(1,Math.ceil(records.length/20));
      const page=Math.min(i.options.getInteger('page')||1,total);
      const description=records.length?records.slice((page-1)*20,page*20).map(record=>`• <@${record.id}>${record.grantedAt?` · added <t:${Math.floor(record.grantedAt/1000)}:R>`:''}`).join('\n'):'No additional members have command access.';
      await respond(i,{embeds:[{color:0x5865F2,title:'Owner-approved command access',description,footer:{text:`Total: ${records.length} member${records.length===1?'':'s'}${total>1?` · Page ${page} of ${total}`:''} · Administrators and Manage Server members already have access`}}],allowedMentions:{parse:[]}});
    } else if (sub==='add' || sub==='remove') {
      const user=i.options.getUser('user');
      if (!user || user.bot) {
        throw new UserError('Choose a person in this server.');
      }
      if (sub==='remove') {
        const removed=store.remove(i.guildId,'access',user.id);
        if (removed) {
          await reply(`Removed owner-granted access for <@${user.id}>. Discord Administrator or Manage Server permissions still apply.`);
        } else {
          await reply('That person has no owner-granted access to remove.');
        }
      } else {
        if (store.get(i.guildId,'access',user.id)) {
          await reply('That person already has owner-granted access in this server.');
          return true;
        }
        await acknowledge(i);
        const member=await step(i,()=>i.guild.members.fetch(user.id)).catch(error=>{
          if (error.name==='UserError') {
            throw error;
          } else {
            throw new UserError('Choose a current member of this server.');
          }
        });
        if (!member || member.user?.bot) {
          throw new UserError('Choose a current human member of this server.');
        }
        if (!isServerOwner(i)) {
          throw new UserError('Only the current server owner can grant access.');
        }
        if (store.list(i.guildId,'access').length>=100 && !store.get(i.guildId,'access',user.id)) {
          throw new UserError('This server already has 100 approved members. Remove someone before adding another.');
        }
        store.put(i.guildId,'access',{id:user.id,grantedBy:i.user.id,grantedAt:Date.now()});
        await reply(`Added <@${user.id}>. They can now use the bot’s commands here. Only the server owner can grant access to others.`);
      }
    } else {
      throw new UserError('Use /access add, /access remove, or /access list.');
    }
    return true;
  };
}
