// Discord application command JSON. All entry points are slash commands.
const str = (name, description, required = false, extra = {}) => ({type:3,name,description,required,...extra});
const integer = (name, description, min, max) => ({type:4,name,description,min_value:min,max_value:max});
const channel = (required = false) => ({type:7,name:'channel',description:'Destination text or announcement channel',required,channel_types:[0,5]});
const id = () => str('id','Saved item ID',true);
const sub = (name,description,options=[]) => ({type:1,name,description,options});
const choice = values => values.map(v => ({name:v,value:v}));
const role = {type:8,name:'role',description:'Optional role to notify'};
export const commands = [
  {name:'help',description:'How to use Number One'},
  {name:'settings',description:'Configure this server’s Number One settings',default_member_permissions:'32',options:[
    sub('view','View settings'),sub('timezone','Set the default scheduling timezone',[str('zone','IANA timezone, for example America/New_York',true)]),
    sub('staff','Set an additional role allowed to manage Number One',[{...role,required:true}]),sub('clear-staff','Remove the additional staff role'),sub('status','Check delivery problems')
  ]},
  {name:'embed',description:'Build and publish rich embeds',options:[
    sub('create','Open a new embed builder',[str('name','Template name',true,{max_length:80})]),
    sub('edit','Open a saved embed',[id()]),sub('list','List saved embeds'),sub('delete','Delete a saved embed',[id()]),
    sub('remove-field','Remove one field from a saved embed',[id(),{...integer('number','Field number, starting at 1',1,25),required:true}]),
    sub('send','Publish a saved embed',[id(),channel(true),role,{type:6,name:'user',description:'Optional user to notify'}])
  ]},
  {name:'schedule',description:'Events, meetings, reminders, and staff rotations',options:[
    sub('add','Create an event or recurring rotation',[
      str('title','Event title',true,{max_length:150}),str('start','Local YYYY-MM-DDTHH:mm or ISO time with offset',true),channel(true),
      str('kind','Event category',false,{choices:choice(['event','staff-meeting','rotation'])}),
      str('repeat','Recurrence in the chosen timezone',false,{choices:choice(['none','daily','weekly'])}),
      integer('duration','Duration in minutes',1,10080),integer('reminder','Minutes before start; 0 means at start',0,10080),
      str('description','Event details',false,{max_length:2000}),str('location','Location or meeting link',false,{max_length:300}),
      str('zone','Override the server timezone'),role,str('assignees','Rotation: ordered user IDs or @mentions, separated by spaces',false,{max_length:1000})
    ]),
    sub('list','Browse upcoming events you can access',[integer('page','Page number',1,1000)]),
    sub('show','Show an event and RSVP buttons',[id()]),sub('edit','Edit an event’s details and time',[id()]),
    sub('post','Publish an event card and RSVP buttons in its channel',[id()]),
    sub('configure','Update recurrence and reminder options',[id(),str('repeat','Recurrence',false,{choices:choice(['none','daily','weekly'])}),integer('duration','Minutes long',1,10080),integer('reminder','Minutes before start',0,10080)]),
    sub('cancel','Cancel an event and future occurrences',[id()])
  ]},
  {name:'feed',description:'Subscribe a channel to an RSS or Atom autofeed',options:[
    sub('add','Subscribe without reposting existing feed entries',[str('name','Feed label',true,{max_length:80}),str('url','HTTPS RSS/Atom feed URL from an approved provider',true),channel(true),role]),
    sub('list','List feed subscriptions and delivery status'),sub('preview','Preview the newest item privately',[id()]),
    sub('pause','Pause delivery',[id()]),sub('resume','Resume delivery',[id()]),sub('remove','Remove a subscription',[id()])
  ]}
].map(c => ({...c,type:1,contexts:[0],integration_types:[0]}));
