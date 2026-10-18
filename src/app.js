import {PermissionFlagsBits as P,MessageFlags,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder,EmbedBuilder} from 'discord.js';
import {DateTime} from 'luxon';
import {DEFAULT_ZONE,zone,parseTime,validateEmbed,webUrl,rotationMember} from './domain.js';
import {loadFeed,feedMessage} from './feeds.js';
import {startWorker} from './worker.js';
import {nextDigest} from './weekly-feeds.js';
import {commands} from './commands.js';
import {acknowledge,respond,updateResponse,reportFailure,safeError} from './responses.js';
import {helpMenu} from './help.js';

export function createApp(client,store) {
const privateReply=content=>({content,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
const settings=g=>store.get(g,'settings','main') || {id:'main',zone:DEFAULT_ZONE};
function staff(i) {const role=settings(i.guildId).staff;return i.memberPermissions?.has(P.ManageGuild) || Boolean(role && (i.member.roles?.cache?.has(role) || (Array.isArray(i.member.roles)&&i.member.roles.includes(role))));}
function needStaff(i) {if(!staff(i)) throw Error('You need Manage Server or this server’s configured Number One staff role.');}
function item(i,kind,id) {const v=store.get(i.guildId,kind,id);if(!v) throw Error('That item was not found in this server.');return v;}
async function destination(i,id,{writing=true,privateOnly=false}={}) {
  const channel=i.guild.channels.cache?.get(id) || await i.guild.channels.fetch(id).catch(()=>null);
  return checkDestination(i,channel,{writing,privateOnly});
}
function checkDestination(i,channel,{writing=true,privateOnly=false}={}) {
  if(!channel || ![0,5].includes(channel.type)) throw Error('Choose a text or announcement channel in this server.');
  if(!channel.permissionsFor(i.member)?.has([P.ViewChannel,...(writing?[P.SendMessages]:[])])) throw Error('You cannot access or publish in that channel.');
  if(writing && !channel.permissionsFor(i.guild.members.me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])) throw Error('Number One needs View Channel, Send Messages, and Embed Links there.');
  if(privateOnly && channel.permissionsFor(i.guild.roles.everyone)?.has(P.ViewChannel)) throw Error('Staff meetings and rotations require a channel hidden from @everyone.');
  return channel;
}
async function pingRole(i,roleId,channel) {
  if(!roleId) return;
  const role=await i.guild.roles.fetch(roleId);
  if(!role || role.id===i.guildId || role.managed) throw Error('Choose an ordinary server role.');
  if(!role.mentionable && (!channel.permissionsFor(i.member)?.has(P.MentionEveryone) || !channel.permissionsFor(i.guild.members.me)?.has(P.MentionEveryone))) throw Error('Both you and Number One need Mention Everyone in the destination to notify a non-mentionable role.');
  return role.id;
}
function modal(id,title,fields) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields.map(([name,label,value='',max=1000,required=false])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(name).setLabel(label).setStyle(max>300?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(required).setMaxLength(max).setValue(String(value).slice(0,max)))));
}
function editor(d) {
  const buttons=[['text','Text & color'],['media','Images & links'],['field','Add field'],['branding','Author & footer'],['clearfields','Clear fields']];
  return {content:`**${d.name}** · ID: \`${d.id}\`\nSaved automatically. Use /embed send to publish. Channel links: <#CHANNEL_ID>. Notification pings are selected when sending.`,embeds:[new EmbedBuilder(Object.keys(d.embed).length?d.embed:{description:'Use the buttons below to build your embed.',color:0xe5a1b3})],components:[{type:1,components:buttons.map(([action,label])=>({type:2,style:2,label,custom_id:`embed:${d.id}:${action}`}))}],allowedMentions:{parse:[]}};
}
function editModal(d,action) {
  const e=d.embed;
  const fields={
    text:[['title','Title',e.title,256],['description','Description (supports channel mentions)',e.description,4000],['color','Hex color, e.g. E5A1B3',e.color?.toString(16).padStart(6,'0'),6],['content','Message above embed (no notification pings)',d.content,1800]],
    media:[['url','Title link',e.url,500],['image','Image URL',e.image?.url,500],['thumbnail','Thumbnail URL',e.thumbnail?.url,500]],
    field:[['name','Field name','',256,true],['value','Field value','',1024,true],['inline','Inline? yes or no','no',3],['number','Field number to replace (blank adds a field)','',2]],
    branding:[['author','Author name',e.author?.name,256],['authorurl','Author link',e.author?.url,500],['icon','Author icon URL',e.author?.icon_url,500],['footer','Footer text',e.footer?.text,2048]]
  };
  return modal(`embedform:${d.id}:${action}`,'Number One · Embed builder',fields[action]);
}
function eventView(e) {
  const counts=Object.values(e.rsvps || {}).reduce((a,v)=>(a[v]=(a[v]||0)+1,a),{});
  return {embeds:[new EmbedBuilder().setColor(0xe5a1b3).setTitle(e.title).setDescription((e.description || 'No description.').slice(0,4096)).addFields(
    {name:'When',value:`<t:${Math.floor(e.start/1000)}:F>\n${e.zone} · ${e.duration} minutes`},
    {name:'Details',value:`${e.kind} · ${e.repeat}\n<#${e.channel}>${e.location?'\n'+e.location:''}${rotationMember(e)?'\nOn duty: <@'+rotationMember(e)+'>':''}`},
    {name:'RSVP',value:`Going: ${counts.going||0} · Maybe: ${counts.maybe||0} · Declined: ${counts.declined||0}`}
  ).setFooter({text:`ID: ${e.id}${e.cancelled?' · Cancelled':e.complete?' · Completed':''}`})],components:e.cancelled||e.complete?[]:[{type:1,components:[['going','Going',1],['maybe','Maybe',2],['declined','Decline',2]].map(([value,label,style])=>({type:2,style,label,custom_id:`rsvp:${e.id}:${e.start}:${value}`}))}],allowedMentions:{parse:[]}};
}

