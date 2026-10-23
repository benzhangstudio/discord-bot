// Dyno-style embeds for moderation lists and case details. Mentions and Discord
// timestamps only: no raw snowflakes or ISO strings in member-facing output.
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
 if(c.voided||c.state!=='succeeded')lines.push(`**Status:** ${statusOf(c)}`);
 return {name:`${caseRef(c)} · ${actionName(c.action)}`,value:lines.join('\n').slice(0,1024)};
}
const pages=n=>Math.max(1,Math.ceil(n/PAGE_SIZE));
export const clampPage=(p,n)=>Math.min(Math.max(1,Number(p)||1),pages(n));

// kind: 'warnings' | 'history'; user: {id,name,avatar}
export function caseListPayload({kind,user,rows,page=1,invoker}){
 const noun=kind==='warnings'?'warning':'case',plural=n=>`${n} ${noun}${n===1?'':'s'}`;
 const name=cut(user.name||'This member',80);
 if(!rows.length)return {embeds:[{color:BLURPLE,description:kind==='warnings'?`${name} has no warnings.`:`${name} has no moderation history.`}],components:[],allowedMentions:{parse:[]}};
 page=clampPage(page,rows.length);
 const embed={color:BLURPLE,author:{name:kind==='warnings'?`Warnings for ${name}`:`Moderation history for ${name}`,...(user.avatar?{icon_url:user.avatar}:{})},
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
const APPEAL_STATE={open:'Open',accepted:'Accepted',denied:'Denied'};
export function caseEmbedFull(c,appeal){
 const f=(name,value,inline=true)=>({name,value:String(value).slice(0,1024),inline});
 const fields=[f('User',mention(c.target)),f('Moderator',mention(c.actor)),f('Action',actionName(c.action)),
  f('Reason',cut(c.reason||'No reason provided',1000),false),f('Status',statusOf(c)),f('Date',ts(c.created))];
 if(c.details?.until)fields.push(f('Until',ts(c.details.until)));
 fields.push(f('Appeal',appeal?APPEAL_STATE[appeal.state]||appeal.state:'None'));
 const recent=(c.events||[]).slice(1).slice(-5);
 if(recent.length)fields.push(f('Updates',recent.map(e=>`${ts(e.at,'R')} ${cut(e.action,30)}: ${cut(e.reason,120)}`).join('\n'),false));
 return {color:BLURPLE,title:`${caseRef(c)} · ${actionName(c.action)}`,fields};
}
export function appealListPayload({rows,page=1,invoker,caseOf}){
 if(!rows.length)return {embeds:[{color:BLURPLE,description:'There are no open appeals.'}],components:[],allowedMentions:{parse:[]}};
 page=clampPage(page,rows.length);
 const fields=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(a=>{const c=caseOf(a.caseId);return {name:`Appeal for ${caseRef(c)}${c?' · '+actionName(c.action):''}`,
  value:[`**Member:** ${mention(a.actor)}`,`**Submitted:** ${ts(a.created)} (${ts(a.created,'R')})`,`**Appeal ID:** \`${cut(a.id,40)}\``].join('\n')};});
 return {embeds:[{color:BLURPLE,title:'Open appeals',fields,footer:{text:`Total: ${rows.length} open appeal${rows.length===1?'':'s'}${pages(rows.length)>1?` · Page ${page} of ${pages(rows.length)}`:''}`}}],
  components:pager('modpage:appeals:all',page,pages(rows.length),invoker),allowedMentions:{parse:[]}};
}
export function appealEmbed(a,c){
 const fields=[{name:'Member',value:mention(a.actor),inline:true},{name:'Case',value:c?`${caseRef(c)} · ${actionName(c.action)}`:'Unknown',inline:true},{name:'Status',value:APPEAL_STATE[a.state]||cut(a.state,30),inline:true},
  {name:'Submitted',value:ts(a.created),inline:true},{name:'Statement',value:cut(a.body||'—',1000)}];
 if(a.reviewer)fields.push({name:'Reviewed by',value:mention(a.reviewer),inline:true});
 if(a.reason)fields.push({name:'Decision note',value:cut(a.reason,1000)});
 return {color:BLURPLE,title:`Appeal for ${caseRef(c)}`,fields};
}
