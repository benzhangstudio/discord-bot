import {PermissionFlagsBits as P,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder} from 'discord.js';
import {Moderation,clean} from './moderation-core.js';
import {moderationCommands} from './moderation-commands.js';
import {UserError} from './user-error.js';
import {acknowledge,respond,withDeadline} from './responses.js';
const writing=P.SendMessages|P.SendMessagesInThreads|P.CreatePublicThreads|P.CreatePrivateThreads|P.AddReactions;
const has=(m,p)=>!!m?.permissions?.has(p);
const owner=i=>i.user.id===i.guild.ownerId;
const must=(condition,message)=>{if(!condition)throw new UserError(message);};
const payload=content=>({content:clean(content).slice(0,1900),allowedMentions:{parse:[]}});
const caseText=c=>`Case ${c.id} · ${c.action} · ${c.state}\nMember: ${c.target}\nReason: ${c.reason}${c.state==='uncertain'||c.state==='pending'?'\nInspect Discord before another action. The owner can record the verified outcome with /mod reconcile.':c.state==='failed'?'\nDiscord rejected this action. Check bot permissions, role order and the target’s status before retrying.':''}`;
const rank=m=>m.roles.highest.position;
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
  must(owner(i)||has(actor,P.Administrator)||has(actor,permission)||cfg.modRole&&actor.roles.cache.has(cfg.modRole),'You need the relevant moderation permission or the configured moderation role, plus Number One command access.');
 }
 function targetSafe(i,actor,bot,target){
  const cfg=core.config(i.guildId);
  must(target.id!==i.user.id&&target.id!==bot.id&&target.id!==i.guild.ownerId,'You cannot moderate yourself, Number One, or the server owner.');
  must(!target.user.bot,'Bot accounts must be handled manually by the server owner.');
  must(!has(target,P.Administrator),'Administrator members are protected.');
  must(!cfg.modRole||!target.roles.cache.has(cfg.modRole),'Configured moderators are protected.');
  must(rank(bot)>rank(target),'Move Number One above the target’s highest role.');
  must(owner(i)||rank(actor)>rank(target),'Your highest role must be above the target’s highest role.');
 }
 async function log(guild,c,row){
  const cfg=core.config(guild.id);
  if(!cfg.logChannel||row?.state!=='queued')return;
  try{
   const ch=await read(guild.channels.fetch(cfg.logChannel));
   must(ch&&![10,11,12].includes(ch.type)&&!ch.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel),'Log channel must remain hidden from everyone.');
   // A claimed log is never blindly retried after an ambiguous send.
   store.put(guild.id,'mod-log',{...row,state:'sending'});
   await read(ch.send({...payload(caseText(c)+(row.event?`\n${row.event.action} by ${row.event.actor}: ${row.event.reason}`:'')),nonce:row.id.slice(-25),enforceNonce:true}));
   store.put(guild.id,'mod-log',{...row,state:'sent'});
  }catch{const current=store.get(guild.id,'mod-log',row.id);store.put(guild.id,'mod-log',{...row,state:current?.state==='sending'?'uncertain':'queued'});}
 }
 async function finish(i,c){await respond(i,payload(caseText(c)));}
 async function config(i,sub){
  const cfg=core.config(i.guildId);
  if(sub==='view')return respond(i,{content:(JSON.stringify(cfg)+'\nLog delivery issues (ID, state):\n'+store.list(i.guildId,'mod-log').filter(l=>l.state!=='sent').slice(-10).map(l=>`${l.id}: ${l.state}`).join('\n')+'\nInterrupted/uncertain case IDs: '+core.cases(i.guildId).filter(c=>['pending','uncertain'].includes(c.state)).slice(0,10).map(c=>c.id).join(', ')).slice(0,1900),allowedMentions:{parse:[]}});
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
  for(const [opt,key]of [['automod','automod'],['block-invites','blockInvites']]){const v=i.options.getBoolean(opt);if(v!==null)patch[key]=v;}
  const words=i.options.getString('blocked-words');if(words!==null)patch.blockedWords=words.split(',').map(w=>w.trim()).filter(Boolean).slice(0,100);
  if(patch.automod)must(process.env.MODERATION_MESSAGE_CONTENT==='1','Set MODERATION_MESSAGE_CONTENT=1, enable Message Content Intent in Discord, and restart before enabling automod.');
  await members(i);must(owner(i),'Only the current server owner can configure moderation.');
  const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'configuration',action:'configure',reason:'Updated moderation policy',details:{before:cfg,patch},effect:()=>core.saveConfig(i.guildId,patch)});
  return finish(i,c);
 }
 async function emergency(i,sub,actor,bot){
  allowed(i,actor,P.ManageChannels);
  if(sub==='status')return respond(i,payload(store.list(i.guildId,'mod-lock').map(l=>`${l.id}: ${l.state}`).join('\n')||'Critical Emergency Mode is inactive.'));
  must(owner(i)||has(actor,P.Administrator),'Only the owner or an administrator can change Critical Emergency Mode.');
  const channel=await read(i.guild.channels.fetch(i.options.getChannel('channel').id));
  must(channel&&[0,5].includes(channel.type),'Choose a text or announcement channel.');
  must(channel.permissionsFor(bot).has([P.ManageRoles,P.ViewChannel]),'Number One needs Manage Roles and View Channel here.');
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
      await read(fresh.permissionOverwrites.edit(o.id,permissions,{type:o.type,reason:'Restore Critical Emergency Mode snapshot'}));
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
 async function handle(i){
  const ours=moderationCommands.some(c=>c.name===i.commandName)||i.customId?.startsWith('mod-appeal');if(!ours)return false;
  i.privateResponse=true;
  if(['mod-appeal-open','mod-appeal-status'].includes(i.customId)){
   const status=i.customId==='mod-appeal-status';
   const modal=new ModalBuilder().setCustomId(status?'mod-appeal-status-submit':'mod-appeal-submit').setTitle(status?'Appeal status':'Appeal a moderation case').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case').setLabel('Your case ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)));
   if(!status)modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Why should staff reconsider?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
   await read(i.showModal(modal));return true;
  }
  if(['mod-appeal-submit','mod-appeal-status-submit'].includes(i.customId)){
   await acknowledge(i);await read(i.guild.members.fetch({user:i.user.id,force:true}));
   if(i.customId==='mod-appeal-status-submit'){
    const a=store.list(i.guildId,'mod-appeal').find(a=>a.actor===i.user.id&&a.caseId===i.fields.getTextInputValue('case').trim());
    must(a,'No appeal found for your account and this case.');await respond(i,payload(`Appeal ${a.id}: ${a.state}${a.reason?'\nDecision reason: '+a.reason:''}`));return true;
   }
   const a=core.appeal(i.guildId,i.id,i.user.id,i.fields.getTextInputValue('case').trim(),i.fields.getTextInputValue('body'));
   await respond(i,payload('Appeal '+a.id+' saved for staff review. Staff will communicate the decision; it does not automatically remove a sanction.'));return true;
  }
  needStaff(i);await acknowledge(i);
  const {actor,bot}=await members(i);needStaff(i);
  // Explicit grants are bound to the current owner, as in /access.
  const grant=store.get(i.guildId,'access',i.user.id);
  must(owner(i)||has(actor,P.Administrator)||has(actor,P.ManageGuild)||grant?.grantedBy===i.guild.ownerId,'Your Number One command access has expired. Ask the current owner.');
  const sub=i.options.getSubcommand();
  if(i.commandName==='mod-settings'){await config(i,sub);return true;}
  if(i.commandName==='emergency'){await emergency(i,sub,actor,bot);return true;}
  allowed(i,actor,({ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub])||P.ModerateMembers);
  if(i.commandName==='appeals'){
   if(sub==='record'){
    const a=core.appeal(i.guildId,i.id,i.options.getUser('user').id,i.options.getString('case'),i.options.getString('statement'),i.user.id);
    await respond(i,payload(`External appeal ${a.id} saved for independent review. The subject and original moderator cannot decide it.`));
   }else if(sub==='panel'){
    const ch=await read(i.guild.channels.fetch(i.options.getChannel('channel').id));must(ch&&[0,5].includes(ch.type)&&ch.permissionsFor(actor).has([P.ViewChannel,P.SendMessages])&&ch.permissionsFor(bot).has([P.ViewChannel,P.SendMessages]),'Choose a text channel you and Number One can write in.');
    const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'panel:'+ch.id,action:'appeal-panel',reason:'Posted member appeal entry point',effect:()=>ch.send({...payload('Appeal a Number One moderation case. Your submission is private to staff. Banned or departed members: contact the server’s published appeal contact.'),components:[{type:1,components:[{type:2,style:1,label:'Submit an appeal',custom_id:'mod-appeal-open'},{type:2,style:2,label:'Check appeal status',custom_id:'mod-appeal-status'}]}]})});await finish(i,c);
   }else if(sub==='list'){
    const rows=store.list(i.guildId,'mod-appeal').filter(a=>a.state==='open'),page=i.options.getInteger('page')||1;
    await respond(i,payload(rows.slice((page-1)*5,page*5).map(a=>`${a.id} · case ${a.caseId} · ${a.actor}`).join('\n')||'No open appeals on this page.'));
   }else if(sub==='show'){
    const a=store.get(i.guildId,'mod-appeal',i.options.getString('appeal'));must(a,'Appeal not found in this server.');
    await respond(i,{content:`Appeal ${a.id} · case ${a.caseId} · ${a.state}\n${clean(a.body)}${a.reason?'\nDecision: '+clean(a.reason):''}`.slice(0,1900),allowedMentions:{parse:[]}});
   }else{const a=core.review(i.guildId,i.options.getString('appeal'),i.user.id,i.options.getString('decision'),i.options.getString('reason'));await respond(i,payload(`Appeal ${a.id}: ${a.state}. Communicate the decision privately to the member. Accepted appeals require a separate explicit reversal command.`));}
   return true;
  }
  if(sub==='case'){const c=core.get(i.guildId,i.options.getString('case'));await respond(i,payload(caseText(c)+'\n'+c.events.slice(-5).map(e=>`${e.action}: ${e.reason}`).join('\n')));return true;}
  if(sub==='history'){
   const page=i.options.getInteger('page')||1;const rows=core.cases(i.guildId).filter(c=>c.target===i.options.getUser('user').id);
   await respond(i,payload(rows.slice((page-1)*8,page*8).map(c=>`${c.id} · ${c.action} · ${c.state}${c.voided?' · voided':''}`).join('\n')||'No cases on this page.'));return true;
  }
  if(['note','void','reconcile'].includes(sub)){
   let c=core.get(i.guildId,i.options.getString('case'));const reason=i.options.getString('reason');
   if(sub==='reconcile'){must(owner(i),'Only the current owner can reconcile uncertain actions after checking Discord.');c=core.reconcile(i.guildId,c.id,i.user.id,i.options.getString('outcome'),reason);}
   else{if(sub==='void'){must(c.action==='warn'&&c.state==='succeeded'&&!c.voided,'Only active successful warnings can be voided.');c.voided=true;}core.append(i.guildId,c,sub,i.user.id,reason);}
   await finish(i,c);return true;
  }
  let target,action=sub,effect,details={},selectedMember;const reason=i.options.getString('reason');
  const audit=`Number One ${i.id}: ${reason}`.slice(0,500);
  if(sub==='purge'){
   must(i.options.getString('confirm')==='yes','Confirm deletion with yes.');allowed(i,actor,P.ManageMessages);
   const ch=await read(i.guild.channels.fetch(i.channelId));must(ch&&[0,5].includes(ch.type),'Purge is available in text and announcement channels.');
   must(ch.permissionsFor(actor).has([P.ViewChannel,P.ReadMessageHistory])&&ch.permissionsFor(bot).has([P.ViewChannel,P.ReadMessageHistory,P.ManageMessages]),'You need channel access; Number One needs View Channel, Read Message History and Manage Messages.');
   const messages=await read(ch.messages.fetch({limit:i.options.getInteger('count')}));
   const ids=[...messages.values()].filter(m=>!m.pinned&&m.createdTimestamp>Date.now()-14*86400000+60000).map(m=>m.id);
   must(ids.length>0,'No recent unpinned messages matched.');target='purge:'+ch.id;details={channel:ch.id,messageIds:ids};
   effect=async()=>{const deleted=await ch.bulkDelete(ids,true);details.deleted=deleted.size;};
  }else{
   target=i.options.getUser('user').id;
   const permission={ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,timeout:P.ModerateMembers,untimeout:P.ModerateMembers,warn:P.ModerateMembers}[sub];
   must(permission,'Unknown moderation action.');allowed(i,actor,permission);must(has(bot,permission),'Number One lacks the Discord permission for this action.');
   if(sub==='unban'){
    must(target!==i.guild.ownerId&&target!==i.user.id&&target!==bot.id,'This target is protected.');
    await read(i.guild.bans.fetch(target));effect=()=>i.guild.members.unban(target,audit);
   }else{
    const member=await read(i.guild.members.fetch({user:target,force:true}));selectedMember=member;targetSafe(i,actor,bot,member);
    if(sub==='kick')effect=()=>member.kick(audit);
    if(sub==='ban')effect=()=>member.ban({reason:audit,deleteMessageSeconds:0});
    if(sub==='timeout'){
     const minutes=i.options.getInteger('minutes');must(Number.isInteger(minutes)&&minutes>=1&&minutes<=40320,'Timeout must be 1 to 40320 minutes.');details.until=Date.now()+minutes*60000;effect=()=>member.timeout(minutes*60000,audit);
    }
    if(sub==='untimeout')effect=()=>member.timeout(null,audit);
   }
  }
  // Recheck after channel/message/ban preflight, before reserving a mutation.
  const fresh=await members(i),grantNow=store.get(i.guildId,'access',i.user.id);
  must(owner(i)||has(fresh.actor,P.Administrator)||has(fresh.actor,P.ManageGuild)||grantNow?.grantedBy===i.guild.ownerId,'Command access was removed during preflight.');
  const required={ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub]||P.ModerateMembers;
  allowed(i,fresh.actor,required);must(has(fresh.bot,required),'Number One lost the required Discord permission.');
  if(selectedMember){const live=await read(i.guild.members.fetch({user:target,force:true}));targetSafe(i,fresh.actor,fresh.bot,live);}
  const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target,action,reason,effect,details});await finish(i,c);return true;
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
