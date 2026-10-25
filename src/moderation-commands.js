import {proofOptions as proof} from './mod-proof.js';
const text=(name,description,required=true)=>({type:3,name,description,required,max_length:500});
const user={type:6,name:'user',description:'Member',required:true};
const reason=text('reason','Reason for this action');
const optionalReason={...reason,required:false};
const dm={type:5,name:'dm',description:'Send the member a DM (default: on)'};
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
 {name:'unwarn',description:'Remove one warning from a member; find its number in /case',options:[user,number('warning','Warning number shown in this member’s case history, e.g. 12',1,999999999),optionalReason,...proof]},
 {name:'case',description:'View a member’s history, or view and update a numbered case',options:[
  {...user,required:false,description:'Member whose moderation history you want to view'},
  number('number','Case number shown in history, e.g. 12; leave blank to list history',1,999999999,false),
  number('page','History page (10 records per page)',1,10000,false),
  {...optionalReason,description:'Optional note to add to the numbered case'},...proof,
  {...choice('outcome','Owner only: result checked in Discord',[['Completed','succeeded'],['Not completed','failed']]),required:false},
 ]},
 {name:'lockdown',description:'View locked channels, or lock/unlock a channel',options:[
  {...channel,required:false},
  {type:5,name:'locked',description:'True to lock, false to unlock; omit both inputs to view status'},
  optionalReason,...proof,
 ]},
].map(c=>({...c,type:1,default_member_permissions:null,contexts:[0],integration_types:[0]}));

// Resolve the user's optional inputs without exposing internal action names.
export function moderationAction(name,sub,options,hasImages=false) {
 if(name==='unwarn')return 'void';
 if(name==='case') {
  if(options.getInteger('number')!=null){
   if(options.getString('outcome'))return 'reconcile';
   return options.getString('reason')||hasImages?'note':'case';
  }
  return 'history';
 }
 if(name==='lockdown')return options.getBoolean('locked')==null?'status':options.getBoolean('locked')?'on':'off';
 return name;
}
