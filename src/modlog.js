// Mod Log: a Dyno/MEE6-style record channel. Every completed moderation action posts one
// blurple "Case #N | Action" embed. Settings live in the 'modlog' record (shared by /modlogs
// and the dashboard). This is a new feature: it starts unset per server and never reuses the
// retired moderation `logChannel` setting. Entries queued before this feature (rows without
// v:2) are never posted, so old cases are not backfilled into the new channel.
import {PermissionFlagsBits as P} from 'discord.js';
import {proofSummary} from './mod-proof.js';
export const BLURPLE=0x5865F2;
export const MODLOG_EVENTS=Object.freeze([
 ['ban','Bans'],['unban','Unbans'],['kick','Kicks'],['warn','Warnings'],['void','Warnings removed'],['timeout','Timeouts'],['untimeout','Timeouts removed'],
 ['purge','Purges'],['lockdown','Lockdown on/off'],['update','Case updates (reason, images, outcome)'],['external','Actions taken outside the bot (bans, unbans, kicks, timeouts)'],
]);
export const EVENT_KEYS=MODLOG_EVENTS.map(e=>e[0]);
export const MODLOG_PERMISSIONS=[['View Channel',P.ViewChannel],['Send Messages',P.SendMessages],['Embed Links',P.EmbedLinks],['Attach Files',P.AttachFiles]];
const allOn=()=>Object.fromEntries(EVENT_KEYS.map(k=>[k,true]));
export function modlogConfig(store,g){
 const s=store.get(g,'modlog','main')||{};
 return {channel:s.channel||null,enabled:!!(s.enabled&&s.channel),events:{...allOn(),...(s.events||{})},updatedBy:s.updatedBy||null,updatedAt:s.updatedAt||null};
}
export function saveModlog(store,g,patch,actor){
 const cur=modlogConfig(store,g);
 const next={...cur,...patch,events:{...cur.events,...(patch.events||{})},id:'main',updatedBy:actor||cur.updatedBy,updatedAt:Date.now()};
 next.enabled=!!(next.enabled&&next.channel);
 store.put(g,'modlog',next);return modlogConfig(store,g);
}
/** Bot permissions missing in a channel, as display names. */
export function missingPermissions(ch,me){
 const perms=ch?.permissionsFor?.(me);
 return MODLOG_PERMISSIONS.filter(([,bit])=>!perms?.has?.(bit)).map(([name])=>name);
}
const ACTION={ban:'Ban',unban:'Unban',kick:'Kick',warn:'Warn',timeout:'Timeout',untimeout:'Untimeout',purge:'Purge','emergency-on':'Lockdown','emergency-off':'Unlock'};
/** Which toggle covers a case event, or null if the event is never logged. */
export function eventKey(c,action){
 if(action==='succeeded'){
  if(c.details?.external)return ACTION[c.action]?'external':null;
  if(c.action?.startsWith('emergency-'))return 'lockdown';
  return ACTION[c.action]?c.action:null;
 }
 if(action==='void')return 'void';
 if(['note','proof'].includes(action)||String(action).startsWith('reconciled:'))return 'update';
 return null;
}
const mention=id=>/^\d{15,25}$/.test(String(id))?`<@${id}>`:'Unknown';
const cut=(s,n)=>{s=String(s??'').replace(/@(everyone|here)/g,'@\u200b$1');return s.length>n?s.slice(0,n-1)+'…':s;};
const DM={sent:'Sent',failed:'Failed (DMs closed)',skipped:'Failed (DMs closed)',disabled:'Not sent'};
const fmtDuration=ms=>{const m=Math.round(ms/60000);if(m%10080===0)return `${m/10080}w`;if(m%1440===0)return `${m/1440}d`;if(m%60===0)return `${m/60}h`;return `${m}m`;};
const UPDATE={note:'Reason updated',proof:'Images added',void:'Warning removed','appeal:accepted':'Appeal accepted','appeal:denied':'Appeal denied','reconciled:succeeded':'Resolved as completed','reconciled:failed':'Resolved as not completed'};
/** The mod log embed. `event` is the case event being logged; `tag` the target's username if known. */
export function modlogEmbed(c,event,{tag,actorTag,image}={}){
 const f=(name,value,inline=true)=>({name,value:cut(value,1024),inline});
 const isAction=!event||event.action==='succeeded';
 const name=ACTION[c.action]||'Case';
 const num=c.number?`Case #${c.number}`:'Case';
 const title=isAction?`${num} | ${name}`:event.action==='void'?`${num} | Warning removed`:`${num} updated`;
 const fields=[];
 if(c.target?.startsWith?.('channel:'))fields.push(f('Channel',`<#${c.target.slice(8)}>`));
 else if(c.target?.startsWith?.('purge:'))fields.push(f('Channel',`<#${c.target.slice(6)}>`),f('Messages',String(c.details?.deleted??0)));
 else fields.push(f('User',`${mention(c.target)}${tag?` (${cut(tag,60)})`:c.details?.memberName?` (${cut(c.details.memberName,60)})`:''}`));
 const actor=isAction?c.actor:event.actor;
 fields.push(f('Moderator',`${mention(actor)}${actorTag?` (${cut(actorTag,60)})`:''}`));
 if(!isAction)fields.push(f('Update',UPDATE[event.action]||'Case updated'));
 if(c.details?.until&&(c.action==='timeout'))fields.push(f('Duration',`${c.details.duration?fmtDuration(c.details.duration):'—'} (ends <t:${Math.floor(c.details.until/1000)}:R>)`));
 if(isAction&&DM[c.details?.dm])fields.push(f('DM',DM[c.details.dm]));
 fields.push(f('Reason',cut((isAction?c.reason:event.reason)||'No reason provided',1000),false));
 if(!isAction&&c.reason&&event.action!=='note')fields.push(f('Original reason',cut(c.reason,500),false));
 const proof=proofSummary(c);if(proof)fields.push(f('Attachments',proof,false));
 if(c.details?.external)fields.push(f('Source','Done outside the bot (from the audit log)',false));
 const at=isAction?c.created:event.at;
 const target=/^\d{15,25}$/.test(String(c.target))?`User ID: ${c.target}`:'Moderation record';
 return {color:BLURPLE,title,fields,footer:{text:target},timestamp:new Date(at||Date.now()).toISOString(),...(image?{image:{url:image}}:{})};
}
export function enabledEmbed(cfg,actor){
 return {color:BLURPLE,title:'Mod log enabled',description:`Moderation actions in this server will be recorded here.`,fields:[{name:'Set by',value:mention(actor),inline:true},{name:'Events',value:enabledList(cfg),inline:false}],timestamp:new Date().toISOString()};
}
export const enabledList=cfg=>{const on=MODLOG_EVENTS.filter(([k])=>cfg.events[k]!==false).map(([,l])=>l);return on.length===MODLOG_EVENTS.length?'All moderation actions':on.length?on.join(', '):'None';};
