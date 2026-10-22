const text=(name,description,required=true)=>({type:3,name,description,required,max_length:500});
const user={type:6,name:'user',description:'Member to moderate',required:true};
const reason=text('reason','Reason recorded in the private case history');
const id=text('case','Case ID');
const sub=(name,description,options=[])=>({type:1,name,description,options});
const channel={type:7,name:'channel',description:'Text channel in this server',required:true,channel_types:[0,5]};
const number=(name,description,min,max,required=true)=>({type:4,name,description,min_value:min,max_value:max,required});
const choice=(name,description,values)=>({...text(name,description),choices:values.map(value=>({name:value,value}))});
export const moderationCommands=[
 {name:'mod',description:'Moderation actions and private case records',options:[
  ...['warn','kick','ban','unban','untimeout'].map(name=>sub(name,`${name}: record a reason and act`,[user,reason])),
  sub('timeout','Temporarily restrict communication (mute)',[user,number('minutes','Duration in minutes',1,40320),reason]),
  sub('purge','Delete up to 100 recent messages; confirm with yes',[number('count','Maximum recent messages',1,100),reason,choice('confirm','Confirm deletion',['yes'])]),
  sub('case','View a private case',[id]),sub('history','View recent cases for one member',[user,number('page','Page number',1,10000,false)]),
  sub('note','Append a staff note without replacing history',[id,reason]),sub('void','Void a warning; does not reverse Discord actions',[id,reason]),
  sub('reconcile','Owner: record verified outcome of an uncertain action',[id,choice('outcome','Inspect Discord first',['succeeded','failed']),reason]),
 ]},
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
