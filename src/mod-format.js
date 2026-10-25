// Dyno-style embeds for moderation lists and case details. Mentions and Discord
// timestamps only: no raw snowflakes or ISO strings in member-facing output.
import {proofItems,proofSummary,firstImage,imageUrl} from './mod-proof.js';
export const BLURPLE=0x5865F2;
export const PAGE_SIZE=10;
const NAMES={ban:'Ban',unban:'Unban',kick:'Kick',warn:'Warn',timeout:'Timeout',untimeout:'Timeout removed',purge:'Purge','emergency-on':'Lockdown','emergency-off':'Unlock',configure:'Settings change','automod-delete':'Automod','appeal-panel':'Appeal panel'};
export const actionName=a=>NAMES[a]||String(a||'Action').replace(/(^|-)(\w)/g,(_,s,ch)=>(s?' ':'')+ch.toUpperCase());
export const ts=(ms,style='f')=>Number.isFinite(ms)?`<t:${Math.floor(ms/1000)}:${style}>`:'Unknown';
const cut=(s,n=300)=>{s=String(s??'').replace(/@(everyone|here)/g,'@\u200b$1');return s.length>n?s.slice(0,n-1)+'…':s;};
export const caseRef=c=>c?.number?`Case #${c.number}`:'Case';
const mention=id=>/^\d{15,22}$/.test(String(id||''))?`<@${id}>`:cut(id||'Unknown',80);
const STATE={pending:'Pending',uncertain:'Needs checking',failed:'Failed',succeeded:'Completed'};
export const statusOf=c=>c.voided?'Removed':STATE[c.state]||cut(c.state,40);

export function entryField(c){
 const lines=[`**Reason:** ${cut(c.reason||'No reason provided',200)}`,`**Moderator:** ${mention(c.actor)}`,`**Date:** ${ts(c.created)} (${ts(c.created,'R')})`];
 if(c.details?.until)lines.push(`**Until:** ${ts(c.details.until)}`);
 const proof=proofItems(c);if(proof.length){let n=0,l=0;lines.push(`**Attachments:** ${proof.slice(0,4).map(p=>p.type==='image'?`[Screenshot ${++n}](${imageUrl(p)})`:`[Link ${++l}](${p.url})`).join(' · ')}${proof.length>4?` +${proof.length-4} more`:''}`);}
 if(c.voided||c.state!=='succeeded')lines.push(`**Status:** ${statusOf(c)}`);
 return {name:`${caseRef(c)} · ${actionName(c.action)}`,value:lines.join('\n').slice(0,1024)};
}
const pages=n=>Math.max(1,Math.ceil(n/PAGE_SIZE));
export const clampPage=(p,n)=>Math.min(Math.max(1,Number(p)||1),pages(n));

// Moderation history; user: {id,name,avatar}
export function caseListPayload({kind,user,rows,page=1,invoker}){
 const noun='case',plural=n=>`${n} ${noun}${n===1?'':'s'}`;
 const name=cut(user.name||'This member',80);
 if(!rows.length)return {embeds:[{color:BLURPLE,description:`${name} has no moderation history.`}],components:[],allowedMentions:{parse:[]}};
 page=clampPage(page,rows.length);
 const embed={color:BLURPLE,author:{name:`Moderation history for ${name}`,...(user.avatar?{icon_url:user.avatar}:{})},
  fields:rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(entryField),
  footer:{text:`Total: ${plural(rows.length)}${pages(rows.length)>1?` · Page ${page} of ${pages(rows.length)}`:''}`}};
 return {embeds:[embed],components:pager(`modpage:${kind}:${user.id}`,page,pages(rows.length),invoker),allowedMentions:{parse:[]}};
}
export function pager(prefix,page,total,invoker){
 if(total<=1)return [];
 return [{type:1,components:[
  {type:2,style:2,label:'Previous',custom_id:`${prefix}:${page-1}:${invoker}`,disabled:page<=1},
  {type:2,style:2,label:'Next',custom_id:`${prefix}:${page+1}:${invoker}`,disabled:page>=total}]}];
}
export function caseEmbedFull(c){
 const f=(name,value,inline=true)=>({name,value:String(value).slice(0,1024),inline});
 const fields=[f('User',mention(c.target)),f('Moderator',mention(c.actor)),f('Action',actionName(c.action)),
  f('Reason',cut(c.reason||'No reason provided',1000),false),f('Status',statusOf(c)),f('Date',ts(c.created))];
 if(c.details?.until)fields.push(f('Until',ts(c.details.until)));
 const proof=proofSummary(c);if(proof)fields.push(f('Attachments',proof,false));
 if(/^https:\/\/discord\.com\/channels\//.test(String(c.logMessage||'')))fields.push(f('Mod log',`[Jump to log entry](${c.logMessage})`));
 const recent=(c.events||[]).slice(1).slice(-5);
 if(recent.length)fields.push(f('Updates',recent.map(e=>`${ts(e.at,'R')} ${({proof:'Images added',void:'Warning removed',note:'Note added','reconciled:succeeded':'Marked completed','reconciled:failed':'Marked not completed'}[e.action]||'Updated')}: ${cut(e.reason,120)}`).join('\n'),false));
 const img=firstImage(c);
 return {color:BLURPLE,title:`${caseRef(c)} · ${actionName(c.action)}`,fields,...(img?{image:{url:img}}:{})};
}
