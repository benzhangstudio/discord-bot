import {MessageFlags,PermissionFlagsBits as P,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder} from 'discord.js';
import {Moderation,clean} from './moderation-core.js';
import {moderationCommands,moderationActions} from './moderation-commands.js';
import {UserError} from './user-error.js';
import {acknowledge,respond,withDeadline} from './responses.js';
import {publicErrorMessage,UNCERTAIN_ACTION} from './public-errors.js';
const writing=P.SendMessages|P.SendMessagesInThreads|P.CreatePublicThreads|P.CreatePrivateThreads|P.AddReactions;
const has=(m,p)=>!!m?.permissions?.has(p);
const owner=i=>i.user.id===i.guild.ownerId;
const must=(condition,message)=>{if(!condition)throw new UserError(message);};
const payload=content=>({content:clean(content).slice(0,1900),allowedMentions:{parse:[]}});
const caseStatus=c=>({succeeded:'Completed',failed:'Not completed',uncertain:'Needs review',pending:'Needs review'}[c.state]||'Needs review');
const caseText=c=>`Case ${c.id} · ${c.action} · ${caseStatus(c)}\nMember: ${c.target}\nReason: ${c.reason}${['uncertain','pending'].includes(c.state)?'\nCheck the result before trying this action again.':''}`;
const rank=m=>m.roles.highest.position;
const COLOR=0x5865f2;
export const appealPanelText=contact=>`**Moderation appeals**\nFor members currently in this server: use **Appeal a case** to ask staff to review a warning, timeout or other case. Only staff can see appeals.\n\nBanned or kicked members receive an **Appeal** button by DM when the action is taken. If that DM did not arrive: ${contact?`${clean(contact)}`:'contact the server staff through the server’s published appeal contact.'}`;
export const ACTION_TITLES={ban:'Member banned',unban:'Member unbanned',kick:'Member kicked',warn:'Member warned',timeout:'Member timed out',untimeout:'Timeout removed',purge:'Messages deleted','emergency-on':'Channel locked','emergency-off':'Channel unlocked',configure:'Moderation settings updated','automod-delete':'Message deleted by automod','appeal-panel':'Appeal panel posted',note:'Case note added',void:'Warning removed'};
const mention=id=>/^\d{15,25}$/.test(String(id))?`<@${id}>`:clean(String(id));
const caseEmbed=(c,{title,actor,reason}={})=>{
 const fields=[];
 if(['ban','unban','kick','warn','timeout','untimeout','automod-delete'].includes(c.action))fields.push({name:'User',value:mention(c.target),inline:true});
 fields.push({name:'Moderator',value:mention(actor||c.actor),inline:true});
 if(c.details?.until)fields.push({name:'Until',value:`<t:${Math.floor(c.details.until/1000)}:f>`,inline:true});
 if(c.action==='purge')fields.push({name:'Messages',value:String(c.details?.deleted??0),inline:true});
 fields.push({name:'Reason',value:clean(reason||c.reason||'No reason provided').slice(0,1000)},{name:'Case',value:clean(String(c.id)),inline:true});
 return {title:title||ACTION_TITLES[c.action]||'Case updated',color:COLOR,fields,timestamp:new Date(c.updatedAt||c.createdAt||Date.now()).toISOString()};
};
// Bounded DM to the affected member, sent BEFORE ban/kick/timeout because Discord
// will not open a DM with a user who shares no server. Never blocks the action.
const DM_TEXT={ban:'You were banned from',kick:'You were kicked from',timeout:'You were timed out in',warn:'You were warned in'};
export const appealButtonId=(guild,caseId)=>`mod-appeal-dm:${guild}:${caseId}`;
async function notifyMember(member,{action,guild,guildName,caseId,reason,until,contact,appealButton}){
 if(!member?.send||!DM_TEXT[action])return 'skipped';
 const lines=[`${DM_TEXT[action]} **${clean(guildName||'the server')}**.`,`Reason: ${clean(reason||'No reason provided').slice(0,500)}`,`Case: ${clean(String(caseId))}`];
 if(until)lines.push(`Ends: <t:${Math.floor(until/1000)}:f>`);
 if(appealButton)lines.push('To appeal, use the button below.');else if(contact&&['ban','kick'].includes(action))lines.push(`To appeal: ${clean(contact)}`);
 const message={content:lines.join('\n'),allowedMentions:{parse:[]}};
 if(appealButton)message.components=[{type:1,components:[{type:2,style:2,label:'Appeal',custom_id:appealButtonId(guild,caseId)}]}];
 try{await withDeadline(member.send(message),3000);return 'sent';}catch{return 'failed';}
}

