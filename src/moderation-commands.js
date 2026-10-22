const text=(name,description,required=true)=>({type:3,name,description,required,max_length:500,...(name==='appeal'?{autocomplete:true}:{})});
const user={type:6,name:'user',description:'Member to moderate',required:true};
const reason=text('reason','Reason shown in the moderation log');
const optionalReason={...reason,required:false};
const id={...text('case','Choose a case by member, action or ID'),autocomplete:true};
const sub=(name,description,options=[])=>({type:1,name,description,options});
const channel={type:7,name:'channel',description:'Text channel in this server',required:true,channel_types:[0,5]};
const number=(name,description,min,max,required=true)=>({type:4,name,description,min_value:min,max_value:max,required});
const choice=(name,description,values)=>({...text(name,description),choices:values.map(value=>({name:value,value}))});
export const moderationCommands=[
 {name:'ban',description:'Ban a member from the server',options:[user,optionalReason]},
 {name:'unban',description:'Remove a member’s ban',options:[user,optionalReason]},
 {name:'kick',description:'Kick a member from the server',options:[user,optionalReason]},
 {name:'warn',description:'Warn a member and record the reason',options:[user,reason]},
 ...['timeout','mute'].map(name=>({name,description:'Timeout a member for a set duration',options:[user,text('duration','How long? For example: 10m, 1h, 1d'),optionalReason]})),
 ...['untimeout','unmute'].map(name=>({name,description:'Remove a member’s timeout',options:[user,optionalReason]})),
 {name:'purge',description:'Delete recent messages from this channel',options:[number('count','How many messages? Pinned messages are skipped',1,100),{...user,required:false,description:'Only delete messages from this member'},optionalReason]},
 {name:'warnings',description:'View a member’s warnings',options:[user,number('page','Page number',1,10000,false)]},
 {name:'modlogs',description:'View a member’s moderation history',options:[user,number('page','Page number',1,10000,false)]},
 {name:'case',description:'View a moderation case',options:[{...id,name:'id'}]},
 {name:'reason',description:'Add a reason or note to a moderation case',options:[id,reason]},
 {name:'delwarn',description:'Remove a warning from a member’s active warnings',options:[id,optionalReason]},
 {name:'mod-reconcile',description:'Owner: resolve an uncertain action after checking Discord',options:[id,choice('outcome','What happened at Discord?',['succeeded','failed']),reason]},
 {name:'mod-settings',description:'Owner: moderation configuration and delivery health',options:[
  sub('view','View current policy and pending log deliveries'),
  sub('set','Owner: configure policy; settings are server scoped',[
   {type:8,name:'mod-role',description:'Optional moderation role'},
   {type:8,name:'privacy-role',description:'Protected privacy or verification role'},
   {...channel,name:'log-channel',required:false},
   number('retention-days','Case retention: 30 to 3650 days',30,3650,false),
   {type:5,name:'automod',description:'Enable message filters (requires Message Content intent)'},
   {...text('blocked-words','Comma separated literal words; empty clears',false),max_length:1000},
   number('mention-limit','Maximum user/role mentions',1,50,false),
   number('spam-limit','Messages per member per ten seconds',3,30,false),
   {type:5,name:'block-invites',description:'Delete Discord invite links'},
  ]),sub('clear-role','Owner: remove a configured role',[choice('kind','Role setting',['modRole','privacyRole'])]),
 ]},
 {name:'appeals',description:'Private moderation appeals and review',options:[
  sub('panel','Post a button that members can use to appeal',[channel]),
  sub('record','Record an appeal received from a banned or departed member',[user,id,text('statement','Member’s appeal statement')]),
  sub('list','List open appeals',[number('page','Page number',1,10000,false)]),sub('show','Read an appeal and its decision',[text('appeal','Appeal ID')]),
  sub('review','Decide an appeal; Discord sanctions are reversed separately',[text('appeal','Appeal ID'),choice('decision','Decision',['accepted','denied']),reason]),
 ]},
 {name:'emergency',description:'Critical Emergency Mode: reversible channel lockdown',options:[
  sub('on','Lock writing in one channel; repeat for additional channels',[channel,reason]),
  sub('off','Restore saved writing permissions in one channel',[channel,reason]),
  sub('status','Show active locks and uncertain operations'),
 ]},
].map(c=>({...c,type:1,default_member_permissions:null,contexts:[0],integration_types:[0]}));

export const moderationActions={ban:'ban',unban:'unban',kick:'kick',warn:'warn',timeout:'timeout',mute:'timeout',untimeout:'untimeout',unmute:'untimeout',purge:'purge',warnings:'warnings',modlogs:'history',case:'case',reason:'note',delwarn:'void','mod-reconcile':'reconcile'};
