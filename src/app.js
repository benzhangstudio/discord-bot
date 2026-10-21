import {UserError} from './user-error.js';
import {canManageServer,MANAGEMENT_ONLY_MESSAGE} from './permissions.js';
import {PermissionFlagsBits as P,MessageFlags,RESTEvents,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder,EmbedBuilder} from 'discord.js';
import {DateTime} from 'luxon';
import {DEFAULT_ZONE,zone,parseTime,parseColor,validateEmbed,webUrl,rotationMember} from './domain.js';
import {loadFeed,feedMessage} from './feeds.js';
import {startWorker} from './worker.js';
import {deliveryLabel} from './weekly-feeds.js';
import {createInstagramSetup} from './instagram.js';
import {commands} from './commands.js';
import {acknowledge,respond,updateResponse,reportFailure,safeError,step,withDeadline,cancelAcknowledgement} from './responses.js';
import {helpMenu,manualMessages} from './help.js';
import {createAccessCommands,isServerOwner} from './access.js';
import {suggestions,timezoneLabel} from './suggestions.js';

export function createApp(client,store,{feedLoader=loadFeed,replyEditTimeoutMs=8000,confirmationTransport,operationTimeoutMs=15000,acknowledgementDelayMs}={}) {
const reply=content=>({content,allowedMentions:{parse:[]}});
const settings=g=>store.get(g,'settings','main') || {id:'main',zone:DEFAULT_ZONE};
const selected=i=>i.options.getString({embed:'message',schedule:'event',instagram:'source'}[i.commandName]) || i.options.getString('id');
function staff(i) {
  if (canManageServer(i.memberPermissions)) {
    return true;
  } else if (isServerOwner(i)) {
    return true;
  } else if (i.guildId && i.user?.id && store.get(i.guildId,'access',i.user.id)) {
    return true;
  } else {
    return false;
  }
}
function needStaff(i) {
  if (!staff(i)) {
    i.privateResponse=true;
    throw new UserError(MANAGEMENT_ONLY_MESSAGE);
  }
}
function item(i,kind,id) {const v=store.get(i.guildId,kind,id);if(!v) throw new UserError('That saved item is no longer available. Choose another from the name suggestions, or create a new one.');return v;}
async function destination(i,id,{writing=true,privateOnly=false}={}) {
  let channel=i.guild.channels.cache?.get(id);
  if(!channel){await acknowledge(i);channel=await step(i,i.guild.channels.fetch(id)).catch(error=>{if(error.name==='UserError')throw error;return null;});}
  return checkDestination(i,channel,{writing,privateOnly});
}
function checkDestination(i,channel,{writing=true,privateOnly=false}={}) {
  if(!channel || ![0,5].includes(channel.type)) throw new UserError('Choose a text or announcement channel in this server.');
  if(!channel.permissionsFor(i.member)?.has([P.ViewChannel,...(writing?[P.SendMessages]:[])])) throw new UserError(writing?'Choose a channel you can view and send messages in.':'You cannot view this event’s channel. Ask a staff member if you need access.');
  if(writing && !channel.permissionsFor(i.guild.members.me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])) throw new UserError('Number One needs View Channel, Send Messages, and Embed Links there.');
  if(privateOnly && channel.permissionsFor(i.guild.roles.everyone)?.has(P.ViewChannel)) throw new UserError('Choose a staff-only channel for meetings and rotations. It must be hidden from @everyone.');
  return channel;
}
async function pingRole(i,roleId,channel) {
  if(!roleId) return;
  let role=i.guild.roles.cache?.get(roleId);
  if(!role){await acknowledge(i);role=await step(i,i.guild.roles.fetch(roleId));}
  if(!role || role.id===i.guildId || role.managed) throw new UserError('Choose a role created for your members, rather than @everyone or a role managed by another app.');
  if(!role.mentionable && (!channel.permissionsFor(i.member)?.has(P.MentionEveryone) || !channel.permissionsFor(i.guild.members.me)?.has(P.MentionEveryone))) throw new UserError('That role cannot be notified here. Ask an administrator to make it mentionable, or give you and Number One the Mention Everyone permission in this channel.');
  return role.id;
}
function modal(id,title,fields) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields.map(([name,label,value='',max=1000,required=false])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(name).setLabel(label).setStyle(max>300?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(required).setMaxLength(max).setValue(String(value).slice(0,max)))));
}
function saveDraft(i,d) {d.updatedAt=Date.now();return store.put(i.guildId,'embed',d);}
function editor(d,i) {
  d={...d};
  if(i?.guild?.channels.cache&&!i.guild.channels.cache.has(d.sendChannel))delete d.sendChannel;
  if(i?.guild?.roles.cache&&!i.guild.roles.cache.has(d.sendRole))delete d.sendRole;
  const buttons=[['form','Edit form'],['media','Pictures & links'],['field','Add or edit a section'],['branding','Author & small print'],['clearfields','Clear sections']];
  const row=(...components)=>({type:1,components});
  const select=(type,action,placeholder,value,extra={})=>({type,custom_id:`embed:${d.id}:${action}`,placeholder,min_values:action==='channel'?1:0,max_values:1,...extra,...(value?{default_values:[{id:value,type:{8:'channel',6:'role',5:'user'}[type]}]}:{})});
  return {content:`**${d.name}** · Saved automatically${d.updatedAt?` <t:${Math.floor(d.updatedAt/1000)}:R>`:''}\nUse **Edit form** for the main details. Choose a channel and optional notifications below, then **Publish**. **Save & close** keeps your draft; reopen it anytime with /embed edit. Publishing keeps the saved copy.`,embeds:[new EmbedBuilder(Object.keys(d.embed).length?d.embed:{description:'Use the controls below to create your announcement.',color:0xe5a1b3})],components:[
    row(...buttons.map(([action,label])=>({type:2,style:2,label,custom_id:`embed:${d.id}:${action}`}))),
    row(select(8,'channel','Choose where to publish',d.sendChannel,{channel_types:[0,5]})),
    row(select(6,'role','Optional: notify a role (clear to disable)',d.sendRole)),
    row(select(5,'user','Optional: notify a person (clear to disable)',d.sendUser)),
    row(...[['publish','Publish',1],['save','Save & close',3],['copy','Make a copy',2]].map(([action,label,style])=>({type:2,style,label,custom_id:`embed:${d.id}:${action}`})))
  ],allowedMentions:{parse:[]}};
}
function editModal(d,action) {
  const e=d.embed;
  const fields={
    form:[['name','Saved draft name',d.name,80,true],['title','Title',e.title,256],['description','Main text (you can mention channels)',e.description,4000],['color','Color, e.g. pink or E5A1B3',e.color?.toString(16).padStart(6,'0'),20],['content','Optional message above your announcement',d.content,1800]],
    text:[['title','Title',e.title,256],['description','Main text (you can mention channels)',e.description,4000],['color','Color name or code, e.g. pink or E5A1B3',e.color?.toString(16).padStart(6,'0'),20],['content','Optional message above your announcement',d.content,1800]],
    media:[['url','Title link',e.url,500],['image','Main picture link',e.image?.url,500],['thumbnail','Small picture link',e.thumbnail?.url,500]],
    field:[['name','Section heading','',256,true],['value','Section text','',1024,true],['inline','Place beside other sections? yes or no','no',3],['number','Section to replace (leave blank to add one)','',2]],
    branding:[['author','Author name',e.author?.name,256],['authorurl','Author link',e.author?.url,500],['icon','Author picture link',e.author?.icon_url,500],['footer','Small text at the bottom',e.footer?.text,2048]]
  };
  return modal(`embedform:${d.id}:${action}`,'Number One · Edit message',fields[action]);
}
function eventView(e) {
  const counts=Object.values(e.rsvps || {}).reduce((a,v)=>(a[v]=(a[v]||0)+1,a),{});
  return {embeds:[new EmbedBuilder().setColor(0xe5a1b3).setTitle(e.title).setDescription((e.description || 'No description.').slice(0,4096)).addFields(
    {name:'When',value:`<t:${Math.floor(e.start/1000)}:F>\n${timezoneLabel(e.zone)} · ${e.duration} minutes`},
    {name:'Details',value:`${{event:'Community event','staff-meeting':'Staff meeting',rotation:'Staff rotation'}[e.kind]||'Event'} · ${{none:'One time only',daily:'Every day',weekly:'Every week'}[e.repeat]||'One time only'}\n<#${e.channel}>${e.location?'\n'+e.location:''}${rotationMember(e)?'\nOn duty: <@'+rotationMember(e)+'>':''}`},
    {name:'Who’s coming?',value:`Going: ${counts.going||0} · Maybe: ${counts.maybe||0} · Can’t make it: ${counts.declined||0}`}
  ).setFooter({text:`Number One · ${e.cancelled?'Cancelled':e.complete?'Finished':'Open /schedule show to see the latest replies'}`})],components:e.cancelled||e.complete?[]:[{type:1,components:[['going','Going',1],['maybe','Maybe',2],['declined','Can’t make it',2]].map(([value,label,style])=>({type:2,style,label,custom_id:`rsvp:${e.id}:${e.start}:${value}`}))}],allowedMentions:{parse:[]}};
}

