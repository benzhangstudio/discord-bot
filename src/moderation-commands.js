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
 {name:'ban',description:'Ban a member from the server',options:[user,optionalReason,dm]},
 {name:'unban',description:'Remove a member’s ban',options:[user,optionalReason,dm]},
 {name:'kick',description:'Kick a member from the server',options:[user,optionalReason,dm]},
 {name:'warn',description:'Warn a member',options:[user,reason,dm]},
 ...['timeout','mute'].map(name=>({name,description:'Time out a member',options:[user,text('duration','Duration, e.g. 10m, 1h, 1d (max 28d)'),optionalReason,dm]})),
 ...['untimeout','unmute'].map(name=>({name,description:'Remove a member’s timeout',options:[user,optionalReason,dm]})),
 {name:'purge',description:'Delete recent messages from this channel',options:[number('count','Number of messages (1–100); pinned messages are skipped',1,100),{...user,required:false,description:'Only delete messages from this member'},optionalReason]},
 {name:'warnings',description:'View a member’s warnings',options:[user,number('page','Page number',1,10000,false)]},
 {name:'modlogs',description:'View a member’s moderation history',options:[user,number('page','Page number',1,10000,false)]},
 {name:'case',description:'View a moderation case',options:[{...id,name:'id'}]},
 {name:'reason',description:'Add a reason or note to a moderation case',options:[id,reason]},
 {name:'delwarn',description:'Remove a warning',options:[id,optionalReason]},
 {name:'mod-reconcile',description:'Resolve an unconfirmed moderation action (owner only)',options:[id,choice('outcome','Result seen in Discord',[['Completed','succeeded'],['Not completed','failed']]),reason]},
 {name:'mod-settings',description:'View or change moderation settings',options:[
  sub('view','View moderation settings'),
  sub('set','Change moderation settings (owner only)',[
   {type:8,name:'mod-role',description:'Role allowed to use moderation commands'},
   {type:8,name:'privacy-role',description:'Role protected from moderation'},
   {...channel,name:'log-channel',required:false},
   number('retention-days','Days to keep cases (30–3650)',30,3650,false),
   {type:5,name:'automod',description:'Turn automod on or off'},
   {...text('blocked-words','Comma-separated words to delete; leave empty to clear',false),max_length:1000},
   number('mention-limit','Maximum mentions per message',1,50,false),
   number('spam-limit','Maximum messages per member in 10 seconds',3,30,false),
   {type:5,name:'block-invites',description:'Delete Discord invite links'},
   {type:5,name:'dm-members',description:'Default for the dm option on moderation commands'},
   {type:5,name:'dm-appeals',description:'Include an Appeal button in ban, kick, timeout and warning DMs'},
   {...text('appeal-contact','Where banned or kicked members can appeal (link or email); "none" clears',false),max_length:200},
  ]),sub('clear-role','Clear a moderation role setting (owner only)',[choice('kind','Role setting',[['Moderator role','modRole'],['Protected role','privacyRole']])]),
 ]},
 {name:'appeals',description:'Manage moderation appeals',options:[
  sub('panel','Post an appeal button for members still in the server',[channel]),
  sub('record','Record an appeal received outside Discord (staff)',[user,id,text('statement','Appeal text')]),
  sub('list','List open appeals',[number('page','Page number',1,10000,false)]),sub('show','Show an appeal',[text('appeal','Appeal ID')]),
  sub('review','Accept or deny an appeal (does not change the sanction)',[text('appeal','Appeal ID'),choice('decision','Decision',[['Accept','accepted'],['Deny','denied']]),reason]),
 ]},
 {name:'emergency',description:'Lock and unlock channels',options:[
  sub('on','Lock a channel',[channel,reason]),
  sub('off','Unlock a channel',[channel,reason]),
  sub('status','Show locked channels'),
 ]},
].map(c=>({...c,type:1,default_member_permissions:null,contexts:[0],integration_types:[0]}));

export const moderationActions={ban:'ban',unban:'unban',kick:'kick',warn:'warn',timeout:'timeout',mute:'timeout',untimeout:'untimeout',unmute:'untimeout',purge:'purge',warnings:'warnings',modlogs:'history',case:'case',reason:'note',delwarn:'void','mod-reconcile':'reconcile'};
