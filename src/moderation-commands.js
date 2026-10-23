import {proofOptions as proof} from './mod-proof.js';
const text=(name,description,required=true)=>({type:3,name,description,required,max_length:500,...(name==='appeal'?{autocomplete:true}:{})});
const user={type:6,name:'user',description:'Member',required:true};
const reason=text('reason','Reason for this action');
const optionalReason={...reason,required:false};
const dm={type:5,name:'dm',description:'Send the member a DM (default: on)'};
const id={...text('case','Case ID (search by member or action)'),autocomplete:true};
const sub=(name,description,options=[])=>({type:1,name,description,options});
const channel={type:7,name:'channel',description:'Text channel in this server',required:true,channel_types:[0,5]};
const number=(name,description,min,max,required=true)=>({type:4,name,description,min_value:min,max_value:max,required});
const choice=(name,description,values)=>({...text(name,description),choices:values.map(v=>Array.isArray(v)?{name:v[0],value:v[1]}:{name:v,value:v})});
export const moderationCommands=[
 {name:'ban',description:'Ban a member from the server',options:[user,optionalReason,dm,...proof]},
 {name:'unban',description:'Remove a member’s ban',options:[user,optionalReason,dm,...proof]},
 {name:'kick',description:'Kick a member from the server',options:[user,optionalReason,dm,...proof]},
 {name:'warn',description:'Warn a member',options:[user,reason,dm,...proof]},
 {name:'timeout',description:'Time out a member',options:[user,text('duration','Duration, e.g. 10m, 1h, 1d (max 28d)'),optionalReason,dm,...proof]},
 {name:'untimeout',description:'Remove a member’s timeout',options:[user,optionalReason,dm,...proof]},
 {name:'purge',description:'Delete recent messages from this channel',options:[number('count','Number of messages (1–100); pinned messages are skipped',1,100),{...user,required:false,description:'Only delete messages from this member'},optionalReason,...proof]},
 {name:'warnings',description:'View or remove a member’s warnings',options:[
  sub('list','View a member’s active warnings',[user,number('page','Page number',1,10000,false)]),
  sub('remove','Remove a warning',[id,optionalReason,...proof]),
 ]},
 {name:'case',description:'View and update moderation cases',options:[
  sub('view','View a moderation case',[{...id,name:'id'}]),
  sub('history','View a member’s moderation history',[user,number('page','Page number',1,10000,false)]),
  sub('reason','Add a reason or note to a case',[id,reason,...proof]),
  sub('proof','Add screenshots or message links to a case',[id,...proof]),
  sub('resolve','Resolve an unconfirmed action (owner only)',[id,choice('outcome','Result seen in Discord',[['Completed','succeeded'],['Not completed','failed']]),reason]),
 ]},
 {name:'appeals',description:'Manage moderation appeals',options:[
  sub('panel','Post an appeal button for members still in the server',[channel]),
  sub('record','Record an appeal received outside Discord (staff)',[user,id,text('statement','Appeal text')]),
  sub('list','List open appeals',[number('page','Page number',1,10000,false)]),sub('show','Show an appeal',[text('appeal','Appeal ID')]),
  sub('review','Accept or deny an appeal (does not change the sanction)',[text('appeal','Appeal ID'),choice('decision','Decision',[['Accept','accepted'],['Deny','denied']]),reason]),
 ]},
 {name:'lockdown',description:'Lock and unlock channels',options:[
  sub('on','Lock a channel',[channel,reason,...proof]),
  sub('off','Unlock a channel',[channel,reason,...proof]),
  sub('status','Show locked channels'),
 ]},
].map(c=>({...c,type:1,default_member_permissions:null,contexts:[0],integration_types:[0]}));

// Internal action keys. Grouped commands resolve by subcommand, e.g. /case reason -> note.
export const moderationActions={ban:'ban',unban:'unban',kick:'kick',warn:'warn',timeout:'timeout',untimeout:'untimeout',purge:'purge',
 'warnings list':'warnings','warnings remove':'void','case view':'case','case history':'history','case reason':'note','case resolve':'reconcile','case proof':'proof'};
export const moderationAction=(name,sub)=>moderationActions[name]||moderationActions[name+' '+sub]||sub;
