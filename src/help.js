import {EmbedBuilder} from 'discord.js';
import {commands} from './commands.js';
import {UserError} from './user-error.js';

const summaries={
  help:'Show this command list.',
  'portal open':'Open or share this server’s member portal.', 'portal setup':'Choose this server’s roles on the website.',
  'embed create':'Open the draft form.', 'embed edit':'Reopen a saved draft.', 'embed list':'List saved drafts.', 'embed delete':'Delete a saved draft.', 'embed remove-section':'Remove a numbered section.', 'embed send':'Publish a saved draft.',
  'schedule add':'Create an event, meeting, or rotation.', 'schedule list':'List upcoming events.', 'schedule show':'View details and replies.', 'schedule edit':'Change details or the start time.', 'schedule post':'Post an event card.', 'schedule configure':'Change reminders, duration, or repeats.', 'schedule cancel':'Stop the event and future reminders.',
  'instagram setup':'Set up sources, channels, and delivery.', 'instagram list':'List sources and queued posts.', 'instagram preview':'Preview the latest post.', 'instagram pause':'Stop collection and delivery.', 'instagram resume':'Resume a paused source.', 'instagram remove':'Remove a source.',
  'settings view':'View server settings.', 'settings timezone':'Set the default timezone.', 'settings status':'Check delivery problems.',
  'access add':'Allow a member to use commands.', 'access remove':'Remove an owner-granted permission.', 'access list':'List owner-approved members.'
};
const labels={mod:'Moderation','mod-settings':'Moderation settings',appeals:'Appeals',emergency:'Critical Emergency Mode',help:'Help',portal:'Portal',embed:'Embeds',schedule:'Schedules',instagram:'Instagram',settings:'Settings',access:'Access · server owner only'};
export function referenceFields() {
  const order=['help','portal','embed','schedule','instagram','settings','access'];
  return [...commands].sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name)).map(command=>{
    const entries=command.options||[null];
    const lines=entries.map(sub=>{
      const key=command.name+(sub?' '+sub.name:'');
      const inputs=(sub?.options||[]).filter(option=>option.required).map(option=>option.name).join(' ');
      return '\u0060/'+key+(inputs?' '+inputs:'')+'\u0060 — '+(summaries[key]||sub?.description||command.description);
    });
    return {name:labels[command.name]||command.name,value:lines.join('\n')};
  });
}
const topics=[
  {value:'home',label:'All categories',description:'Choose which commands to view.'},
  {value:'mod',label:'Moderation',description:'Actions, warnings, and private case history.',root:'mod'},
  {value:'mod-settings',label:'Moderation settings',description:'Owner: roles, automod, logs, and retention.',root:'mod-settings'},
  {value:'appeals',label:'Appeals',description:'Member appeal panel and independent staff review.',root:'appeals'},
  {value:'emergency',label:'Critical Emergency Mode',description:'Lock channels and restore writing permissions.',root:'emergency'},
  {value:'portal',label:'Portal',description:'Open this server’s portal or website setup.',root:'portal'},
  {value:'embeds',label:'Embeds',description:'Create, edit, and publish saved messages.',root:'embed'},
  {value:'events',label:'Schedules',description:'Events, meetings, and rotations.',root:'schedule'},
  {value:'feeds',label:'Instagram',description:'Sources and automatic roundups.',root:'instagram'},
  {value:'setup',label:'Settings',description:'Timezone and delivery status.',root:'settings'},
  {value:'access',label:'Access',description:'Server owner: approve or remove members.',root:'access'}
];
export function helpMenu({page='home'}={}) {
  const topic=topics.find(topic=>topic.value===page);
  if(!topic)throw new UserError('Open /help for the current command menu.');
  const embed=new EmbedBuilder().setColor(0xe5a1b3).setTitle('Number One · '+(page==='home'?'Commands':topic.label));
  if(page==='home') {
    embed.setDescription('Choose a category below to see its commands.').addFields(topics.filter(t=>t.root).map(t=>({name:t.label,value:t.description,inline:true})));
  } else {
    const field=referenceFields().find(field=>field.name===labels[topic.root]);
    embed.setDescription('Required inputs follow each command. Optional inputs appear in Discord.').addFields(field);
  }
  embed.setFooter({text:'Access: Administrator, Manage Server, or approval from this server’s owner. Use /help to reopen.'});
  return {content:'',embeds:[embed],components:[
    {type:1,components:[{type:3,custom_id:'help:topic',placeholder:'Choose a command category',min_values:1,max_values:1,options:topics.map(({value,label,description})=>({value,label,description,default:value===page}))}]}
  ],allowedMentions:{parse:[]}};
}