export function durationMinutes(value){
 const match=/^(\d+)\s*(m|h|d|w)$/i.exec(String(value||'').trim());
 const minutes=match?Number(match[1])*({m:1,h:60,d:1440,w:10080}[match[2].toLowerCase()]):NaN;
 must(Number.isSafeInteger(minutes)&&minutes>=1&&minutes<=40320,'Use a duration such as 10m, 1h, 1d or 1w (up to 28 days).');return minutes;
}
export function createModeration(client,store,{needStaff,timeoutMs=12000}={}) {
 const core=new Moderation(store,{timeoutMs});
 const read=p=>withDeadline(p,timeoutMs,'Discord did not respond. Check permissions and try again.');
 const pending=new Set();
 let stopped=false,ticking=false;
 async function members(i){
  await read(i.guild.fetch());
  const [actor,bot]=await Promise.all([read(i.guild.members.fetch({user:i.user.id,force:true})),read(i.guild.members.fetchMe({force:true}))]);
  // Refresh roles as well as members: hierarchy and configured role privileges can change.
  await read(i.guild.roles.fetch());return {actor,bot};
 }
 function allowed(i,actor,permission=P.ModerateMembers){
  const cfg=core.config(i.guildId);
  must(owner(i)||has(actor,P.Administrator)||has(actor,permission)||cfg.modRole&&actor.roles.cache.has(cfg.modRole),'You need the relevant moderation permission or the moderator role, plus command access.');
 }
 function targetSafe(i,actor,bot,target){
  const cfg=core.config(i.guildId);
  must(target.id!==i.user.id&&target.id!==bot.id&&target.id!==i.guild.ownerId,'You cannot moderate yourself, the bot, or the server owner.');
  must(!target.user.bot,'Bot accounts must be handled manually by the server owner.');
  must(!has(target,P.Administrator),'Administrator members are protected.');
  must(!cfg.modRole||!target.roles.cache.has(cfg.modRole),'Configured moderators are protected.');
  must(rank(bot)>rank(target),'Move the bot’s role above the target’s highest role.');
  must(owner(i)||rank(actor)>rank(target),'Your highest role must be above the target’s highest role.');
 }
 function completeMember(i,member){
  if(i.guild.available===false||!member?.permissions?.has||!member.roles?.highest||!member.roles?.cache)return false;
  // GuildMember keeps all role IDs from the signed interaction even when a
  // referenced role is absent from the cache. Never infer a lower rank then.
  return !Array.isArray(member._roles)||member._roles.every(id=>i.guild.roles.cache.has(id));
 }
 function interactionMembers(i){
  const actor=i.member,bot=i.guild.members.me;
  must(completeMember(i,actor),'Member role details are unavailable.');
  return {actor,bot};
 }
 async function log(guild,c,row){
  const cfg=core.config(guild.id);
  if(!cfg.logChannel||row?.state!=='queued')return;
  try{
   const ch=await read(guild.channels.fetch(cfg.logChannel));
   must(ch&&![10,11,12].includes(ch.type)&&!ch.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel),'Log channel must remain hidden from everyone.');
   // A claimed log is never blindly retried after an ambiguous send.
   store.put(guild.id,'mod-log',{...row,state:'sending'});
   await read(ch.send({embeds:[caseEmbed(c,row.event?{title:ACTION_TITLES[row.event.action]||ACTION_TITLES[c.action],actor:row.event.actor,reason:row.event.reason}:{})],allowedMentions:{parse:[]},nonce:row.id.slice(-25),enforceNonce:true}));
   store.put(guild.id,'mod-log',{...row,state:'sent'});
  }catch{const current=store.get(guild.id,'mod-log',row.id);store.put(guild.id,'mod-log',{...row,state:current?.state==='sending'?'uncertain':'queued'});}
 }
 async function finish(i,c){
  if(c.state!=='succeeded')return respond(i,payload((['uncertain','pending'].includes(c.state)?UNCERTAIN_ACTION:publicErrorMessage({code:c.error}))+`\nCase: ${c.id}`));
  const member=i.guild.members.cache?.get(c.target);
  const name=clean(member?.displayName||member?.user?.username||c.details?.memberName||c.target);
  const lastAction=c.events.at(-1)?.action;
  const result=lastAction==='void'?'Warning removed.':lastAction==='note'?'Case note saved.':({ban:`Banned ${name}.`,unban:`Unbanned ${name}.`,kick:`Kicked ${name}.`,warn:`Warning recorded for ${name}.`,timeout:`Timed out ${name}${c.details?.until?' until '+new Date(c.details.until).toISOString():''}.`,untimeout:`Removed ${name}’s timeout.`,purge:`Deleted ${c.details?.deleted??0} messages.`,'emergency-on':'Channel locked.','emergency-off':'Channel unlocked.',configure:'Moderation settings saved.'}[c.action]||'Case updated.');
  const last=c.events.at(-1);
  await respond(i,{content:result,embeds:[caseEmbed(c,{title:ACTION_TITLES[lastAction]||ACTION_TITLES[c.action],actor:last?.actor||c.actor,reason:last?.reason||c.reason})],allowedMentions:{parse:[]}});
  // Moderator-only note, sent privately so the member's DM status is not announced.
  if(c.details?.dm==='failed'&&c.state==='succeeded')try{await withDeadline(i.followUp({content:'Could not DM the member. If they contact staff another way, use /appeals record.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}}),5000);}catch{}
 }
 async function config(i,sub){
  const cfg=core.config(i.guildId);
  if(sub==='view'){
   const logIssues=store.list(i.guildId,'mod-log').filter(l=>l.state!=='sent').length;
   const review=core.cases(i.guildId).filter(c=>['pending','uncertain'].includes(c.state)).length;
   return respond(i,{content:[`**Moderation settings**`,`Moderator role: ${cfg.modRole?'<@&'+cfg.modRole+'>':'Not set'}`,`Privacy role: ${cfg.privacyRole?'<@&'+cfg.privacyRole+'>':'Not set'}`,`Log channel: ${cfg.logChannel?'<#'+cfg.logChannel+'>':'Not set'}`,`Automod: ${cfg.automod?'On':'Off'}`,`Invite filter: ${cfg.blockInvites?'On':'Off'}`,`Appeal button in DMs: ${cfg.dmAppeals===false?'Off':'On'}`,`Appeal contact: ${cfg.appealContact?clean(cfg.appealContact):'Not set'}`,`Mention limit: ${cfg.mentionLimit}`,`Spam limit: ${cfg.spamLimit} messages per 10 seconds`,`Blocked phrases: ${cfg.blockedWords.length}`,`Case retention: ${cfg.retentionDays} days`,...(logIssues?['Some moderation logs haven’t been confirmed. Check the log channel.']:[]),...(review?[`${review} moderation ${review===1?'case needs':'cases need'} review.`]:[])].join('\n'),allowedMentions:{parse:[]}});
  }
  must(owner(i),'Only the current server owner can configure moderation.');
  if(sub==='clear-role'){
   const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'configuration',action:'configure',reason:'Cleared '+i.options.getString('kind'),effect:()=>core.saveConfig(i.guildId,{[i.options.getString('kind')]:null})});
   return finish(i,c);
  }
  const patch={};
  for(const [option,key]of [['mod-role','modRole'],['privacy-role','privacyRole']]){
   const selected=i.options.getRole(option);if(!selected)continue;
   const role=await read(i.guild.roles.fetch(selected.id));
   must(role&&!role.managed&&role.id!==i.guildId,'Choose a custom server role.');patch[key]=role.id;
  }
  must((patch.modRole??cfg.modRole)!==(patch.privacyRole??cfg.privacyRole)||(patch.modRole??cfg.modRole)===null,'Privacy and moderation roles must differ.');
  const ch=i.options.getChannel('log-channel');
  if(ch){const live=await read(i.guild.channels.fetch(ch.id));must(live&&[0,5].includes(live.type)&&!live.permissionsFor(i.guild.roles.everyone).has(P.ViewChannel),'Choose a staff-only text log channel.');patch.logChannel=ch.id;}
  for(const [opt,key]of [['retention-days','retentionDays'],['mention-limit','mentionLimit'],['spam-limit','spamLimit']]){const v=i.options.getInteger(opt);if(v!==null)patch[key]=v;}
  for(const [opt,key]of [['automod','automod'],['block-invites','blockInvites'],['dm-appeals','dmAppeals']]){const v=i.options.getBoolean(opt);if(v!==null)patch[key]=v;}
  const contact=i.options.getString('appeal-contact');
  if(contact!==null){const v=clean(contact).trim();must(v.length<=200&&!/@(everyone|here)|<[@#]/.test(v),'Enter a short appeal contact such as a link or email address.');patch.appealContact=/^none$/i.test(v)||!v?null:v;}
  const words=i.options.getString('blocked-words');if(words!==null)patch.blockedWords=words.split(',').map(w=>w.trim()).filter(Boolean).slice(0,100);
  if(patch.automod)must(process.env.MODERATION_MESSAGE_CONTENT==='1','Set MODERATION_MESSAGE_CONTENT=1, enable Message Content Intent in Discord, and restart before enabling automod.');
  await members(i);must(owner(i),'Only the current server owner can configure moderation.');
  const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'configuration',action:'configure',reason:'Updated moderation policy',details:{before:cfg,patch},effect:()=>core.saveConfig(i.guildId,patch)});
  return finish(i,c);
 }
 async function emergency(i,sub,actor,bot){
  allowed(i,actor,P.ManageChannels);
  if(sub==='status')return respond(i,payload(store.list(i.guildId,'mod-lock').map(l=>`${l.id}: ${l.state==='active'?'Locked':'Needs review'}`).join('\n')||'Emergency lockdown is off.'));
  must(owner(i)||has(actor,P.Administrator),'Only the owner or an administrator can change emergency lockdown.');
  const channel=await read(i.guild.channels.fetch(i.options.getChannel('channel').id));
  must(channel&&[0,5].includes(channel.type),'Choose a text or announcement channel.');
  must(channel.permissionsFor(bot).has([P.ManageRoles,P.ViewChannel]),'The bot needs Manage Roles and View Channel here.');
  const key=i.guildId+':'+channel.id;must(!pending.has(key),'This channel has an operation in progress.');pending.add(key);
  try{
   let lock=store.get(i.guildId,'mod-lock',channel.id);
   if(sub==='on'){
    must(!lock,'A saved lock already exists. Use /emergency off to restore it first.');
    const overwrites=[...channel.permissionOverwrites.cache.values()].map(o=>({id:o.id,type:o.type,allow:String(o.allow.bitfield),deny:String(o.deny.bitfield)}));
    if(!overwrites.some(o=>o.id===i.guildId))overwrites.push({id:i.guildId,type:0,allow:'0',deny:'0',added:true});
    lock={id:channel.id,state:'applying',entries:overwrites,created:Date.now()};store.put(i.guildId,'mod-lock',lock);
   }else must(lock,'No saved lockdown exists for this channel.');
   const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'channel:'+channel.id,action:'emergency-'+sub,reason:i.options.getString('reason'),effect:async({assertActive})=>{
    if(sub==='on'){
     for(const o of lock.entries){
      assertActive();
      o.started=true;store.put(i.guildId,'mod-lock',lock);
      await read(channel.permissionOverwrites.edit(o.id,{SendMessages:false,SendMessagesInThreads:false,CreatePublicThreads:false,CreatePrivateThreads:false,AddReactions:false},{type:o.type,reason:'Critical Emergency Mode'}));
      assertActive();
      o.applied=true;store.put(i.guildId,'mod-lock',lock);
     }
     lock.state='active';store.put(i.guildId,'mod-lock',lock);
    }else{
     lock.state='restoring';store.put(i.guildId,'mod-lock',lock);
     for(const o of lock.entries){
      assertActive();
      if(!o.started||o.restored)continue;
      const fresh=await read(i.guild.channels.fetch(channel.id,{force:true})),live=fresh.permissionOverwrites.cache.get(o.id);
      assertActive();
      // Compare only writing bits; independently changed visibility bits are preserved.
      if(!live){must(o.added,'An overwrite was removed. Restore it manually before retrying.');o.restored=true;store.put(i.guildId,'mod-lock',lock);continue;}
      const a=live.allow.bitfield&writing,d=live.deny.bitfield&writing;
      const originalA=BigInt(o.allow)&writing,originalD=BigInt(o.deny)&writing;
      must(a===0n&&d===writing||a===originalA&&d===originalD,'Writing permissions changed during lockdown. Resolve the conflict manually before retrying.');
      const permissions={};for(const name of ['SendMessages','SendMessagesInThreads','CreatePublicThreads','CreatePrivateThreads','AddReactions'])permissions[name]=(BigInt(o.allow)&P[name])!==0n?true:(BigInt(o.deny)&P[name])!==0n?false:null;
      await read(fresh.permissionOverwrites.edit(o.id,permissions,{type:o.type,reason:'Restore emergency lockdown snapshot'}));
      assertActive();
      o.restored=true;store.put(i.guildId,'mod-lock',lock);
     }
     store.remove(i.guildId,'mod-lock',lock.id);
    }
   }});
   // Preserve partial/interrupted snapshots for a later restoration, never auto retry mutations.
   if(c.state!=='succeeded'&&store.get(i.guildId,'mod-lock',channel.id)){lock.state='needs-review';store.put(i.guildId,'mod-lock',lock);}
   return finish(i,c);
  }finally{pending.delete(key);}
 }
 // DM appeal flow: guild and case are bound to the custom_id; the user is taken from the signed interaction.
 function dmCase(i,prefix){
  const m=new RegExp(`^${prefix}:([\\w-]{1,40}):([\\w-]{1,40})$`).exec(i.customId||'');must(m,'This appeal link is not valid.');
  const [,guild,caseId]=m;const c=store.get(guild,'mod-case',caseId);
  must(c&&c.target===i.user.id&&c.state==='succeeded'&&['ban','kick','timeout','warn'].includes(c.action),'This appeal link is not valid for your account.');
  must(!store.list(guild,'mod-appeal').some(a=>a.caseId===caseId&&a.actor===i.user.id),'An appeal already exists for that case. Ask staff for its status.');
  return {guild,caseId};
 }
 async function notifyDecision(i,a){
  try{const user=await withDeadline(client.users.fetch(a.actor),3000);await withDeadline(user.send({content:`Your appeal for case ${clean(a.caseId)} in **${clean(i.guild.name)}** was ${a.state}.${a.reason?`\nReason: ${clean(a.reason).slice(0,500)}`:''}`,allowedMentions:{parse:[]}}),3000);}catch{}
 }
 async function handleDm(i){
  if(i.isButton?.()){
   const {guild,caseId}=dmCase(i,'mod-appeal-dm');
   const modal=new ModalBuilder().setCustomId(`mod-appeal-dm-submit:${guild}:${caseId}`).setTitle('Appeal').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Why should this case be reconsidered?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
   await read(i.showModal(modal));return true;
  }
  must(i.isModalSubmit?.(),'This appeal link is not valid.');
  const {guild,caseId}=dmCase(i,'mod-appeal-dm-submit');
  const a=core.appeal(guild,i.id,i.user.id,caseId,i.fields.getTextInputValue('body'));
  await respond(i,payload(`Appeal ${a.id} submitted for case ${caseId}. Staff will review it.`));return true;
 }
 async function handle(i){
  const ours=moderationCommands.some(c=>c.name===i.commandName)||i.customId?.startsWith('mod-appeal');if(!ours)return false;
  // Staff results are public (AGENTS.md). Member-facing appeal forms stay private, and
  // validation errors raised before acknowledgement are shown only to the invoking user.
  i.privateResponse=!!i.customId?.startsWith('mod-appeal');i.privateErrors=true;
  if(i.customId?.startsWith('mod-appeal-dm'))return handleDm(i);
  if(['mod-appeal-open','mod-appeal-status'].includes(i.customId)){
   const status=i.customId==='mod-appeal-status';
   const modal=new ModalBuilder().setCustomId(status?'mod-appeal-status-submit':'mod-appeal-submit').setTitle(status?'Appeal status':'Appeal a moderation case').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case').setLabel('Case ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)));
   if(!status)modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Why should this case be reconsidered?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
   await read(i.showModal(modal));return true;
  }
  if(['mod-appeal-submit','mod-appeal-status-submit'].includes(i.customId)){
   await acknowledge(i);await read(i.guild.members.fetch({user:i.user.id,force:true}));
   if(i.customId==='mod-appeal-status-submit'){
    const a=store.list(i.guildId,'mod-appeal').find(a=>a.actor===i.user.id&&a.caseId===i.fields.getTextInputValue('case').trim());
    must(a,'No appeal found for your account and this case.');await respond(i,payload(`Appeal ${a.id}: ${a.state}${a.reason?'\nDecision reason: '+a.reason:''}`));return true;
   }
   const a=core.appeal(i.guildId,i.id,i.user.id,i.fields.getTextInputValue('case').trim(),i.fields.getTextInputValue('body'));
   await respond(i,payload('Appeal '+a.id+' submitted. Staff will review it.'));return true;
  }
  needStaff(i);
  const routeAction=moderationActions[i.commandName]||i.options.getSubcommand();
  const local=['warn','case','history','warnings','note','void','reconcile'].includes(routeAction)||
   i.commandName==='mod-settings'&&routeAction==='view'||i.commandName==='emergency'&&routeAction==='status'||i.commandName==='appeals'&&['list','show'].includes(routeAction);
  // These targets can be rejected from signed interaction data, before network
  // preflight can trigger a deferred reply. Full fresh checks still follow.
  if(['warn','ban','kick','mute','timeout','unmute','untimeout'].includes(i.commandName)){
   const target=i.options.getUser('user');
   must(target&&![i.user.id,i.guild.ownerId,client.user?.id].includes(target.id),'You cannot moderate yourself, the bot, or the server owner.');
   const resolved=i.options.getMember?.('user');
   if(completeMember(i,i.member)&&completeMember(i,i.guild.members.me)&&completeMember(i,resolved))targetSafe(i,i.member,i.guild.members.me,resolved);
  }
  if(!local)await acknowledge(i);
  const {actor,bot}=local?interactionMembers(i):await members(i);needStaff(i);
  // Explicit grants are bound to the current owner, as in /access.
  const grant=store.get(i.guildId,'access',i.user.id);
  must(owner(i)||has(actor,P.Administrator)||has(actor,P.ManageGuild)||grant?.grantedBy===i.guild.ownerId,'Your command access has expired. Ask the current owner.');
  const sub=routeAction;
  if(i.commandName==='mod-settings'){await config(i,sub);return true;}
  if(i.commandName==='emergency'){await emergency(i,sub,actor,bot);return true;}
  allowed(i,actor,({ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub])||P.ModerateMembers);
  if(sub==='warn'){
   const target=i.options.getMember?.('user');
   must(completeMember(i,bot)&&completeMember(i,target),'Member role details are unavailable.');
   targetSafe(i,actor,bot,target);
   const reason=i.options.getString('reason');must(reason?.trim(),'Enter a reason for the warning.');
   const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:target.id,action:'warn',reason,details:{memberName:clean(target.displayName||target.user.username||target.id)}});
   await finish(i,c);return true;
  }
  if(i.commandName==='appeals'){
   if(sub==='record'){
    const a=core.appeal(i.guildId,i.id,i.options.getUser('user').id,i.options.getString('case'),i.options.getString('statement'),i.user.id);
    await respond(i,payload(`Appeal ${a.id} recorded. The member and the original moderator cannot review it.`));
   }else if(sub==='panel'){
    const ch=await read(i.guild.channels.fetch(i.options.getChannel('channel').id));must(ch&&[0,5].includes(ch.type)&&ch.permissionsFor(actor).has([P.ViewChannel,P.SendMessages])&&ch.permissionsFor(bot).has([P.ViewChannel,P.SendMessages]),'Choose a text channel you and the bot can write in.');
    const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'panel:'+ch.id,action:'appeal-panel',reason:'Posted member appeal entry point',effect:()=>ch.send({...payload(appealPanelText(core.config(i.guildId).appealContact)),components:[{type:1,components:[{type:2,style:1,label:'Appeal a case',custom_id:'mod-appeal-open'},{type:2,style:2,label:'Check appeal status',custom_id:'mod-appeal-status'}]}]})});await finish(i,c);
   }else if(sub==='list'){
    const rows=store.list(i.guildId,'mod-appeal').filter(a=>a.state==='open'),page=i.options.getInteger('page')||1;
    await respond(i,payload(rows.slice((page-1)*5,page*5).map(a=>`${a.id} · case ${a.caseId} · <@${a.actor}>`).join('\n')||'No open appeals on this page.'));
   }else if(sub==='show'){
    const a=store.get(i.guildId,'mod-appeal',i.options.getString('appeal'));must(a,'Appeal not found in this server.');
    await respond(i,{content:`Appeal ${a.id} · case ${a.caseId} · ${a.state}\n${clean(a.body)}${a.reason?'\nDecision: '+clean(a.reason):''}`.slice(0,1900),allowedMentions:{parse:[]}});
   }else{const a=core.review(i.guildId,i.options.getString('appeal'),i.user.id,i.options.getString('decision'),i.options.getString('reason'));await respond(i,payload((void notifyDecision(i,a),a.state==='accepted')?`Appeal ${a.id} accepted. The sanction was not changed; use /unban or /untimeout if needed. Let the member know the decision.`:`Appeal ${a.id} denied. Let the member know the decision.`));}
   return true;
  }
  if(sub==='case'){const c=core.get(i.guildId,i.options.getString('id'));await respond(i,payload(caseText(c)+'\n'+c.events.slice(-5).map(e=>`${e.action}: ${e.reason}`).join('\n')));return true;}
  if(['history','warnings'].includes(sub)){
   const page=i.options.getInteger('page')||1;const rows=core.cases(i.guildId).filter(c=>c.target===i.options.getUser('user').id);
   const filtered=sub==='warnings'?rows.filter(c=>c.action==='warn'&&c.state==='succeeded'&&!c.voided):rows;
   await respond(i,payload(filtered.slice((page-1)*8,page*8).map(c=>`${c.id} · ${c.action} · ${caseStatus(c)}${c.voided?' · voided':''}`).join('\n')||`No ${sub==='warnings'?'active warnings':'cases'} on this page.`));return true;
  }
  if(['note','void','reconcile'].includes(sub)){
   let c=core.get(i.guildId,i.options.getString('case'));const reason=i.options.getString('reason')||'Removed by moderator';
   if(sub==='reconcile'){must(owner(i),'Only the current owner can reconcile uncertain actions after checking Discord.');c=core.reconcile(i.guildId,c.id,i.user.id,i.options.getString('outcome'),reason);}
   else{if(sub==='void'){must(c.action==='warn'&&c.state==='succeeded'&&!c.voided,'Only active successful warnings can be voided.');c.voided=true;}core.append(i.guildId,c,sub,i.user.id,reason);}
   await finish(i,c);return true;
  }
  let target,action=sub,effect,details={},selectedMember;const reason=i.options.getString('reason')||'No reason provided';
  if(sub==='warn')must(i.options.getString('reason')?.trim(),'Enter a reason for the warning.');
  const audit=`Case ${i.id}: ${reason}`.slice(0,500);
  if(sub==='purge'){
   allowed(i,actor,P.ManageMessages);
   const ch=await read(i.guild.channels.fetch(i.channelId));must(ch&&[0,5].includes(ch.type),'Purge is available in text and announcement channels.');
   must(ch.permissionsFor(actor).has([P.ViewChannel,P.ReadMessageHistory])&&ch.permissionsFor(bot).has([P.ViewChannel,P.ReadMessageHistory,P.ManageMessages]),'You need channel access; The bot needs View Channel, Read Message History and Manage Messages.');
   const messages=await read(ch.messages.fetch({limit:i.options.getInteger('count')}));
   const filterUser=i.options.getUser('user');
   const ids=[...messages.values()].filter(m=>!m.pinned&&m.createdTimestamp>Date.now()-14*86400000+60000&&(!filterUser||m.author?.id===filterUser.id)).map(m=>m.id);
   must(ids.length>0,'No recent unpinned messages matched.');target='purge:'+ch.id;details={channel:ch.id,messageIds:ids};
   effect=async()=>{const deleted=await ch.bulkDelete(ids,true);details.deleted=deleted.size;};
  }else{
   target=i.options.getUser('user').id;
   const permission={ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,timeout:P.ModerateMembers,untimeout:P.ModerateMembers,warn:P.ModerateMembers}[sub];
   must(permission,'Unknown moderation action.');allowed(i,actor,permission);must(has(bot,permission),'The bot lacks the Discord permission for this action.');
   if(sub==='unban'){
    must(target!==i.guild.ownerId&&target!==i.user.id&&target!==bot.id,'This target is protected.');
    await read(i.guild.bans.fetch(target));effect=()=>i.guild.members.unban(target,audit);
   }else{
    const member=await read(i.guild.members.fetch({user:target,force:true}));selectedMember=member;targetSafe(i,actor,bot,member);
    details.memberName=clean(member.displayName||member.user.username||member.id);
    if(sub==='kick')effect=()=>member.kick(audit);
    if(sub==='ban')effect=()=>member.ban({reason:audit,deleteMessageSeconds:0});
    if(sub==='timeout'){
     const minutes=durationMinutes(i.options.getString('duration'));details.until=Date.now()+minutes*60000;effect=()=>member.timeout(minutes*60000,audit);
    }
    if(sub==='untimeout')effect=()=>member.timeout(null,audit);
   }
  }
  // Recheck after channel/message/ban preflight, before reserving a mutation.
  const fresh=await members(i),grantNow=store.get(i.guildId,'access',i.user.id);
  must(owner(i)||has(fresh.actor,P.Administrator)||has(fresh.actor,P.ManageGuild)||grantNow?.grantedBy===i.guild.ownerId,'Command access was removed during preflight.');
  const required={ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub]||P.ModerateMembers;
  allowed(i,fresh.actor,required);must(has(fresh.bot,required),'The bot lost the required Discord permission.');
  if(selectedMember){const live=await read(i.guild.members.fetch({user:target,force:true}));targetSafe(i,fresh.actor,fresh.bot,live);}
  // Banned/kicked members can no longer receive a DM, so notify first (bounded, best effort).
  const mcfg=core.config(i.guildId);const dm=opts=>notifyMember(selectedMember,{action:sub,guild:i.guildId,guildName:i.guild.name,caseId:i.id,reason,until:details.until,contact:mcfg.appealContact,appealButton:mcfg.dmAppeals!==false,...opts});
  if(['ban','kick','timeout'].includes(sub)&&selectedMember&&!core.store.get(i.guildId,'mod-case',i.id))details.dm=await dm();
  const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target,action,reason,effect,details});await finish(i,c);
  if(c.state==='succeeded'&&sub==='warn'&&selectedMember)void dm();
  return true;
 }
 async function onMessage(message){
  if(!message.guild||!message.author||message.author.bot||message.webhookId||!core.config(message.guild.id).automod)return;
  try{
   const member=await read(message.guild.members.fetch({user:message.author.id,force:true})),cfg=core.config(message.guild.id);
   if(member.id===message.guild.ownerId||has(member,P.Administrator)||has(member,P.ManageGuild)||has(member,P.ModerateMembers)||cfg.modRole&&member.roles.cache.has(cfg.modRole))return;
   const violation=core.filter(message.guild.id,member.id,message.content||'',message.mentions.users.size+message.mentions.roles.size+(message.mentions.everyone?100:0));
   if(!violation)return;
   const bot=await read(message.guild.members.fetchMe({force:true}));if(!message.channel.permissionsFor(bot).has(P.ManageMessages))return;
   await core.run({guild:message.guild.id,id:message.id,actor:client.user.id,target:member.id,action:'automod-delete',reason:violation,details:{channel:message.channelId,message:message.id},effect:()=>message.delete()});
  }catch(error){console.warn(`Moderation message handling failed (${error.code||error.name}); no automatic retry.`);}
 }
 async function tick(){
  if(stopped||ticking)return;ticking=true;
  try{core.sweep();for(const guild of client.guilds?.cache?.values()||[]){for(const row of store.list(guild.id,'mod-log').filter(r=>r.state==='queued').slice(0,10)){const c=store.get(guild.id,'mod-case',row.caseId);if(c)await log(guild,c,row);}}}finally{ticking=false;}
 }
 client.on('messageCreate',onMessage);
 const onUpdate=(_old,m)=>{if(!m.partial)void onMessage(m);};
 client.on('messageUpdate',onUpdate);
 const timer=setInterval(()=>void tick().catch(()=>console.warn('Moderation maintenance failed. Check private storage.')),30000);timer.unref();
 return {handle,core,onMessage,tick,stop(){stopped=true;clearInterval(timer);client.off?.('messageCreate',onMessage);client.off?.('messageUpdate',onUpdate);}};
}
