// Discord application command JSON. All entry points are slash commands.
const str = (name, description, required = false, extra = {}) => ({type:3,name,description,required,...extra});
const integer = (name, description, min, max) => ({type:4,name,description,min_value:min,max_value:max});
const channel = (required = false) => ({type:7,name:'channel',description:'Choose where Number One should post',required,channel_types:[0,5]});
const id = () => str('id','Start typing a name, then choose from the suggestions',true,{autocomplete:true});
const sub = (name,description,options=[]) => ({type:1,name,description,options});
const labels={event:'Community event','staff-meeting':'Staff meeting',rotation:'Staff rotation',none:'One time only',daily:'Every day',weekly:'Every week'};
const choice = values => values.map(v => ({name:labels[v]||v,value:v}));
const role = {type:8,name:'role',description:'Optional role to notify'};
export const commands = [
  {name:'help',description:'Open the help menu and find a quick walkthrough'},
  {name:'settings',description:'Choose your server’s timezone and check delivery status',default_member_permissions:'32',options:[
    sub('view','See your server’s current settings'),sub('timezone','Choose the timezone for new events',[str('zone','Type a city or choose a timezone, such as New York or Seoul',true,{autocomplete:true})]),
    sub('status','Check whether reminders and weekly posts need attention')
  ]},
  {name:'embed',description:'Create and share announcements with pictures, links, and colors',options:[
    sub('create','Start a new styled message',[str('name','Give your saved message a name, such as Welcome',true,{max_length:80})]),
    sub('edit','Keep working on a saved message',[id()]),sub('list','See your saved messages'),sub('delete','Delete a saved message; posted copies stay in their channels',[id()]),
    sub('remove-section','Remove a section from your message',[id(),{...integer('number','Which section? Count from the top, starting at 1',1,25),required:true}]),
    sub('send','Share a saved message in a channel',[id(),channel(true),role,{type:6,name:'user',description:'Choose a person to notify, if you want'}])
  ]},
  {name:'schedule',description:'Events, meetings, reminders, and staff rotations',options:[
    sub('add','Plan an event, staff meeting, or staff rotation',[
      str('title','What is happening?',true,{max_length:150}),str('start','Date and time: YYYY-MM-DD HH:mm, using a 24-hour clock',true),channel(true),
      str('kind','Event category',false,{choices:choice(['event','staff-meeting','rotation'])}),
      str('repeat','Should this happen once, every day, or every week?',false,{choices:choice(['none','daily','weekly'])}),
      integer('duration','How long is it? Enter minutes; the default is 60',1,10080),integer('reminder','Minutes before the start; default 30, or 0 for the start',0,10080),
      str('description','Event details',false,{max_length:2000}),str('location','Location or meeting link',false,{max_length:300}),
      str('zone','Use a different timezone for this event; type a city',false,{autocomplete:true}),role,str('people','Staff rotation: mention people in turn order, separated by spaces',false,{max_length:1000})
    ]),
    sub('list','See what’s coming up in your server',[integer('page','Which page would you like to see?',1,1000)]),
    sub('show','See an event’s details and let people know if you’re going',[id()]),sub('edit','Change an event’s details or start time',[id()]),
    sub('post','Share an event card where people can say if they’re going',[id()]),
    sub('configure','Change an event’s reminders, length, or repetition',[id(),str('repeat','How often should this event happen?',false,{choices:choice(['none','daily','weekly'])}),integer('duration','How long is it, in minutes?',1,10080),integer('reminder','Minutes before the start; 0 means at the start',0,10080)]),
    sub('cancel','Cancel this event and stop its future reminders',[id()])
  ]},
  {name:'instagram',description:'Set up Instagram roundups for your server',options:[
    sub('setup','Open the setup menu to add or change sources, channels, and delivery times'),
    sub('list','See your sources and how many new posts are waiting'),sub('preview','Take a private look at the latest post',[id()]),
    sub('pause','Pause this source’s roundups',[id()]),sub('resume','Turn this source’s roundups back on',[id()]),sub('remove','Stop following this source; posted messages stay in the channel',[id()])
  ]}
].map(c => ({...c,options:c.options?.map(sub=>({...sub,options:sub.options?.map(option=>option.name==='id'?{...option,name:{embed:'message',schedule:'event',instagram:'source'}[c.name]}:option)})),type:1,default_member_permissions:'32',contexts:[0],integration_types:[0]}));
