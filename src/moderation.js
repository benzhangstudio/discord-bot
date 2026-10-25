import {AuditLogEvent,MessageFlags,PermissionFlagsBits as P} from 'discord.js';
import {Moderation,clean} from './moderation-core.js';
import {moderationCommands,moderationAction} from './moderation-commands.js';
import {UserError} from './user-error.js';
import {acknowledge,respond,withDeadline,updateResponse} from './responses.js';
import {caseListPayload,caseEmbedFull} from './mod-format.js';
import {publicErrorMessage,UNCERTAIN_ACTION} from './public-errors.js';
import {errorPayload} from './error-embed.js';
import {modlogConfig,modlogEmbed,eventKey,missingPermissions,enabledList} from './modlog.js';
import {readProof,addProof,proofItems,proofSummary,firstImage} from './mod-proof.js';
import {commandPluginEnabled} from './plugins.js';
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
export const ACTION_TITLES={ban:'Member banned',unban:'Member unbanned',kick:'Member kicked',warn:'Member warned',timeout:'Member timed out',untimeout:'Timeout removed',purge:'Messages deleted','emergency-on':'Channel locked','emergency-off':'Channel unlocked',configure:'Moderation settings updated','automod-delete':'Message deleted by automod','appeal-panel':'Appeal panel posted',note:'Case note added',void:'Warning removed',proof:'Images added'};
const mention=id=>/^\d{15,25}$/.test(String(id))?`<@${id}>`:clean(String(id));
const caseEmbed=(c,{title,actor,reason,image}={})=>{
 const fields=[];
 if(['ban','unban','kick','warn','timeout','untimeout','automod-delete'].includes(c.action))fields.push({name:'User',value:mention(c.target),inline:true});
 fields.push({name:'Moderator',value:mention(actor||c.actor),inline:true});
 if(c.details?.until)fields.push({name:'Until',value:`<t:${Math.floor(c.details.until/1000)}:f>`,inline:true});
 if(c.action==='purge')fields.push({name:'Messages',value:String(c.details?.deleted??0),inline:true});
 fields.push({name:'Reason',value:clean(reason||c.reason||'No reason provided').slice(0,1000)});
 if(DM_LABELS[c.details?.dm])fields.push({name:'DM',value:DM_LABELS[c.details.dm],inline:true});
 const proof=proofSummary(c);if(proof)fields.push({name:'Attachments',value:proof});
 const img=image===undefined?firstImage(c):image;
 return {title:title||ACTION_TITLES[c.action]||'Case updated',color:COLOR,fields,...(img?{image:{url:img}}:{}),timestamp:new Date(c.updatedAt||c.createdAt||Date.now()).toISOString()};
};
// Bounded DM to the affected member, sent BEFORE ban/kick/timeout because Discord
// will not open a DM with a user who shares no server. Never blocks the action.
const DM_TEXT={ban:'You were banned from',kick:'You were kicked from',timeout:'You were timed out in',warn:'You were warned in',untimeout:'Your timeout was removed in',unban:'You were unbanned from'};
async function notifyMember(member,{deadline=3000,action,guild,guildName,reason,until}){
 if(!member?.send||!DM_TEXT[action])return 'skipped';
 const lines=[`${DM_TEXT[action]} **${clean(guildName||'the server')}**.`,`Reason: ${clean(reason||'No reason provided').slice(0,500)}`];
 if(until)lines.push(`Ends: <t:${Math.floor(until/1000)}:f>`);
 const message={content:lines.join('\n'),allowedMentions:{parse:[]}};
 try{await withDeadline(member.send(message),deadline);return 'sent';}catch{return 'failed';}
}

