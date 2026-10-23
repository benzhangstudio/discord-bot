import {reactionRoleCommand} from './reaction-role-commands.js';
import {moderationCommands} from './moderation-commands.js';
// Discord application command JSON.
const str = (name, description, required = false, extra = {}) => ({type:3,name,description,required,...extra});
const integer = (name, description, min, max) => ({type:4,name,description,min_value:min,max_value:max});
const channel = (required = false) => ({type:7,name:'channel',description:'Channel to post in',required,channel_types:[0,5]});
const id = () => str('id','Start typing to search',true,{autocomplete:true});
const sub = (name,description,options=[]) => ({type:1,name,description,options});
const labels={event:'Community event','staff-meeting':'Staff meeting',rotation:'Staff rotation',none:'One time only',daily:'Every day',weekly:'Every week'};
const choice = values => values.map(v => ({name:labels[v]||v,value:v}));
const role = {type:8,name:'role',description:'Optional role to notify'};
// Retired command names -> replacement. Startup sync replaces the global command set, so these
// disappear from Discord; clients that still show a cached copy get this guidance instead.
export const RETIRED_COMMANDS=Object.freeze({
  mute:'/timeout',unmute:'/untimeout',delwarn:'/warnings remove',modlogs:'/case history',reason:'/case reason',
  'mod-reconcile':'/case resolve','mod-settings':'the dashboard (Moderation, Automod) or /settings view',emergency:'/lockdown',portal:'/dashboard',events:'/schedule list'
});
export const commands = [
  ...moderationCommands,
  reactionRoleCommand,
  {name:'access',description:'Manage command access (server owner only)',options:[
    sub('add','Allow a member to use commands',[{type:6,name:'user',description:'Member',required:true}]),
    sub('remove','Remove a member’s command access',[{type:6,name:'user',description:'Member',required:true}]),
    sub('list','List members with command access',[integer('page','Page number',1,100)])
  ]},
  {name:'help',description:'Show available commands'},
  {name:'dashboard',description:'Get this server’s web dashboard link'},
  {name:'settings',description:'Server timezone and delivery status',default_member_permissions:'32',options:[
    sub('view','View server settings'),sub('timezone','Set the default timezone for new events',[str('zone','City or timezone, e.g. New York',true,{autocomplete:true})]),
    sub('status','Show reminder and feed delivery problems')
  ]},
  {name:'embed',description:'Create and send embed messages',options:[
    sub('create','Create a new embed',[str('name','Name for the saved embed, e.g. Welcome',true,{max_length:80})]),
    sub('edit','Edit a saved embed',[id()]),sub('list','List saved embeds'),sub('delete','Delete a saved embed (posted copies stay)',[id()]),
    sub('remove-section','Remove a section from an embed',[id(),{...integer('number','Section number, counting from the top',1,25),required:true}]),
    sub('send','Send a saved embed to a channel',[id(),channel(true),role,{type:6,name:'user',description:'Optional member to notify'}])
  ]},
  {name:'schedule',description:'Events, meetings, reminders and rotations',options:[
    sub('add','Create an event, meeting or rotation',[
      str('title','Event title',true,{max_length:150}),str('start','Start, as YYYY-MM-DD HH:mm (24-hour)',true),channel(true),
      str('kind','Event category',false,{choices:choice(['event','staff-meeting','rotation'])}),
      str('repeat','Repeat: once, daily or weekly',false,{choices:choice(['none','daily','weekly'])}),
      integer('duration','Duration in minutes (default 60)',1,10080),integer('reminder','Reminder minutes before start (default 30, 0 = at start)',0,10080),
      str('description','Event details',false,{max_length:2000}),str('location','Location or meeting link',false,{max_length:300}),
      str('zone','Timezone for this event, e.g. London',false,{autocomplete:true}),role,str('people','Rotation members, mentioned in turn order',false,{max_length:1000})
    ]),
    sub('list','List upcoming events',[integer('page','Page number',1,1000)]),
    sub('show','Show an event and its RSVPs',[id()]),sub('edit','Edit an event’s details or start time',[id()]),
    sub('post','Post an event card with RSVP buttons',[id()]),
    sub('configure','Change reminders, duration or repeat',[id(),str('repeat','Repeat',false,{choices:choice(['none','daily','weekly'])}),integer('duration','Duration in minutes',1,10080),integer('reminder','Reminder minutes before start (0 = at start)',0,10080)]),
    sub('cancel','Cancel an event and its reminders',[id()])
  ]},
  {name:'instagram',description:'Instagram feed roundups',options:[
    sub('setup','Add or change sources, channels and delivery times'),
    sub('list','List sources and queued posts'),sub('preview','Preview the latest post',[id()]),
    sub('pause','Pause a source',[id()]),sub('resume','Resume a paused source',[id()]),sub('remove','Remove a source (posted messages stay)',[id()])
  ]}
].map(c => ({...c,options:c.options?.map(sub=>({...sub,options:sub.options?.map(option=>option.name==='id'?{...option,name:{embed:'message',schedule:'event',instagram:'source'}[c.name]}:option)})),type:1,default_member_permissions:c.name==='access'?'32':null,contexts:[0],integration_types:[0]}));
