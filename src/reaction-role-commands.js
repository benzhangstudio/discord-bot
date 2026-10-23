import {acknowledge,respond,step} from './responses.js';
import {durationLabel} from './reaction-roles.js';

const str=(name,description,required=false,extra={})=>({type:3,name,description,required,max_length:200,...extra});
const pick={...str('message','Reaction-role message (start typing to search)',true),autocomplete:true};
const settingsOptions=[
  str('title','Embed title',false,{max_length:256}),str('description','Text above the role list',false,{max_length:2000}),
  str('mode','Normal (pick any) or unique (pick one)',false,{choices:[{name:'Normal',value:'normal'},{name:'Unique (one role)',value:'unique'}]}),
  {type:4,name:'max-roles',description:'Most roles a member can pick here (0 = no limit)',min_value:0,max_value:20},
  str('duration','Temporary roles, e.g. 1h, 7d (off = permanent)',false,{max_length:10}),
  {type:8,name:'required-role',description:'Role members need before they can pick'},
  {type:5,name:'remove-on-unreact',description:'Remove the role when the reaction is removed (default on)'},
];
const firstPair=[str('emoji','First emoji, e.g. 🎮',false,{max_length:64}),{type:8,name:'role',description:'Role for the first emoji'}];
const sub=(name,description,options=[])=>({type:1,name,description,options});
const channel={type:7,name:'channel',description:'Text channel in this server',required:true,channel_types:[0,5]};
export const reactionRoleCommand={name:'reaction-roles',description:'Let members pick roles by reacting',options:[
  sub('create','Post a new reaction-role message',[channel,...firstPair,...settingsOptions]),
  sub('attach','Add reaction roles to an existing message',[channel,str('link','Message link or ID',true),...firstPair,...settingsOptions.filter(o=>!['title','description'].includes(o.name))]),
  sub('add','Add an emoji and role',[pick,{...firstPair[0],description:'Emoji, e.g. 🎮 or a server emoji',required:true},{...firstPair[1],description:'Role to give',required:true}]),
  sub('remove','Remove an emoji and its role',[pick,{...firstPair[0],description:'Emoji to remove',required:true}]),
  sub('edit','Change title, mode, limits or duration',[pick,...settingsOptions,{type:5,name:'clear-required-role',description:'Remove the required role'}]),
  sub('delete','Delete a reaction-role setup',[pick]),
  sub('list','List reaction-role messages'),
]};

export function describeGroup(g){
  const bits=[g.mode==='unique'?'Unique':'Normal',g.maxRoles?`max ${g.maxRoles}`:null,g.duration?`lasts ${durationLabel(g.duration)}`:null,g.removeOnUnreact===false?'add-only':null,g.requiredRole?`needs <@&${g.requiredRole}>`:null].filter(Boolean).join(' · ');
  return `**${g.title||'Reaction roles'}** · <#${g.channel}> · ${g.entries.length} role(s) · ${bits}${g.broken?' · Needs attention':''}`;
}
const link=(guild,g)=>`https://discord.com/channels/${guild}/${g.channel}/${g.message}`;

export function createReactionRoleCommands(rr){
  return async function handle(i){
    if(!i.isChatInputCommand?.()||i.commandName!=='reaction-roles')return false;
    const o=i.options,sub=o.getSubcommand(),reply=content=>respond(i,{content,allowedMentions:{parse:[]}});
    const settings=()=>({title:o.getString('title')??undefined,description:o.getString('description')??undefined,mode:o.getString('mode'),maxRoles:o.getInteger('max-roles'),duration:o.getString('duration'),
      requiredRole:o.getRole('required-role')?.id??(o.getBoolean?.('clear-required-role')?null:undefined),removeOnUnreact:o.getBoolean('remove-on-unreact')});
    if(sub==='list'){
      const all=rr.list(i.guildId);
      await reply(all.length?all.map(describeGroup).join('\n').slice(0,1900):'No reaction-role messages yet. Use /reaction-roles create to post one.');return true;
    }
    await acknowledge(i);
    if(sub==='create'||sub==='attach'){
      const emoji=o.getString('emoji'),role=o.getRole('role')?.id;
      const g=await step(i,rr.create(i.guild,{channel:o.getChannel('channel').id,message:sub==='attach'?o.getString('link'):null,entries:emoji&&role?[{emoji,role}]:[],...settings()},i.member));
      await reply(`Reaction roles ${sub==='attach'?'added to':'posted in'} <#${g.channel}>: ${link(i.guildId,g)}\n${g.entries.length?`${g.entries.length} role(s) set up.`:'No roles yet.'} Add more with /reaction-roles add.`);return true;
    }
    const id=o.getString('message');
    if(sub==='add'){const g=await step(i,rr.addEntry(i.guild,id,{emoji:o.getString('emoji'),role:o.getRole('role').id},i.member));const e=g.entries.at(-1);await reply(`Added ${e.display} → <@&${e.role}>. ${link(i.guildId,g)}`);return true;}
    if(sub==='remove'){const g=await step(i,rr.removeEntry(i.guild,id,o.getString('emoji')));await reply(`Emoji removed. ${g.entries.length} role(s) remain.`);return true;}
    if(sub==='edit'){const g=await step(i,rr.edit(i.guild,id,settings()));await reply(`Reaction roles updated.\n${describeGroup(g)}`);return true;}
    if(sub==='delete'){const g=await step(i,rr.remove(i.guild,id));await reply(g.owned?'Reaction roles deleted, and the bot’s message was removed. Members keep roles they already have.':'Reaction roles deleted. The original message stays; members keep roles they already have.');return true;}
    return false;
  };
}