export function durationMinutes(value){
 const match=/^(\d+)\s*(m|h|d|w)$/i.exec(String(value||'').trim());
 const minutes=match?Number(match[1])*({m:1,h:60,d:1440,w:10080}[match[2].toLowerCase()]):NaN;
 must(Number.isSafeInteger(minutes)&&minutes>=1&&minutes<=40320,'Use a duration such as 10m, 1h, 1d or 1w (up to 28 days).');return minutes;
}
export function createModeration(client,store,{needStaff,timeoutMs=12000}={}) {
 const core=new Moderation(store,{timeoutMs});
 core.purgeRemoved();
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
 // Mod Log delivery. The row is claimed synchronously ('sending') before any await, so the
 // immediate flush and the maintenance tick never post the same entry twice, and an
 // ambiguous send is never blindly retried.
 async function log(guild,c,row){
  if(row?.state!=='queued')return;
  const exists=()=>store.get(guild.id,'mod-case',c.id)&&store.get(guild.id,'mod-log',row.id);
  if(!exists())return;
  const cfg=modlogConfig(store,guild.id),key=row.v===2?eventKey(c,row.event?.action):null;
  if(!key||!cfg.enabled||cfg.events[key]===false){store.put(guild.id,'mod-log',{...row,state:'skipped'});return;}
  store.put(guild.id,'mod-log',{...row,state:'sending'});
  let sending=false;
  try{
   const ch=await read(guild.channels.fetch(cfg.channel));
   if(!exists())return;
   const me=guild.members?.me;
   const missing=ch&&[0,5].includes(ch.type)?missingPermissions(ch,me).filter(n=>n!=='Attach Files'):['View Channel'];
   if(missing.length){store.put(guild.id,'mod-log',{...row,state:'failed',missing});return;}
   // Screenshots not yet stored are re-uploaded: the original interaction's CDN links expire,
   // the copy in the mod log message is the durable record. Without Attach Files the entry
   // still posts, listing the original (expiring) links.
   const canAttach=!missingPermissions(ch,me).includes('Attach Files');
   const fresh=canAttach?proofItems(c).filter(p=>p.type==='image'&&!p.stored):[];
   const files=fresh.map(p=>({attachment:p.url,name:p.name}));
   const tag=client.users?.cache?.get?.(c.target)?.username,actorTag=client.users?.cache?.get?.(row.event?.action==='succeeded'?c.actor:row.event?.actor)?.username;
   sending=true;
   const sent=await read(ch.send({embeds:[modlogEmbed(c,row.event,{tag,actorTag,...(files.length?{image:`attachment://${files[0].name}`}:{})})],...(files.length?{files}:{}),allowedMentions:{parse:[]},nonce:row.id.slice(-25),enforceNonce:true}));
   if(!exists())return;
   store.put(guild.id,'mod-log',{...row,state:'sent',url:sent?.url||null});
   const latest=store.get(guild.id,'mod-case',c.id);let changed=false;
   if(sent?.url&&row.event?.action==='succeeded'&&!latest.logMessage){latest.logMessage=sent.url;changed=true;}
   if(fresh.length&&sent){
    const byName=new Map([...(sent.attachments?.values?.()||[])].map(a=>[a.name,a]));
    for(const p of proofItems(latest))if(p.type==='image'&&!p.stored&&fresh.some(f=>f.url===p.url)){const a=byName.get(p.name);p.stored=true;if(a?.url)p.storedUrl=a.url;if(sent.url)p.logMessage=sent.url;changed=true;}
   }
   if(changed)store.put(guild.id,'mod-case',latest);
  }catch(error){
   if(!exists())return;
   store.put(guild.id,'mod-log',{...row,state:sending?'uncertain':'queued'});
   console.warn(`Mod log delivery ${sending?'uncertain':'deferred'} (${error.status||error.code||error.name}); no automatic resend.`);
  }
 }
 const flushing=new Set();
 async function flush(guild){
  if(!guild||flushing.has(guild.id))return;flushing.add(guild.id);
  try{for(const row of store.list(guild.id,'mod-log').filter(r=>r.state==='queued').slice(0,10)){const c=store.get(guild.id,'mod-case',row.caseId);if(c)await log(guild,c,row);else store.remove(guild.id,'mod-log',row.id);}}
  finally{flushing.delete(guild.id);}
 }
 const flushSoon=guild=>void Promise.resolve().then(()=>flush(guild)).catch(()=>console.warn('Mod log flush failed.'));
 function caseOf(g,id){try{return core.get(g,id);}catch{return null;}}
 async function listPayload(i,kind,target,page,invoker,user){
  user??=client.users?.cache?.get(target);
  const member=i.guild?.members?.cache?.get?.(target);
  const info={id:target,name:clean(member?.displayName||user?.globalName||user?.username||'This member'),avatar:(member||user)?.displayAvatarURL?.()};
  const rows=core.cases(i.guildId).filter(c=>c.target===target);
  return caseListPayload({kind,user:info,rows,page,invoker});
 }
 function withProof(i){return i.proof?.length?{proof:i.proof}:{};}
 function dmWanted(i){const v=i.options.getBoolean?.('dm');return v??(core.config(i.guildId).dmMembers!==false);}
 function dmArgs(i,c,action,reason){return {action,guildName:i.guild.name,reason};}
 function recordDm(g,c,state){const latest=store.get(g,'mod-case',c.id);if(!latest)return c;latest.details={...latest.details,dm:state==='skipped'?'failed':state};return store.put(g,'mod-case',latest);}
 async function finish(i,c){
  if(!store.get(i.guildId,'mod-case',c.id))return respond(i,{content:'This case has been removed.',allowedMentions:{parse:[]}});
  const lastAction=c.events.at(-1)?.action;
  if(c.state!=='succeeded'&&!['note','proof','void'].includes(lastAction)){const unsure=['uncertain','pending'].includes(c.state);return respond(i,errorPayload(unsure?UNCERTAIN_ACTION:publicErrorMessage({code:c.error}),{title:unsure?'Result not confirmed':'Action failed',fields:c.number?[{name:'Case',value:`#${c.number}`,inline:true}]:[]}));}
  const member=i.guild.members.cache?.get(c.target);
  const name=clean(member?.displayName||member?.user?.username||c.details?.memberName||c.target);
  const result=lastAction==='proof'?'Images added.':lastAction==='void'?'Warning removed.':lastAction==='note'?'Case note saved.':({ban:`Banned ${name}.`,unban:`Unbanned ${name}.`,kick:`Kicked ${name}.`,warn:`Warning recorded for ${name}.`,timeout:`Timed out ${name}${c.details?.until?' until '+ts(c.details.until):''}.`,untimeout:`Removed ${name}’s timeout.`,purge:`Deleted ${c.details?.deleted??0} messages.`,'emergency-on':'Channel locked.','emergency-off':'Channel unlocked.',configure:'Moderation settings saved.'}[c.action]||'Case updated.');
  const last=c.events.at(-1);
  const dmNote=c.details?.dm==='failed'&&c.state==='succeeded'?'\nCould not DM the member. The moderation action was still completed.':'';
  const proofNote=i.proof?.some(p=>p.type==='image')&&!modlogConfig(store,i.guildId).enabled?'\nThe mod log is off, so screenshots are kept only as the original upload link, which Discord expires. Set up the mod log on the dashboard to store them.':'';
  flushSoon(i.guild);
  await respond(i,{content:result+dmNote+proofNote,embeds:[caseEmbed(c,{title:ACTION_TITLES[lastAction]||ACTION_TITLES[c.action],actor:last?.actor||c.actor,reason:last?.reason||c.reason})],allowedMentions:{parse:[]}});
 }
 function modlogLine(g){const m=modlogConfig(store,g);return `Mod log: ${m.enabled?`<#${m.channel}> (${enabledList(m)})`:'Off'}`;}
 // Read-only summary for /settings view. Moderation settings are edited on the dashboard.
 function settingsSummary(guildId){
  const cfg=core.config(guildId);
  const logIssues=store.list(guildId,'mod-log').filter(l=>l.v===2&&['failed','uncertain'].includes(l.state)).length;
  const review=core.cases(guildId).filter(c=>['pending','uncertain'].includes(c.state)).length;
  return [`Moderator role: ${cfg.modRole?'<@&'+cfg.modRole+'>':'Not set'}`,`Protected role: ${cfg.privacyRole?'<@&'+cfg.privacyRole+'>':'Not set'}`,modlogLine(guildId),`Automod: ${cfg.automod?'On':'Off'} · Invite filter: ${cfg.blockInvites?'On':'Off'}`,`DM members by default: ${cfg.dmMembers===false?'Off':'On'}`,`Case retention: ${cfg.retentionDays} days`,...(logIssues?['Some mod log entries weren’t posted. Check the mod log channel’s permissions on the dashboard.']:[]),...(review?[`${review} moderation ${review===1?'case needs':'cases need'} review.`]:[])].join('\n');
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
    must(!lock,'A saved lock already exists. Use /lockdown channel with locked:false to restore it first.');
    const overwrites=[...channel.permissionOverwrites.cache.values()].map(o=>({id:o.id,type:o.type,allow:String(o.allow.bitfield),deny:String(o.deny.bitfield)}));
    if(!overwrites.some(o=>o.id===i.guildId))overwrites.push({id:i.guildId,type:0,allow:'0',deny:'0',added:true});
    lock={id:channel.id,state:'applying',entries:overwrites,created:Date.now()};store.put(i.guildId,'mod-lock',lock);
   }else must(lock,'No saved lockdown exists for this channel.');
   const c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:'channel:'+channel.id,action:'emergency-'+sub,reason:i.options.getString('reason')||'No reason provided',details:withProof(i),effect:async({assertActive})=>{
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
 async function handle(i){
  const ours=moderationCommands.some(c=>c.name===i.commandName)||i.customId?.startsWith('modpage:');if(!ours)return false;
  i.privateResponse=false;
  if(i.customId?.startsWith('modpage:')){
   const [,kind,target,page,invoker]=i.customId.split(':');
   needStaff(i);
   must(kind==='history','Open /case user to view this member’s moderation history.');
   must(commandPluginEnabled(store,i.guildId,'case'),'This feature is turned off for this server. A server manager can turn it on in the dashboard.');
   const {actor}=interactionMembers(i);allowed(i,actor);
   const grant=store.get(i.guildId,'access',i.user.id);
   must(owner(i)||has(actor,P.Administrator)||has(actor,P.ManageGuild)||grant?.grantedBy&&grant.grantedBy===i.guild.ownerId,'Your command access has expired. Ask the current owner.');
   await updateResponse(i,await listPayload(i,'history',target,Number(page),invoker));return true;
  }
  needStaff(i);
  // Validate proof before any preflight or mutation so bad uploads fail immediately and publicly.
  i.proof=readProof(i);
  const nested=i.options.getSubcommand(false);
  if(['case','unwarn','lockdown'].includes(i.commandName))must(!nested,'This command has changed. Choose one of its current options, or use /help.');
  const routeAction=moderationAction(i.commandName,nested,i.options,i.proof.length>0);
  if(i.commandName==='case'){
   const number=i.options.getInteger('number'),user=i.options.getUser('user');
   must(number!=null||user,'Choose a member to view history, or enter a case number from their history.');
   must(number!=null||!i.options.getString('reason')&&!i.options.getString('outcome')&&!i.proof.length,'Enter the case number from history before adding a note, image, or outcome.');
   if(routeAction==='reconcile')must(i.options.getString('reason')?.trim(),'Add a reason explaining the result you checked in Discord.');
  }
  if(i.commandName==='lockdown'){
   const channel=i.options.getChannel('channel'),locked=i.options.getBoolean('locked');
   must(Boolean(channel)===(locked!=null),'Choose a channel and set locked to true or false, or omit both to view status.');
   must(locked!=null||!i.proof.length&&!i.options.getString('reason'),'Choose a channel and set locked before adding a reason or image.');
  }
  const local=['warn','case','history','note','void','reconcile'].includes(routeAction)||i.commandName==='lockdown'&&routeAction==='status';
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
  // Explicit grants are bound to the current owner, as in dashboard Access.
  const grant=store.get(i.guildId,'access',i.user.id);
  must(owner(i)||has(actor,P.Administrator)||has(actor,P.ManageGuild)||grant?.grantedBy&&grant.grantedBy===i.guild.ownerId,'Your command access has expired. Ask the current owner.');
  const sub=routeAction;
  if(i.commandName==='lockdown'){await emergency(i,sub,actor,bot);return true;}
  allowed(i,actor,({ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub])||P.ModerateMembers);
  if(i.commandName==='case'&&i.options.getInteger('number')!=null&&i.options.getUser('user'))must(core.getNumber(i.guildId,i.options.getInteger('number')).target===i.options.getUser('user').id,'That case does not belong to this member. Check their history with /case user.');
  if(sub==='warn'){
   const target=i.options.getMember?.('user');
   must(completeMember(i,bot)&&completeMember(i,target),'Member role details are unavailable.');
   targetSafe(i,actor,bot,target);
   const reason=i.options.getString('reason');must(reason?.trim(),'Enter a reason for the warning.');
   // Warn stays a single initial response (no deferral), so its DM gets a short bound.
   const send=dmWanted(i);
   let c=await core.run({guild:i.guildId,id:i.id,actor:i.user.id,target:target.id,action:'warn',reason,details:{...withProof(i),memberName:clean(target.displayName||target.user.username||target.id),dm:send?undefined:'disabled'}});
   if(c.state==='succeeded'&&send&&!c.details.dm)c=recordDm(i.guildId,c,await notifyMember(target,{...dmArgs(i,c,'warn',reason),deadline:1500}));
   await finish(i,c);return true;
  }
  if(sub==='case'){const c=core.getNumber(i.guildId,i.options.getInteger('number'));await respond(i,{embeds:[caseEmbedFull(c)],allowedMentions:{parse:[]}});return true;}
  if(sub==='history'){
   const u=i.options.getUser('user');
   await respond(i,await listPayload(i,sub,u.id,i.options.getInteger('page')||1,i.user.id,u));return true;
  }
  if(['note','void','reconcile'].includes(sub)){
   let c=core.getNumber(i.guildId,i.options.getInteger(sub==='void'?'warning':'number'));
   const reason=i.options.getString('reason')||(sub==='void'?'Removed by moderator':'Images or message links added');
   if(sub==='void')must(c.target===i.options.getUser('user')?.id,'That warning does not belong to this member. Check their history with /case user.');
   if(sub==='reconcile'){
    must(owner(i),'Only the current owner can reconcile uncertain actions after checking Discord.');
    c=store.transaction(()=>{const resolved=core.reconcile(i.guildId,c.id,i.user.id,i.options.getString('outcome'),reason);if(i.proof.length){addProof(resolved,i.proof);core.append(i.guildId,resolved,'proof',i.user.id,reason);}return resolved;});
    flushSoon(i.guild);
    await respond(i,{content:`Case marked as ${c.state==='succeeded'?'completed':'not completed'}. The action was not repeated.`,embeds:[caseEmbedFull(c)],allowedMentions:{parse:[]}});return true;
   }
   else{
    if(sub==='void'){
     must(c.action==='warn'&&c.state==='succeeded'&&!c.voided,'Only active successful warnings can be voided.');
     core.erase(i.guildId,c.id);
     await respond(i,{embeds:[{color:COLOR,title:'Warning removed',description:'The warning was permanently deleted.',...(i.options.getString('reason')?{fields:[{name:'Reason',value:clean(reason)}]}:{})}],allowedMentions:{parse:[]}});return true;
    }
    if(i.proof.length)addProof(c,i.proof);core.append(i.guildId,c,sub,i.user.id,reason);
   }
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
     const minutes=durationMinutes(i.options.getString('duration'));details.until=Date.now()+minutes*60000;details.duration=minutes*60000;effect=()=>member.timeout(minutes*60000,audit);
    }
    if(sub==='untimeout')effect=()=>member.timeout(null,audit);
   }
  }
  // Recheck after channel/message/ban preflight, before reserving a mutation.
  const fresh=await members(i),grantNow=store.get(i.guildId,'access',i.user.id);
  must(owner(i)||has(fresh.actor,P.Administrator)||has(fresh.actor,P.ManageGuild)||grantNow?.grantedBy&&grantNow.grantedBy===i.guild.ownerId,'Command access was removed during preflight.');
  const required={ban:P.BanMembers,unban:P.BanMembers,kick:P.KickMembers,purge:P.ManageMessages}[sub]||P.ModerateMembers;
  allowed(i,fresh.actor,required);must(has(fresh.bot,required),'The bot lost the required Discord permission.');
  if(selectedMember){const live=await read(i.guild.members.fetch({user:target,force:true}));targetSafe(i,fresh.actor,fresh.bot,live);}
  // Banned/kicked members can no longer receive a DM, so notify first (bounded, best effort).
  // dm:false (or the server default) sends no notice.
  const send=DM_TEXT[sub]&&dmWanted(i);if(DM_TEXT[sub]&&!send)details.dm='disabled';
  const caseNumber=core.reserveNumber(i.guildId,i.id);
  const args={...dmArgs(i,{id:i.id,number:caseNumber},sub,reason),until:details.until};
  if(send&&['ban','kick','timeout'].includes(sub)&&selectedMember&&!core.store.get(i.guildId,'mod-case',i.id))details.dm=await notifyMember(selectedMember,args);
  Object.assign(details,withProof(i));
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
  try{core.sweep();for(const guild of client.guilds?.cache?.values()||[])await flush(guild);}finally{ticking=false;}
 }
 // Actions taken outside the bot (Discord's own ban/kick/timeout UI or another bot) arrive as
 // audit log entries. Discord sends these only when the bot has View Audit Log; without it
 // nothing arrives and nothing is logged (the dashboard shows the missing permission).
 // The bot's own actions are skipped: they already have cases.
 async function onAuditEntry(entry,guild){
  try{
   if(!guild||!entry||!entry.executorId||entry.executorId===client.user?.id)return;
   const m=modlogConfig(store,guild.id);if(!m.enabled||m.events.external===false)return;
   let action,details={external:true};
   if(entry.action===AuditLogEvent.MemberBanAdd)action='ban';
   else if(entry.action===AuditLogEvent.MemberBanRemove)action='unban';
   else if(entry.action===AuditLogEvent.MemberKick)action='kick';
   else if(entry.action===AuditLogEvent.MemberUpdate){
    const ch=(entry.changes||[]).find(x=>x.key==='communication_disabled_until');if(!ch)return;
    const until=ch.new?Date.parse(ch.new):NaN;
    if(Number.isFinite(until)&&until>Date.now()){action='timeout';details.until=until;details.duration=Math.max(60000,Math.round((until-Date.now())/60000)*60000);}else action='untimeout';
   }else return;
   if(!entry.targetId||store.get(guild.id,'mod-case','audit-'+entry.id))return;
   const user=entry.target?.username?entry.target:client.users?.cache?.get?.(entry.targetId);
   if(user?.username)details.memberName=clean(user.globalName||user.username);
   await core.run({guild:guild.id,id:'audit-'+entry.id,actor:entry.executorId,target:entry.targetId,action,reason:entry.reason||'No reason provided',details});
   await flush(guild);
  }catch(error){console.warn(`Audit log capture skipped (${error.code||error.name}).`);}
 }
 client.on('guildAuditLogEntryCreate',onAuditEntry);
 client.on('messageCreate',onMessage);
 const onUpdate=(_old,m)=>{if(!m.partial)void onMessage(m);};
 client.on('messageUpdate',onUpdate);
 const timer=setInterval(()=>void tick().catch(()=>console.warn('Moderation maintenance failed. Check private storage.')),30000);timer.unref();
 return {handle,core,settingsSummary,onMessage,onAuditEntry,flush,tick,stop(){stopped=true;clearInterval(timer);client.off?.('messageCreate',onMessage);client.off?.('messageUpdate',onUpdate);client.off?.('guildAuditLogEntryCreate',onAuditEntry);}};
}