const accessCommands=createAccessCommands(store);
const manualRequests=new Map();
const instagram=createInstagramSetup({store,settings,needStaff,destination,pingRole,load:feedLoader});

async function publishEmbed(i,id,channelId,roleId,user) {
  if(!channelId)throw new UserError('Choose a channel below before publishing.');
  await acknowledge(i);
  const channel=await destination(i,channelId),role=await pingRole(i,roleId,channel);
  if(user)await step(i,i.guild.members.fetch(user)).catch(error=>{if(error.name==='UserError')throw error;throw new UserError('Choose a current member of this server to notify.');});
  needStaff(i);const ready=item(i,'embed',id);validateEmbed(ready);
  const message=await step(i,()=>channel.send({content:[role?`<@&${role}>`:'',user?`<@${user}>`:'',ready.content].filter(Boolean).join(' '),embeds:[new EmbedBuilder(ready.embed)],allowedMentions:{parse:[],roles:role?[role]:[],users:user?[user]:[]},...(i.id?{nonce:i.id,enforceNonce:true}:{})}),{uncertain:true});
  console.log('Embed published; sending its confirmation.');
  return respond(i,reply(`Message sent. ${message.url}`),{editTimeoutMs:replyEditTimeoutMs});
}

// Unpublished work and restricted events must not be exposed by public replies.
function restrictedEvent(i,e) {
  const channel=i.guild?.channels.cache?.get(e.channel);
  return e.kind==='staff-meeting'||e.kind==='rotation'||!channel?.permissionsFor(i.guild.roles.everyone)?.has(P.ViewChannel);
}
function responsePrivacy(i) {
  const sub=i.isChatInputCommand()?i.options.getSubcommand(false):null;
  if(i.commandName==='embed'&&['create','edit','list','remove-section'].includes(sub))return true;
  if(i.commandName==='access'&&sub==='list')return true;
  if(i.commandName==='instagram'&&['setup','preview'].includes(sub))return true;
  if(i.customId?.startsWith('embedform:')||i.customId?.startsWith('instagram:')||i.customId?.startsWith('rsvp:'))return true;
  if(i.customId?.startsWith('embed:')&&!i.customId.endsWith(':publish'))return true;
  if(i.commandName==='schedule') {
    if(sub==='add')return (i.options.getString('kind')||'event')!=='event';
    if(sub==='list')return store.list(i.guildId,'event').some(e=>!e.cancelled&&!e.complete&&e.start+e.duration*60000>Date.now()&&restrictedEvent(i,e));
    const e=store.get(i.guildId,'event',selected(i));
    if(e)return restrictedEvent(i,e);
  }
  if(i.customId?.startsWith('eventform:')) {
    const e=store.get(i.guildId,'event',i.customId.split(':')[1]);
    return !e||restrictedEvent(i,e);
  }
  return false;
}
async function handle(i) {
  i.confirmationTransport=confirmationTransport||i.confirmationTransport;
  i.operationTimeoutMs=operationTimeoutMs;
  i.acknowledgementDelayMs=acknowledgementDelayMs;
  i.operationDeadline=Date.now()+operationTimeoutMs;
  if (i.isAutocomplete?.()) {
    if (!i.inGuild() || !staff(i)) {
      return i.respond([]);
    } else {
      return i.respond(suggestions(store,i,{canManage:true,canConfigure:true}));
    }
  }
  if(!i.inGuild()) throw new UserError('Use Number One inside a Discord server.');
  if (i.isChatInputCommand()) {
    needStaff(i);
  }
  i.privateResponse=responsePrivacy(i);
  if(await accessCommands(i))return;
  if(await instagram(i))return;
  if(i.customId?.startsWith('embed:')&&(i.isChannelSelectMenu?.()||i.isRoleSelectMenu?.()||i.isUserSelectMenu?.())) {
    needStaff(i);const [,id,action]=i.customId.split(':'),d=item(i,'embed',id);
    const key={channel:'sendChannel',role:'sendRole',user:'sendUser'}[action];
    if(!key)throw new UserError('Open /embed edit to use the latest builder.');
    if(action==='channel')checkDestination(i,i.guild.channels.cache?.get(i.values[0]));
    d[key]=i.values[0]||null;saveDraft(i,d);return i.update(editor(d,i));
  }
  const helpOptions=()=>({canManage:staff(i),canConfigure:staff(i),timezone:settings(i.guildId).zone});
  if(i.isChatInputCommand()&&i.commandName==='help') {
    // Help is built entirely from local data. Send it as the initial response,
    // rather than deferring and relying on a second webhook request.
    const payload=helpMenu(helpOptions());
    console.log('Sending /help menu as a direct reply.');
    await respond(i,payload);
    console.log('Discord accepted the /help menu.');
    return;
  }
  if(i.isChatInputCommand()&&i.commandName==='schedule'&&i.options.getSubcommand(false)==='list') {
    // Guild channel/permission updates arrive through the gateway. Fail closed
    // for uncached channels instead of stalling a list on individual REST fetches.
    const now=Date.now(),events=store.list(i.guildId,'event').filter(e=>{
      if(e.cancelled||e.complete||e.start+e.duration*60000<=now)return false;
      try {checkDestination(i,i.guild.channels.cache?.get(e.channel),{writing:false});return true;}catch{return false;}
    }).sort((a,b)=>a.start-b.start);
    const total=Math.max(1,Math.ceil(events.length/5)),page=Math.min(i.options.getInteger('page')||1,total);
    const clean=value=>String(value).replace(/[\\*_~`|<>@\[\]]/g,'');
    const content=events.length?
      `**Upcoming events · page ${page}/${total}**\n`+events.slice((page-1)*5,page*5).map(e=>`**${clean(e.title).slice(0,150)}** · <t:${Math.floor(e.start/1000)}:F> · <#${e.channel}>`).join('\n')+'\n\nUse /schedule show and choose an event by name for details and replies.':
      'No upcoming events you can view right now. Check back soon.'+(staff(i)?'\n\nUse /schedule add to plan an event.':'');
    console.log(`Sending /schedule list directly (${events.length} visible events).`);
    await respond(i,reply(content));
    console.log('Discord accepted /schedule list.');
    return;
  }
  if (i.isButton() && i.customId==='help:manual') {
    needStaff(i);
    const key=i.guildId+':'+i.user.id;
    if ((manualRequests.get(key)||0)>Date.now()) {
      throw new UserError('The manual was just requested. Check your DMs, or wait 30 seconds before trying again.');
    }
    // Remove expired entries; the map stores only recent manual requests.
    for (const [saved,expires] of manualRequests) {
      if (expires<=Date.now()) manualRequests.delete(saved);
    }
    manualRequests.set(key,Date.now()+30000);
    await acknowledge(i);
    const pages=manualMessages({timezone:settings(i.guildId).zone});
    let delivered=0;
    try {
      for (const page of pages) {
        needStaff(i);
        await step(i,()=>i.user.send(page));
        delivered++;
      }
    } catch(error) {
      if (delivered>0) {
        throw new UserError('Manual delivery stopped after '+delivered+' of '+pages.length+' pages. Check your DMs before requesting it again.');
      } else if (Number(error.code)===50007) {
        manualRequests.delete(key);
        throw new UserError('I could not DM you. Enable direct messages from this server, then click DM full manual again.');
      } else {
        throw new UserError('The manual could not be delivered in full. Check your DMs and privacy settings before requesting it again.');
      }
    }
    console.log('Full manual delivered ('+delivered+' pages); sending confirmation.');
    return respond(i,reply('Full manual sent to your DMs.'));
  }
  if(i.isStringSelectMenu?.()) {
    if(i.customId!=='help:topic')throw new UserError('This menu is no longer available. Open /help again.');
    return i.update(helpMenu({...helpOptions(),page:i.values[0]}));
  }
  // Discord already supplies the invoking member. Do not delay acknowledgement with a REST fetch.
  if(i.isChatInputCommand()) {
    const definition=commands.find(command=>command.name===i.commandName);
    if(!definition)return respond(i,reply('This is an older or unavailable command. Use /schedule list for upcoming events, or /help for current commands.'));
    if(definition.options&&!definition.options.some(option=>option.name===i.options.getSubcommand(false)))throw new UserError('This command has changed. Choose one of its current options, or use /help.');
  }
  if(i.isButton()) {
    const [kind,id,action,value]=i.customId.split(':');
    if(kind==='embed') {
      needStaff(i);const d=item(i,'embed',id);
      if(action==='publish')return publishEmbed(i,id,d.sendChannel,d.sendRole,d.sendUser);
      if(action==='save'){saveDraft(i,d);return updateResponse(i,{content:`**${d.name}** is saved. Open /embed edit and choose it by name whenever you want to continue.`,embeds:[],components:[],allowedMentions:{parse:[]}});}
      if(action==='copy'){
        if(store.list(i.guildId,'embed').length>=100)throw new UserError('You already have 100 saved drafts. Delete one before making a copy.');
        const copy={...d,name:(d.name.slice(0,73)+' (copy)'),owner:i.user.id};delete copy.id;
        // A copied announcement should require a fresh publishing destination.
        delete copy.sendChannel;delete copy.sendRole;delete copy.sendUser;
        saveDraft(i,copy);return updateResponse(i,editor(copy,i));
      }
      if(action==='clearfields') {delete d.embed.fields;validateEmbed(d);saveDraft(i,d);return updateResponse(i,editor(d,i));}
      return i.showModal(editModal(d,action));
    }
    if(kind==='rsvp') {
      let e=item(i,'event',id);await destination(i,e.channel,{writing:false});
      // Other members may RSVP while the permission lookup is in progress.
      e=item(i,'event',id);
      if(e.cancelled || e.complete || e.start!==Number(action) || Date.now()>e.start+e.duration*60000) throw new UserError('This event is no longer accepting replies, or its time has changed. Open /schedule show and choose the event again.');
      if(!['going','maybe','declined'].includes(value)) throw new UserError('Choose Going, Maybe, or Can’t make it on the event card.');
      e.rsvps ||= {};e.rsvps[i.user.id]=value;store.put(i.guildId,'event',e);
      return respond(i,reply(`Your reply is saved: **${{going:'Going',maybe:'Maybe',declined:'Can’t make it'}[value]}**. You can change your answer on the event card. Use /schedule show to see the latest replies.`));
    }
    throw new UserError('This button is no longer available.');
  }
  if(i.isModalSubmit()) {
    needStaff(i);const [kind,id,action]=i.customId.split(':');const read=k=>i.fields.getTextInputValue(k).trim();
    if(kind==='embedform') {
      const d=item(i,'embed',id),e=d.embed;
      if(action==='text'||action==='form') {
        if(action==='form'){d.name=read('name');if(!d.name)throw new UserError('Give your saved draft a name.');}
        for(const key of ['title','description']) {const v=read(key);if(v)e[key]=v;else delete e[key];}
        const color=read('color');
        if(color)e.color=parseColor(color);else delete e.color;d.content=read('content');
      } else if(action==='media') {
        for(const key of ['url','image','thumbnail']) {const v=read(key);if(v)e[key]=key==='url'?webUrl(v):{url:webUrl(v)};else delete e[key];}
      } else if(action==='field') {
        const beside=read('inline').toLowerCase();if(!['yes','no',''].includes(beside))throw new UserError('For placing sections beside each other, enter yes or no.');
        e.fields ||= [];const field={name:read('name'),value:read('value'),inline:beside==='yes'};
        const number=read('number');if(number) {const n=Number(number);if(!Number.isInteger(n)||n<1||n>e.fields.length)throw new UserError('Choose a section that is already in your message, counting from the top.');e.fields[n-1]=field;} else e.fields.push(field);
      } else if(action==='branding') {
        const author=read('author');if(author) {e.author={name:author};if(read('authorurl'))e.author.url=webUrl(read('authorurl'));if(read('icon'))e.author.icon_url=webUrl(read('icon'));} else delete e.author;
        const footer=read('footer');if(footer)e.footer={text:footer};else delete e.footer;
      }
      validateEmbed(d);new EmbedBuilder(e).toJSON();saveDraft(i,d);
      if(i.isFromMessage())return updateResponse(i,editor(d,i));
      return respond(i,{...editor(d,i),flags:MessageFlags.Ephemeral});
    }
    if(kind==='eventform') {
      let e=item(i,'event',id);await destination(i,e.channel,{privateOnly:e.kind!=='event'});
      e=item(i,'event',id);
      if(e.cancelled || e.complete) throw new UserError('Create a new event instead of editing a cancelled or completed event.');
      const start=parseTime(read('start'),e.zone);if(start<=Date.now())throw new UserError('Choose a future start time.');
      e.title=read('title');e.description=read('description');e.location=read('location');e.start=start;e.rsvps={};store.put(i.guildId,'event',e);
      return respond(i,eventView(e));
    }
    throw new UserError('This form is no longer available.');
  }
  if(!i.isChatInputCommand())return;
  const name=i.commandName,sub=i.options.getSubcommand(false),opt=i.options;
  if(name==='settings') {
    needStaff(i);
    const s=settings(i.guildId);
    if(sub==='timezone')s.zone=zone(opt.getString('zone'));
    if(sub==='status') {
      const issues=store.problems(i.guildId).map(p=>p.key.startsWith('event:')?'• A reminder could not be confirmed. Check the event’s channel before posting it again.':'• A roundup could not be confirmed. Check its channel before sending another copy.');
      for(const e of store.list(i.guildId,'event'))if(e.error)issues.push('• An event needs attention. Check that Number One can view and send messages in its channel.');
      for(const f of store.list(i.guildId,'feed'))if(f.error)issues.push(`• ${f.name} needs attention. Check its feed link and Number One’s channel permissions.`);
      return respond(i,reply(issues.length?[...new Set(issues)].join('\n').slice(0,1900):'No recent reminder or Instagram delivery problems.'));
    }
    store.put(i.guildId,'settings',s);return respond(i,reply(`**Your server’s settings**\nNew events use **${timezoneLabel(s.zone)}**.\nSlash commands require **Administrator**, **Manage Server**, or approval from this server’s owner. Existing events keep their original timezone.`));
  }
  if(name==='embed') {
    needStaff(i);
    if(sub==='create') {
      if(store.list(i.guildId,'embed').length>=100)throw new UserError('You already have 100 saved messages. Delete one you no longer need before making another.');
      const d=saveDraft(i,{name:opt.getString('name'),owner:i.user.id,embed:{description:'Your announcement goes here. Use the controls below to make it yours.',color:0xe5a1b3},content:''});
      return i.showModal(editModal(d,'form'));
    }
    if(sub==='list') {const saved=store.list(i.guildId,'embed');return respond(i,reply(saved.length?(saved.map(d=>`• **${d.name}**`).join('\n')+'\n\nUse /embed edit or /embed send and choose a message by name.').slice(0,1900):'No saved messages yet. Start your first one with /embed create.'));}
    const d=item(i,'embed',selected(i));
    if(sub==='edit')return respond(i,{...editor(d,i),flags:MessageFlags.Ephemeral});
    if(sub==='delete') {store.remove(i.guildId,'embed',d.id);return respond(i,reply('Saved message deleted. Any copies already posted in channels are unchanged.'));}
    if(sub==='remove-section') {const n=opt.getInteger('number');if(!d.embed.fields?.[n-1])throw new UserError('There is no section at that position. Count the sections from the top, starting at 1.');d.embed.fields.splice(n-1,1);validateEmbed(d);saveDraft(i,d);return respond(i,{...editor(d,i),flags:MessageFlags.Ephemeral});}
    if(sub==='send')return publishEmbed(i,d.id,opt.getChannel('channel').id,opt.getRole('role')?.id,opt.getUser('user')?.id);
  }
  if(name==='schedule') {
    if(sub==='show') {const e=item(i,'event',selected(i));await destination(i,e.channel,{writing:false});return respond(i,eventView(e));}
    needStaff(i);
    if(sub==='add') {
      await acknowledge(i);
      if(store.list(i.guildId,'event').filter(e=>!e.complete&&!e.cancelled).length>=200)throw new UserError('You already have 200 upcoming schedules. Cancel one you no longer need before adding another.');
      const kind=opt.getString('kind')||'event',repeat=opt.getString('repeat')||'none',timezone=zone(opt.getString('zone')||settings(i.guildId).zone);
      const channel=await destination(i,opt.getChannel('channel').id,{privateOnly:kind!=='event'});
      const start=parseTime(opt.getString('start'),timezone);if(start<=Date.now())throw new UserError('Choose a future start time.');
      const raw=opt.getString('people')||opt.getString('assignees')||'';const assignees=raw.split(/[\s,]+/).filter(Boolean).map(v=>v.replace(/^<@!?|>$/g,''));
      if(assignees.length>30 || assignees.some(v=>!/^\d{17,20}$/.test(v)))throw new UserError('Mention up to 30 people in the order they should take turns, separated by spaces.');
      if(kind==='rotation' && (!assignees.length || repeat==='none'))throw new UserError('Choose Every day or Every week for the rotation, and mention the people who will take turns.');
      for(const id of assignees)await step(i,i.guild.members.fetch(id)).catch(error=>{if(error.name==='UserError')throw error;throw new UserError('One of the people in this rotation is not a member of this server. Check the mentions and try again.');});
      const duration=opt.getInteger('duration')||60;
      if((repeat==='daily' && duration>=1440)||(repeat==='weekly' && duration>=10080))throw new UserError('This event must finish before the next one begins. Shorten its duration or choose a less frequent repeat.');
      const role=await pingRole(i,opt.getRole('role')?.id,channel);needStaff(i);
      if(store.list(i.guildId,'event').filter(e=>!e.complete&&!e.cancelled).length>=200)throw new UserError('You already have 200 upcoming schedules. Cancel one before adding another.');
      const e=store.put(i.guildId,'event',{title:opt.getString('title'),description:opt.getString('description')||'',location:opt.getString('location')||'',channel:channel.id,start,zone:timezone,kind,repeat,duration,reminder:opt.getInteger('reminder')??30,role,assignees,rotationIndex:0,rsvps:{}});
      return respond(i,eventView(e));
    }
    let e=item(i,'event',selected(i));
    if(sub==='edit')checkDestination(i,i.guild.channels.cache?.get(e.channel),{privateOnly:e.kind!=='event'});
    else await destination(i,e.channel,{privateOnly:e.kind!=='event'});
    e=item(i,'event',e.id);needStaff(i);
    if(sub==='post') {await acknowledge(i);const channel=await destination(i,e.channel);e=item(i,'event',e.id);if(e.cancelled||e.complete)throw new UserError('This event is no longer active.');const sent=await step(i,channel.send(eventView(e)),{uncertain:true});return respond(i,reply(`Event card posted: ${sent.url}`));}
    if(sub==='configure') {
      if(e.cancelled||e.complete)throw new UserError('This event is no longer active.');
      e.repeat=opt.getString('repeat')??e.repeat;e.duration=opt.getInteger('duration')??e.duration;e.reminder=opt.getInteger('reminder')??e.reminder;
      if(e.kind==='rotation'&&e.repeat==='none')throw new UserError('Choose Every day or Every week for a staff rotation.');
      if((e.repeat==='daily'&&e.duration>=1440)||(e.repeat==='weekly'&&e.duration>=10080))throw new UserError('This event must finish before the next one begins. Shorten its duration or choose a less frequent repeat.');
      store.put(i.guildId,'event',e);return respond(i,eventView(e));
    }
    if(sub==='cancel') {e.cancelled=true;store.put(i.guildId,'event',e);return respond(i,reply('Event cancelled. Future repeats and reminders have stopped.'));}
    if(sub==='edit') {const local=DateTime.fromMillis(e.start,{zone:e.zone});const startText=local.toFormat('yyyy-MM-dd HH:mm')+(local.getPossibleOffsets().length>1?local.toFormat('ZZ'):'');return i.showModal(modal(`eventform:${e.id}:edit`,'Number One · Edit event',[
      ['title','Title',e.title,150,true],['start',`Start · ${timezoneLabel(e.zone)}`.slice(0,45),startText,40,true],['description','Description',e.description,2000],['location','Location',e.location,300]
    ]));}
  }
  if(name==='instagram') {
    needStaff(i);
    if(sub==='list') {const sources=store.list(i.guildId,'feed');return respond(i,{...reply(''),content:sources.length?sources.map(f=>`**${f.name}** → <#${f.channel}>\n${f.paused?'Paused':deliveryLabel(f)} · ${f.pending?.length||0} new posts waiting${f.error?' · Needs attention—check the source and channel':''}`).join('\n\n').slice(0,1700)+'\n\nUse /instagram preview, pause, resume, or remove and choose a source by name.':'No sources yet. Use /instagram setup to choose your sources, channels, and delivery schedule.',allowedMentions:{parse:[]}});}
    let f=item(i,'feed',selected(i));
    if(sub==='remove') {store.remove(i.guildId,'feed',f.id);return respond(i,reply('Source removed. No more roundups will be sent from it. Messages already in the channel are unchanged.'));}
    if(sub==='preview') {await acknowledge(i);await destination(i,f.channel);const items=await step(i,feedLoader(f.url));if(!items.length)throw new UserError('There are no posts to preview yet. Check again later.');return respond(i,{...feedMessage(f,items[0]),flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}
    f.paused=sub==='pause';f.settingsVersion=(f.settingsVersion||0)+1;if(!f.paused)f.nextCheck=0;store.put(i.guildId,'feed',f);return respond(i,reply(f.paused?'Source paused. No new posts will be collected or shared until you resume it.':'Source resumed. New posts will go into your scheduled roundup. If a roundup is overdue, it may be shared now.'));
  }
  throw new UserError('This command has changed or is unavailable. Use /help for current commands.');
}

async function dispatch(i) {
  if(!i.isChatInputCommand()&&!i.isButton()&&!i.isModalSubmit()&&!i.isStringSelectMenu?.()&&!i.isAutocomplete?.()&&!i.isChannelSelectMenu?.()&&!i.isRoleSelectMenu?.()&&!i.isUserSelectMenu?.())return;
  console.log(`Received ${i.isChatInputCommand()?'/'+i.commandName:'component'}${i.createdTimestamp?` (${Math.max(0,Date.now()-i.createdTimestamp)}ms old)`:''}`);
  const started=Date.now();
  try {await handle(i);console.log(`Completed ${i.commandName?'/'+i.commandName:'component'} in ${Date.now()-started}ms.`);} catch(error) {
    if(i.isAutocomplete?.()){console.error(`Could not load command suggestions: ${safeError(error)}`);try{await i.respond([]);}catch{}return;}
    await reportFailure(i,error);
  }
}
client.on('interactionCreate',dispatch);
client.rest?.on(RESTEvents.RateLimited,details=>console.warn(`Discord is delaying a request because of a rate limit. Retry delay: ${Math.ceil((details.timeToReset || details.retryAfter || 0)/1000)} second(s).`));
let stopWorker;
client.once('clientReady',()=>{console.log(`Number One is online as ${client.user.tag}. Slash commands only. ${client.guilds.cache.size} server(s).`);stopWorker=startWorker(client,store);});
client.on('error',error=>console.error(`Discord client error (${error.code || error.name}): ${safeError(error)}`));
client.on('guildDelete',guild=>console.log(`Removed from server ${guild.id}; saved data retained for operator-managed deletion.`));
return {handle:async i=>{try{return await handle(i);}catch(error){cancelAcknowledgement(i);throw error;}},dispatch,stop:()=>stopWorker?.()};
}
