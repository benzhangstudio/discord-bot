import {MessageFlags,PermissionFlagsBits as P,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder} from 'discord.js';
import {Moderation,clean} from './moderation-core.js';
import {moderationCommands,moderationAction} from './moderation-commands.js';
import {UserError} from './user-error.js';
import {acknowledge,respond,withDeadline,updateResponse} from './responses.js';
import {caseListPayload,caseEmbedFull,appealListPayload,appealEmbed} from './mod-format.js';
import {publicErrorMessage,UNCERTAIN_ACTION} from './public-errors.js';
const writing=P.SendMessages|P.SendMessagesInThreads|P.CreatePublicThreads|P.CreatePrivateThreads|P.AddReactions;
const has=(m,p)=>!!m?.permissions?.has(p);
const owner=i=>i.user.id===i.guild.ownerId;
const must=(condition,message)=>{if(!condition)throw new UserError(message);};
const payload=content=>({content:clean(content).slice(0,1900),allowedMentions:{parse:[]}});
const caseStatus=c=>({succeeded:'Completed',failed:'Not completed',uncertain:'Needs review',pending:'Needs review'}[c.state]||'Needs review');
export const caseLabel=c=>c?.number?`Case #${c.number}`:'Case';
export const ACTION_NAMES={ban:'Ban',unban:'Unban',kick:'Kick',warn:'Warn',timeout:'Timeout',untimeout:'Timeout removed',purge:'Purge','emergency-on':'Lockdown','emergency-off':'Unlock',configure:'Settings change','automod-delete':'Automod','appeal-panel':'Appeal panel'};
const ts=(ms,style='f')=>`<t:${Math.floor(ms/1000)}:${style}>`;
const DM_LABELS={sent:'Sent',skipped:'Failed (DMs closed)',disabled:'Not sent (disabled)',failed:'Failed (DMs closed)'};
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
 fields.push({name:'Reason',value:clean(reason||c.reason||'No reason provided').slice(0,1000)},{name:'Case',value:c.number?`#${c.number}`:'—',inline:true});
 if(DM_LABELS[c.details?.dm])fields.push({name:'DM',value:DM_LABELS[c.details.dm],inline:true});
 return {title:title||ACTION_TITLES[c.action]||'Case updated',color:COLOR,fields,timestamp:new Date(c.updatedAt||c.createdAt||Date.now()).toISOString()};
};
// Bounded DM to the affected member, sent BEFORE ban/kick/timeout because Discord
// will not open a DM with a user who shares no server. Never blocks the action.
const DM_TEXT={ban:'You were banned from',kick:'You were kicked from',timeout:'You were timed out in',warn:'You were warned in',untimeout:'Your timeout was removed in',unban:'You were unbanned from'};
const APPEALABLE=['ban','kick','timeout','warn'];
export const appealButtonId=(guild,caseId)=>`mod-appeal-dm:${guild}:${caseId}`;
async function notifyMember(member,{deadline=3000,action,guild,guildName,caseId,caseNumber,reason,until,contact,appealButton}){
 appealButton=appealButton&&APPEALABLE.includes(action);
 if(!member?.send||!DM_TEXT[action])return 'skipped';
 const lines=[`${DM_TEXT[action]} **${clean(guildName||'the server')}**.`,`Reason: ${clean(reason||'No reason provided').slice(0,500)}`,`Case: #${caseNumber}`];
 if(until)lines.push(`Ends: <t:${Math.floor(until/1000)}:f>`);
 if(appealButton)lines.push('To appeal, use the button below.');else if(contact&&['ban','kick'].includes(action))lines.push(`To appeal: ${clean(contact)}`);
 const message={content:lines.join('\n'),allowedMentions:{parse:[]}};
 if(appealButton)message.components=[{type:1,components:[{type:2,style:2,label:'Appeal',custom_id:appealButtonId(guild,caseId)}]}];
 try{await withDeadline(member.send(message),deadline);return 'sent';}catch{return 'failed';}
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
 function caseOf(g,id){try{return core.get(g,id);}catch{return null;}}
 function appealFor(g,c){return store.list(g,'mod-appeal').filter(a=>a.caseId===c.id).sort((a,b)=>b.created-a.created)[0];}
 function appealsPayload(i,page){
  const rows=store.list(i.guildId,'mod-appeal').filter(a=>a.state==='open').sort((a,b)=>a.created-b.created);
  return appealListPayload({rows,page,invoker:i.user.id,caseOf:id=>caseOf(i.guildId,id)});
 }
 async function listPayload(i,kind,target,page,invoker,user){
  user??=client.users?.cache?.get(target)||await Promise.resolve().then(()=>withDeadline(client.users.fetch(target),3000)).catch(()=>null);
  const member=i.guild?.members?.cache?.get?.(target);
  const info={id:target,name:clean(member?.displayName||user?.globalName||user?.username||'This member'),avatar:(member||user)?.displayAvatarURL?.()};
  const rows=core.cases(i.guildId).filter(c=>c.target===target&&(kind!=='warnings'||c.action==='warn'&&c.state==='succeeded'&&!c.voided));
  return caseListPayload({kind,user:info,rows,page,invoker});
 }
 function dmWanted(i){const v=i.options.getBoolean?.('dm');return v??(core.config(i.guildId).dmMembers!==false);}
 function dmArgs(i,c,action,reason){const cfg=core.config(i.guildId);return {action,guild:i.guildId,guildName:i.guild.name,caseId:c.id,caseNumber:c.number,reason,contact:cfg.appealContact,appealButton:cfg.dmAppeals!==false};}
 function recordDm(g,c,state){c.details={...c.details,dm:state==='skipped'?'failed':state};return store.put(g,'mod-case',c);}
 async function finish(i,c){
  if(c.state!=='succeeded')return respond(i,payload((['uncertain','pending'].includes(c.state)?UNCERTAIN_ACTION:publicErrorMessage({code:c.error}))+`\n${caseLabel(c)}`));
  const member=i.guild.members.cache?.get(c.target);
  const name=clean(member?.displayName||member?.user?.username||c.details?.memberName||c.target);
  const lastAction=c.events.at(-1)?.action;
  const result=lastAction==='void'?'Warning removed.':lastAction==='note'?'Case note saved.':({ban:`Banned ${name}.`,unban:`Unbanned ${name}.`,kick:`Kicked ${name}.`,warn:`Warning recorded for ${name}.`,timeout:`Timed out ${name}${c.details?.until?' until '+ts(c.details.until):''}.`,untimeout:`Removed ${name}’s timeout.`,purge:`Deleted ${c.details?.deleted??0} messages.`,'emergency-on':'Channel locked.','emergency-off':'Channel unlocked.',configure:'Moderation settings saved.'}[c.action]||'Case updated.');
  const last=c.events.at(-1);
  const dmNote=c.details?.dm==='failed'&&c.state==='succeeded'?'\nCould not DM the member. If they contact staff another way, use /appeals record.':'';
  await respond(i,{content:result+dmNote,embeds:[caseEmbed(c,{title:ACTION_TITLES[lastAction]||ACTION_TITLES[c.action],actor:last?.actor||c.actor,reason:last?.reason||c.reason})],allowedMentions:{parse:[]}});
 }
 // Read-only summary for /settings view. Moderation settings are edited on the dashboard.
 function settingsSummary(guildId){
  const cfg=core.config(guildId);
  const logIssues=store.list(guildId,'mod-log').filter(l=>l.state!=='sent').length;
  const review=core.cases(guildId).filter(c=>['pending','uncertain'].includes(c.state)).length;
  return [`Moderator role: ${cfg.modRole?'<@&'+cfg.modRole+'>':'Not set'}`,`Protected role: ${cfg.privacyRole?'<@&'+cfg.privacyRole+'>':'Not set'}`,`Log channel: ${cfg.logChannel?'<#'+cfg.logChannel+'>':'Not set'}`,`Automod: ${cfg.automod?'On':'Off'} · Invite filter: ${cfg.blockInvites?'On':'Off'}`,`DM members by default: ${cfg.dmMembers===false?'Off':'On'}`,`Appeal button in DMs: ${cfg.dmAppeals===false?'Off':'On'} · Appeal contact: ${cfg.appealContact?clean(cfg.appealContact):'Not set'}`,`Case retention: ${cfg.retentionDays} days`,...(logIssues?['Some moderation logs haven’t been confirmed. Check the log channel.']:[]),...(review?[`${review} moderation ${review===1?'case needs':'cases need'} review.`]:[])].join('\n');
 }
 async function emergency(i,sub,actor,bot){
  allowed(i,actor,P.ManageChannels);
  if(sub==='status')return respond(i,{content:store.list(i.guildId,'mod-lock').map(l=>`<#${l.id}> · ${l.state==='active'?'Locked':'Needs review'}`).join('\n')||'Emergency lockdown is off.',allowedMentions:{parse:[]}});
  must(owner(i)||has(actor,P.Administrator),'Only the owner or an administrator can change emergency lockdown.');
  const channel=await read(i.guild.channels.fetch(i.options.getChannel('channel').id));
  must(channel&&[0,5].includes(channel.type),'Choose a text or announcement channel.');
  must(channel.permissionsFor(bot).has([P.ManageRoles,P.ViewChannel]),'The bot needs Manage Roles and View Channel here.');
  const key=i.guildId+':'+channel.id;must(!pending.has(key),'This channel has an operation in progress.');pending.add(key);
  try{
   let lock=store.get(i.guildId,'mod-lock',channel.id);
   if(sub==='on'){
    must(!lock,'A saved lock already exists. Use /lockdown off to restore it first.');
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
  try{const user=await withDeadline(client.users.fetch(a.actor),3000);await withDeadline(user.send({content:`Your appeal for ${caseLabel(caseOf(i.guildId,a.caseId))} in **${clean(i.guild.name)}** was ${a.state}.${a.reason?`\nReason: ${clean(a.reason).slice(0,500)}`:''}`,allowedMentions:{parse:[]}}),3000);}catch{}
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
  await respond(i,payload(`Appeal for ${caseLabel(store.get(guild,'mod-case',caseId))} submitted. Staff will review it.`));return true;
 }
 async function handle(i){
  const ours=moderationCommands.some(c=>c.name===i.commandName)||i.customId?.startsWith('mod-appeal')||i.customId?.startsWith('modpage:');if(!ours)return false;
  // All replies in server channels are public; only DM appeal interactions are private.
  i.privateResponse=!i.guildId;
  if(i.customId?.startsWith('mod-appeal-dm'))return handleDm(i);
  if(['mod-appeal-open','mod-appeal-status'].includes(i.customId)){
   const status=i.customId==='mod-appeal-status';
   const modal=new ModalBuilder().setCustomId(status?'mod-appeal-status-submit':'mod-appeal-submit').setTitle(status?'Appeal status':'Appeal a moderation case').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case').setLabel('Case number').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)));
   if(!status)modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Why should this case be reconsidered?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
   await read(i.showModal(modal));return true;
  }
  if(['mod-appeal-submit','mod-appeal-status-submit'].includes(i.customId)){
   await acknowledge(i);await read(i.guild.members.fetch({user:i.user.id,force:true}));
   if(i.customId==='mod-appeal-status-submit'){
    const ref=caseOf(i.guildId,i.fields.getTextInputValue('case').trim())?.id;const a=ref&&store.list(i.guildId,'mod-appeal').find(a=>a.actor===i.user.id&&a.caseId===ref);
    must(a,'No appeal found for your account and this case.');await respond(i,{embeds:[appealEmbed(a,caseOf(i.guildId,a.caseId))],allowedMentions:{parse:[]}});return true;
   }
   const a=core.appeal(i.guildId,i.id,i.user.id,i.fields.getTextInputValue('case').trim(),i.fields.getTextInputValue('body'));
   await respond(i,payload(`Appeal for ${caseLabel(caseOf(i.guildId,a.caseId))} submitted. Staff will review it.`));return true;
  }
  if(i.customId?.startsWith('modpage:')){
   const [,kind,target,page,invoker]=i.customId.split(':');
   if(i.user.id!==invoker)needStaff(i);
   await updateResponse(i,kind==='appeals'?appealsPayload(i,Number(page)):await listPayload(i,kind,target,Number(page),invoker));return true;
  }
  needStaff(i);
  const routeAction=moderationAction(i.commandName,i.options.getSubcommand(false));
  const local=['warn','case','history','warnings','note','void','reconcile'].includes(routeAction)||
   i.commandName==='lockdown'&&routeAction==='status'||i.commandName==='appeals'&&['list','show'].includes(routeAction);
  // These targets can be rejected from signed interaction data, before network
  // preflight can trigger a deferred reply. Full fresh checks still follow.
  if(['warn','ban','kick','timeout','untimeout'].includes(i.commandName)){
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
  if(i.commandName==='lockdown'){await emergency(i,sub,actor,bot);return true;}
  allowed(i,actor,({ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub])||P.ModerateMembers);
  if(sub==='warn'){
   const target=i.options.getMember?.('user');
   must(completeMember(i,bot)&&completeMember(i,target),'Member role details are unavailable.');
   targetSafe(i,actor,bot,target);
   const reason=i.options.getString('reason');must(reason?.trim(),'Enter a reason for the warning.');
   // Warn stays a single initial response (no deferral), so its DM gets a short bound.
   const send=dmWanted(i);
   let c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:target.id,action:'warn',reason,details:{memberName:clean(target.displayName||target.user.username||target.id),dm:send?undefined:'disabled'}});
   if(c.state==='succeeded'&&send&&!c.details.dm)c=recordDm(i.guildId,c,await notifyMember(target,{...dmArgs(i,c,'warn',reason),deadline:1500}));
   await finish(i,c);return true;
  }
  if(i.commandName==='appeals'){
   if(sub==='record'){
    const a=core.appeal(i.guildId,i.id,i.options.getUser('user').id,i.options.getString('case'),i.options.getString('statement'),i.user.id);
    await respond(i,payload(`Appeal for ${caseLabel(caseOf(i.guildId,a.caseId))} recorded. Appeal ID: ${a.id}. The member and the original moderator cannot review it.`));
   }else if(sub==='panel'){
    const ch=await read(i.guild.channels.fetch(i.options.getChannel('channel').id));must(ch&&[0,5].includes(ch.type)&&ch.permissionsFor(actor).has([P.ViewChannel,P.SendMessages])&&ch.permissionsFor(bot).has([P.ViewChannel,P.SendMessages]),'Choose a text channel you and the bot can write in.');
    const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'panel:'+ch.id,action:'appeal-panel',reason:'Posted member appeal entry point',effect:()=>ch.send({...payload(appealPanelText(core.config(i.guildId).appealContact)),components:[{type:1,components:[{type:2,style:1,label:'Appeal a case',custom_id:'mod-appeal-open'},{type:2,style:2,label:'Check appeal status',custom_id:'mod-appeal-status'}]}]})});await finish(i,c);
   }else if(sub==='list'){
    await respond(i,appealsPayload(i,i.options.getInteger('page')||1));
   }else if(sub==='show'){
    const a=store.get(i.guildId,'mod-appeal',i.options.getString('appeal'));must(a,'Appeal not found in this server.');
    await respond(i,{embeds:[appealEmbed(a,caseOf(i.guildId,a.caseId))],allowedMentions:{parse:[]}});
   }else{const a=core.review(i.guildId,i.options.getString('appeal'),i.user.id,i.options.getString('decision'),i.options.getString('reason'));await respond(i,payload((void notifyDecision(i,a),a.state==='accepted')?`Appeal for ${caseLabel(caseOf(i.guildId,a.caseId))} accepted. The sanction was not changed; use /unban or /untimeout if needed. Let the member know the decision.`:`Appeal for ${caseLabel(caseOf(i.guildId,a.caseId))} denied. Let the member know the decision.`));}
   return true;
  }
  if(sub==='case'){const c=core.get(i.guildId,i.options.getString('id'));await respond(i,{embeds:[caseEmbedFull(c,appealFor(i.guildId,c))],allowedMentions:{parse:[]}});return true;}
  if(['history','warnings'].includes(sub)){
   const u=i.options.getUser('user');
   await respond(i,await listPayload(i,sub,u.id,i.options.getInteger('page')||1,i.user.id,u));return true;
  }
  if(['note','void','reconcile'].includes(sub)){
   let c=core.get(i.guildId,i.options.getString('case'));const reason=i.options.getString('reason')||'Removed by moderator';
   if(sub==='reconcile'){must(owner(i),'Only the current owner can reconcile uncertain actions after checking Discord.');c=core.reconcile(i.guildId,c.id,i.user.id,i.options.getString('outcome'),reason);}
   else{if(sub==='void'){must(c.action==='warn'&&c.state==='succeeded'&&!c.voided,'Only active successful warnings can be voided.');c.voided=true;}core.append(i.guildId,c,sub,i.user.id,reason);}
   await finish(i,c);return true;
  }
  let target,action=sub,effect,details={},selectedMember;const reason=i.options.getString('reason')||'No reason provided';
  if(sub==='warn')must(i.options.getString('reason')?.trim(),'Enter a reason for the warning.');
  const audit=`Case #${core.reserveNumber(i.guildId,i.id)}: ${reason}`.slice(0,500);
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
  // dm:false (or the server default) sends nothing, including no Appeal button.
  const send=DM_TEXT[sub]&&dmWanted(i);if(DM_TEXT[sub]&&!send)details.dm='disabled';
  const caseNumber=core.reserveNumber(i.guildId,i.id);
  const args={...dmArgs(i,{id:i.id,number:caseNumber},sub,reason),until:details.until};
  if(send&&['ban','kick','timeout'].includes(sub)&&selectedMember&&!core.store.get(i.guildId,'mod-case',i.id))details.dm=await notifyMember(selectedMember,args);
  let c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target,action,reason,effect,details});
  // Unban and timeout removal DM afterwards; an unbanned user is reachable only if they still share a server with the bot.
  if(send&&c.state==='succeeded'&&['untimeout','unban'].includes(sub)&&!c.details.dm){
   const recipient=selectedMember||await Promise.resolve().then(()=>withDeadline(client.users.fetch(target),3000)).catch(()=>null);
   c=recordDm(i.guildId,c,recipient?await notifyMember(recipient,args):'failed');
  }
  await finish(i,c);
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
 return {handle,core,settingsSummary,onMessage,tick,stop(){stopped=true;clearInterval(timer);client.off?.('messageCreate',onMessage);client.off?.('messageUpdate',onUpdate);}};
}
