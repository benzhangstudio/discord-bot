import {EmbedBuilder} from 'discord.js';
import {commands} from './commands.js';
import {UserError} from './user-error.js';

const summaries={
  help:'Show this command list.',
  'embed create':'Open the draft form.', 'embed edit':'Reopen a saved draft.', 'embed list':'List saved drafts.', 'embed delete':'Delete a saved draft.', 'embed remove-section':'Remove a numbered section.', 'embed send':'Publish a saved draft.',
  'schedule add':'Create an event, meeting, or rotation.', 'schedule list':'List upcoming events.', 'schedule show':'View details and replies.', 'schedule edit':'Change details or the start time.', 'schedule post':'Post an event card.', 'schedule configure':'Change reminders, duration, or repeats.', 'schedule cancel':'Stop the event and future reminders.',
  'instagram setup':'Set up sources, channels, and delivery.', 'instagram list':'List sources and queued posts.', 'instagram preview':'Preview the latest post.', 'instagram pause':'Stop collection and delivery.', 'instagram resume':'Resume a paused source.', 'instagram remove':'Remove a source.',
  'settings view':'View server settings.', 'settings timezone':'Set the default timezone.', 'settings status':'Check delivery problems.',
  'access add':'Allow a member to use commands.', 'access remove':'Remove an owner-granted permission.', 'access list':'List owner-approved members.'
};
const labels={help:'Help',embed:'Embeds',schedule:'Schedules',instagram:'Instagram',settings:'Settings',access:'Access · server owner only'};
export function referenceFields() {
  const order=['help','embed','schedule','instagram','settings','access'];
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
    {type:1,components:[{type:3,custom_id:'help:topic',placeholder:'Choose a command category',min_values:1,max_values:1,options:topics.map(({value,label,description})=>({value,label,description,default:value===page}))}]},
    {type:1,components:[{type:2,style:2,custom_id:'help:manual',label:'DM full manual'}]}
  ],allowedMentions:{parse:[]}};
}
export function manualMessages({timezone='UTC'}={}) {
  const pages=[
    new EmbedBuilder().setTitle('Number One · Command reference').setDescription('Required inputs follow each command. Choose saved drafts, events, and sources by name.').addFields(referenceFields()),
    new EmbedBuilder().setTitle('Number One · Embeds and schedules').addFields(
      {name:'Build an embed',value:'Use /embed create and name the draft. Complete the form: saved name, title, main text, color, and optional message. Edit form changes those details together. Other controls add images, links, sections, author information, and small print. Colors accept names such as blue or a six-character color code.'},
      {name:'Save and publish',value:'Changes save automatically after submitting each form. Save & close keeps the draft; /embed edit reopens it. Make a copy creates an independent draft. Select a channel and optional person/role notifications, then Publish—or use /embed send. Publishing keeps the saved copy. Deleting a draft does not delete posted messages. Closing an unsubmitted form does not save what you typed.'},
      {name:'Mentions and permissions',value:'Channel mentions can go in the text. Use the notification pickers to ping a person or role; mentions inside an embed do not notify them. Everyone/here pings are suppressed. You and the bot need permission to use the destination. The bot needs View Channel, Send Messages, and Embed Links. An unmentionable role also requires Mention Everyone for you and the bot.'},
      {name:'Create a schedule',value:'Use /schedule add with a title, start, and channel. Enter dates as YYYY-MM-DD HH:mm using a 24-hour clock, such as 2026-12-01 19:00. Choose an optional timezone, reminder, duration, location, and description. Your server default is '+timezone+'. Default duration: 60 minutes; reminder: 30 minutes before the start. Reminder 0 means at the start.'},
      {name:'Repeats, rotations, and RSVPs',value:'Events can run once, daily, or weekly. For a staff rotation, choose rotation, daily/weekly repetition, and mention people in turn order. Meetings and rotations require a channel hidden from @everyone. Post an event card for Going/Maybe/Can’t make it buttons; members with channel access may reply. /schedule show gives current replies. Editing the start resets RSVPs. Cancel stops future reminders; posted cards remain.'},
      {name:'Time and missed events',value:'Repeats follow the event’s local calendar, including daylight-saving changes. Invalid or ambiguous start times require correction. Discord timestamps display in each reader’s local time. After downtime, expired events are skipped; reminders catch up only while the event is still in progress.'}
    ),
    new EmbedBuilder().setTitle('Number One · Instagram, access, and bot information').addFields(
      {name:'Instagram setup',value:'Use /instagram setup. Source takes a name and an RSS/Atom link from your chosen Instagram feed service. A profile URL alone does not work. Choose the posting channel, an optional role notification, daily/weekly delivery, local time, weekday, and timezone. Schedule also controls link previews. Preview sends a private sample without posting or consuming queued items. Save activates changes.'},
      {name:'Collection and delivery',value:'Sources are checked daily and again when a roundup is due. Empty roundups are skipped. New sources do not resend older posts. Changing the schedule preserves waiting posts. Pause stops collection and posting; resume can deliver an overdue roundup. After downtime, accumulated posts are delivered when the bot returns. There is a limit of 10 sources per server.'},
      {name:'Feed requirements and limits',value:'Posts and stories depend on the feed service’s coverage and retention. The bot does not directly scrape Instagram or guarantee stories. Public HTTPS RSS/Atom links only; redirects and private network addresses are rejected. A feed must be under 2 MB. Do not post private feed links publicly. Change an account’s feed link only after its queue is empty, or add a separate source.'},
      {name:'Who can use slash commands?',value:'Server administrators, members with Manage Server, and people approved by this server’s owner. Owner-approved access applies only to this server and remains until removed. Channel permissions still apply. Ordinary members receive a private denial when they invoke a command. Autocomplete does not reveal saved names to unauthorized users.'},
      {name:'Owner-managed access',value:'Only the current server owner can use /access add user, /access remove user, and /access list. Added people must be current human members. A maximum of 100 people can be approved. Removing a grant does not remove Administrator or Manage Server permissions; those are managed in Discord. Approved users cannot approve others.'},
      {name:'Settings, saved data, and problems',value:'Use /settings timezone for new events and Instagram setups; existing items keep their own timezone. /settings status reports delivery issues. Saved drafts, schedules, sources, approvals, and queues persist across restarts and are separate for each server. If a send is uncertain, check its destination before retrying. Error replies include a reference for support. The bot must remain online for automatic posts and reminders.'},
      {name:'This manual',value:'This DM was requested with DM full manual. No unsolicited DM fallback is used. Reopen /help to request an updated copy.'}
    )
  ];
  return pages.map((embed,index)=>({embeds:[embed.setColor(0xe5a1b3).setFooter({text:'Number One manual · '+(index+1)+'/'+pages.length})],allowedMentions:{parse:[]}}));
}