async function handle(i) {
  if(!i.inGuild()) throw Error('Use Number One inside a Discord server.');
  const helpOptions=()=>({canManage:staff(i),canConfigure:Boolean(i.memberPermissions?.has(P.ManageGuild)),timezone:settings(i.guildId).zone});
  if(i.isStringSelectMenu?.()) {
    await acknowledge(i,true);
    if(i.customId!=='help:topic')throw Error('This menu is no longer available. Open /help again.');
    return updateResponse(i,helpMenu({...helpOptions(),page:i.values[0]}));
  }
  // Discord already supplies the invoking member. Do not delay acknowledgement with a REST fetch.
  if(i.isChatInputCommand()) {
    const opensModal=i.commandName==='schedule'&&i.options.getSubcommand(false)==='edit';
    if(!opensModal)await acknowledge(i);
    const definition=commands.find(command=>command.name===i.commandName);
    if(!definition)return respond(i,privateReply('This is an older or unavailable command. Use /schedule list for upcoming events, or /help for current commands.'));
    if(definition.options&&!definition.options.some(option=>option.name===i.options.getSubcommand(false)))throw Error('This command has changed. Choose one of its current subcommands, or use /help.');
  }
  if(i.isButton()) {
    const [kind,id,action,value]=i.customId.split(':');
    if(kind==='embed') {
      needStaff(i);const d=item(i,'embed',id);
      if(action==='clearfields') {delete d.embed.fields;validateEmbed(d);store.put(i.guildId,'embed',d);return updateResponse(i,editor(d));}
      return i.showModal(editModal(d,action));
    }
    if(kind==='rsvp') {
      await acknowledge(i);
      let e=item(i,'event',id);await destination(i,e.channel,{writing:false});
      // Other members may RSVP while the permission lookup is in progress.
      e=item(i,'event',id);
      if(e.cancelled || e.complete || e.start!==Number(action) || Date.now()>e.start+e.duration*60000) throw Error('This occurrence is no longer accepting RSVPs. Open /schedule show for the current occurrence.');
      if(!['going','maybe','declined'].includes(value)) throw Error('Invalid RSVP.');
      e.rsvps ||= {};e.rsvps[i.user.id]=value;store.put(i.guildId,'event',e);
      return respond(i,privateReply(`RSVP saved: ${value}. Use /schedule show to see current counts.`));
    }
    throw Error('This button is no longer available.');
  }
  if(i.isModalSubmit()) {
    await acknowledge(i,i.customId.startsWith('embedform:')&&i.isFromMessage());
    needStaff(i);const [kind,id,action]=i.customId.split(':');const read=k=>i.fields.getTextInputValue(k).trim();
    if(kind==='embedform') {
      const d=item(i,'embed',id),e=d.embed;
      if(action==='text') {
        for(const key of ['title','description']) {const v=read(key);if(v)e[key]=v;else delete e[key];}
        const color=read('color');if(color && !/^[\da-f]{6}$/i.test(color)) throw Error('Color must be six hexadecimal characters.');
        if(color)e.color=parseInt(color,16);else delete e.color;d.content=read('content');
      } else if(action==='media') {
        for(const key of ['url','image','thumbnail']) {const v=read(key);if(v)e[key]=key==='url'?webUrl(v):{url:webUrl(v)};else delete e[key];}
      } else if(action==='field') {
        e.fields ||= [];const field={name:read('name'),value:read('value'),inline:read('inline').toLowerCase()==='yes'};
        const number=read('number');if(number) {const n=Number(number);if(!Number.isInteger(n)||n<1||n>e.fields.length)throw Error('Choose an existing field number.');e.fields[n-1]=field;} else e.fields.push(field);
      } else if(action==='branding') {
        const author=read('author');if(author) {e.author={name:author};if(read('authorurl'))e.author.url=webUrl(read('authorurl'));if(read('icon'))e.author.icon_url=webUrl(read('icon'));} else delete e.author;
        const footer=read('footer');if(footer)e.footer={text:footer};else delete e.footer;
      }
      validateEmbed(d);new EmbedBuilder(e).toJSON();store.put(i.guildId,'embed',d);
      if(i.isFromMessage())return updateResponse(i,editor(d));
      return respond(i,{...editor(d),flags:MessageFlags.Ephemeral});
    }
    if(kind==='eventform') {
      let e=item(i,'event',id);await destination(i,e.channel,{privateOnly:e.kind!=='event'});
      e=item(i,'event',id);
      if(e.cancelled || e.complete) throw Error('Create a new event instead of editing a cancelled or completed event.');
      const start=parseTime(read('start'),e.zone);if(start<=Date.now())throw Error('Choose a future start time.');
      e.title=read('title');e.description=read('description');e.location=read('location');e.start=start;e.rsvps={};store.put(i.guildId,'event',e);
      return respond(i,{...eventView(e),flags:MessageFlags.Ephemeral});
    }
    throw Error('This form is no longer available.');
  }
  if(!i.isChatInputCommand())return;
  const name=i.commandName,sub=i.options.getSubcommand(false),opt=i.options;
  if(name==='help')return respond(i,helpMenu(helpOptions()));
  if(name==='settings') {
    if(!i.memberPermissions.has(P.ManageGuild))throw Error('Settings require Manage Server.');
    const s=settings(i.guildId);
    if(sub==='timezone')s.zone=zone(opt.getString('zone'));
    if(sub==='staff')s.staff=opt.getRole('role').id;
    if(sub==='clear-staff')delete s.staff;
    if(sub==='status') {
      const issues=store.problems(i.guildId).map(p=>`${p.state}: ${p.key.slice(0,120)}`);
      for(const e of store.list(i.guildId,'event'))if(e.error)issues.push(`Event ${e.id}: ${e.error}`);
      for(const f of store.list(i.guildId,'feed'))if(f.error)issues.push(`Feed ${f.id}: ${f.error}`);
      return respond(i,privateReply(issues.length?issues.join('\n').slice(0,1900):'No recent recorded delivery problems.'));
    }
    store.put(i.guildId,'settings',s);return respond(i,privateReply(`Timezone: ${s.zone}\nAdditional staff role: ${s.staff?'<@&'+s.staff+'>':'none'}`));
  }
  if(name==='embed') {
    needStaff(i);
    if(sub==='create') {
      if(store.list(i.guildId,'embed').length>=100)throw Error('Limit: 100 saved embeds per server.');
      const d=store.put(i.guildId,'embed',{name:opt.getString('name'),owner:i.user.id,embed:{description:'Your embed text goes here.',color:0xe5a1b3},content:''});
      return respond(i,{...editor(d),flags:MessageFlags.Ephemeral});
    }
    if(sub==='list')return respond(i,privateReply(store.list(i.guildId,'embed').map(d=>`\`${d.id}\` ${d.name}`).join('\n').slice(0,1900)||'No saved embeds. Use /embed create.'));
    const d=item(i,'embed',opt.getString('id'));
    if(sub==='edit')return respond(i,{...editor(d),flags:MessageFlags.Ephemeral});
    if(sub==='delete') {store.remove(i.guildId,'embed',d.id);return respond(i,privateReply('Embed deleted.'));}
    if(sub==='remove-field') {const n=opt.getInteger('number');if(!d.embed.fields?.[n-1])throw Error('That field number does not exist.');d.embed.fields.splice(n-1,1);validateEmbed(d);store.put(i.guildId,'embed',d);return respond(i,{...editor(d),flags:MessageFlags.Ephemeral});}
    if(sub==='send') {
      await acknowledge(i);
      const channel=await destination(i,opt.getChannel('channel').id);const role=await pingRole(i,opt.getRole('role')?.id,channel),user=opt.getUser('user')?.id;
      if(user)await i.guild.members.fetch(user).catch(()=>{throw Error('Choose a member of this server.');});
      validateEmbed(d);
      const message=await channel.send({content:[role?`<@&${role}>`:'',user?`<@${user}>`:'',d.content].filter(Boolean).join(' '),embeds:[new EmbedBuilder(d.embed)],allowedMentions:{parse:[],roles:role?[role]:[],users:user?[user]:[]}});
      return i.editReply({content:`Published: ${message.url}`});
    }
  }
  if(name==='schedule') {
    if(sub==='list') {
      await acknowledge(i);
      const events=[];
      for(const e of store.list(i.guildId,'event').filter(e=>!e.cancelled && !e.complete && e.start+e.duration*60000>Date.now()).sort((a,b)=>a.start-b.start)) {
        try {await destination(i,e.channel,{writing:false});events.push(e);} catch {}
      }
      const page=opt.getInteger('page')||1,total=Math.max(1,Math.ceil(events.length/5));
      return i.editReply({content:`**Upcoming · page ${page}/${total}**\n`+(events.slice((page-1)*5,page*5).map(e=>`\`${e.id}\` **${e.title}** · <t:${Math.floor(e.start/1000)}:F> · <#${e.channel}>`).join('\n')||'No events on this page.'),allowedMentions:{parse:[]}});
    }
    if(sub==='show') {const e=item(i,'event',opt.getString('id'));await destination(i,e.channel,{writing:false});return respond(i,{...eventView(e),flags:MessageFlags.Ephemeral});}
    needStaff(i);
    if(sub==='add') {
      await acknowledge(i);
      if(store.list(i.guildId,'event').filter(e=>!e.complete&&!e.cancelled).length>=200)throw Error('Limit: 200 active schedules per server.');
      const kind=opt.getString('kind')||'event',repeat=opt.getString('repeat')||'none',timezone=zone(opt.getString('zone')||settings(i.guildId).zone);
      const channel=await destination(i,opt.getChannel('channel').id,{privateOnly:kind!=='event'});
      const start=parseTime(opt.getString('start'),timezone);if(start<=Date.now())throw Error('Choose a future start time.');
      const raw=opt.getString('assignees')||'';const assignees=raw.split(/[\s,]+/).filter(Boolean).map(v=>v.replace(/^<@!?|>$/g,''));
      if(assignees.length>30 || assignees.some(v=>!/^\d{17,20}$/.test(v)))throw Error('Use up to 30 valid user IDs or @mentions.');
      if(kind==='rotation' && (!assignees.length || repeat==='none'))throw Error('A rotation needs assignees and daily or weekly recurrence.');
      for(const id of assignees)await i.guild.members.fetch(id).catch(()=>{throw Error('One of the assignees is not a server member.');});
      const duration=opt.getInteger('duration')||60;
      if((repeat==='daily' && duration>=1440)||(repeat==='weekly' && duration>=10080))throw Error('Duration must be shorter than the recurrence interval.');
      const e=store.put(i.guildId,'event',{title:opt.getString('title'),description:opt.getString('description')||'',location:opt.getString('location')||'',channel:channel.id,start,zone:timezone,kind,repeat,duration,reminder:opt.getInteger('reminder')??30,role:await pingRole(i,opt.getRole('role')?.id,channel),assignees,rotationIndex:0,rsvps:{}});
      return i.editReply(eventView(e));
    }
    const e=item(i,'event',opt.getString('id'));
    if(sub==='edit')checkDestination(i,i.guild.channels.cache?.get(e.channel),{privateOnly:e.kind!=='event'});
    else await destination(i,e.channel,{privateOnly:e.kind!=='event'});
    if(sub==='post') {await acknowledge(i);const channel=await destination(i,e.channel);const sent=await channel.send(eventView(e));return i.editReply({content:`Event card posted: ${sent.url}`});}
    if(sub==='configure') {
      if(e.cancelled||e.complete)throw Error('This event is no longer active.');
      e.repeat=opt.getString('repeat')??e.repeat;e.duration=opt.getInteger('duration')??e.duration;e.reminder=opt.getInteger('reminder')??e.reminder;
      if(e.kind==='rotation'&&e.repeat==='none')throw Error('A rotation requires recurrence.');
      if((e.repeat==='daily'&&e.duration>=1440)||(e.repeat==='weekly'&&e.duration>=10080))throw Error('Duration must be shorter than recurrence.');
      store.put(i.guildId,'event',e);return respond(i,{...eventView(e),flags:MessageFlags.Ephemeral});
    }
    if(sub==='cancel') {e.cancelled=true;store.put(i.guildId,'event',e);return respond(i,privateReply('Event and future occurrences cancelled.'));}
    if(sub==='edit')return i.showModal(modal(`eventform:${e.id}:edit`,'Number One · Edit schedule',[
      ['title','Title',e.title,150,true],['start',`Local start (${e.zone})`.slice(0,45),DateTime.fromMillis(e.start,{zone:e.zone}).toISO({suppressMilliseconds:true}),40,true],['description','Description',e.description,2000],['location','Location',e.location,300]
    ]));
  }
  if(name==='feed') {
    needStaff(i);await acknowledge(i);
    if(sub==='list')return i.editReply({content:store.list(i.guildId,'feed').map(f=>`\`${f.id}\` **${f.name}** → <#${f.channel}> · ${f.paused?'paused':'weekly: Sunday 00:00 America/New_York'} · ${f.pending?.length||0} queued${f.error?' · '+f.error:''}`).join('\n').slice(0,1900)||'No feeds. Instagram requires an external RSS/Atom provider; profile links do not work.',allowedMentions:{parse:[]}});
    if(sub==='add') {
      if(store.list(i.guildId,'feed').length>=10)throw Error('Limit: 10 feeds per server.');
      const channel=await destination(i,opt.getChannel('channel').id),url=opt.getString('url');
      if(store.list(i.guildId,'feed').some(f=>f.url===url && f.channel===channel.id))throw Error('That feed is already subscribed in that channel.');
      const items=await loadFeed(url);
      const now=Date.now();
      const f=store.put(i.guildId,'feed',{name:opt.getString('name'),url,channel:channel.id,role:await pingRole(i,opt.getRole('role')?.id,channel),seen:items.map(x=>x.key),pending:[],paused:false,checked:now,nextCheck:now+86400000,nextDigest:nextDigest(now)});
      return i.editReply({content:`Feed saved: ${f.id}. New posts are collected daily and sent together Sunday at 12:00 a.m. America/New_York. First batch: <t:${Math.floor(f.nextDigest/1000)}:F>. Existing entries were marked as seen.`});
    }
    const f=item(i,'feed',opt.getString('id'));await destination(i,f.channel);
    if(sub==='remove') {store.remove(i.guildId,'feed',f.id);return i.editReply({content:'Subscription removed.'});}
    if(sub==='preview') {const items=await loadFeed(f.url);if(!items.length)throw Error('This feed has no supported items.');return i.editReply({...feedMessage(f,items[0]),allowedMentions:{parse:[]}});}
    f.paused=sub==='pause';if(!f.paused)f.nextCheck=0;store.put(i.guildId,'feed',f);return i.editReply({content:f.paused?'Feed paused.':'Feed resumed. Collected posts will be included in the next weekly batch; an overdue batch may post now.'});
  }
  throw Error('This command has changed or is unavailable. Use /help for current commands.');
}

async function dispatch(i) {
  if(!i.isChatInputCommand()&&!i.isButton()&&!i.isModalSubmit()&&!i.isStringSelectMenu?.())return;
  console.log(`Received ${i.isChatInputCommand()?'/'+i.commandName:'component'}${i.createdTimestamp?` (${Math.max(0,Date.now()-i.createdTimestamp)}ms old)`:''}`);
  try {await handle(i);} catch(error) {
    await reportFailure(i,error);
  }
}
client.on('interactionCreate',dispatch);
let stopWorker;
client.once('clientReady',()=>{console.log(`Number One is online as ${client.user.tag}. Slash commands only. ${client.guilds.cache.size} server(s).`);stopWorker=startWorker(client,store);});
client.on('error',error=>console.error(`Discord client error (${error.code || error.name}): ${safeError(error)}`));
client.on('guildDelete',guild=>console.log(`Removed from server ${guild.id}; saved data retained for operator-managed deletion.`));
return {handle,dispatch,stop:()=>stopWorker?.()};
}
