import {ModalBuilder,ActionRowBuilder,TextInputBuilder,TextInputStyle,MessageFlags} from 'discord.js';
import {DateTime} from 'luxon';
import {UserError} from './user-error.js';
import {respond,acknowledge,step,updateResponse,showForm,withDeadline} from './responses.js';
import {allowedUrl,loadFeed} from './feeds.js';
import {nextDigest,deliveryLabel,digestParts,DIGEST_ZONE} from './weekly-feeds.js';

const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const row=(...components)=>({type:1,components});
const clean=value=>String(value).replace(/[\\*_~`|<>@\[\]]/g,'');
export function instagramZone(text) {
  const value=text.trim();
  if(DateTime.now().setZone(value).isValid)return DateTime.now().setZone(value).zoneName;
  const normalize=s=>s.toLowerCase().replace(/[_\s]/g,'');
  const matches=Intl.supportedValuesOf('timeZone').filter(z=>normalize(z.split('/').at(-1))===normalize(value));
  if(matches.length===1)return matches[0];
  throw new UserError('Enter a timezone such as Europe/London, Asia/Seoul, America/Los_Angeles, or UTC. You can also enter a city such as London or Seoul.');
}
export function scheduleFields(values) {
  const zone=instagramZone(values.zone),time=values.time.trim();
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new UserError('Enter the delivery time using a 24-hour clock, such as 09:00 or 21:30.');
  const weekday=days.findIndex(d=>d.toLowerCase()===values.day.trim().toLowerCase());
  if(weekday<0)throw new UserError('Enter a day of the week, such as Sunday or Monday. This is used for weekly delivery.');
  const previews=values.previews.trim().toLowerCase();
  if(!['yes','no'].includes(previews))throw new UserError('For link previews, enter yes or no.');
  return {zone,time,weekday:weekday+1,showPreviews:previews==='yes'};
}
export function instagramPanel(d,sources,notice='') {
  const prefix=`instagram:${d.id}:`;
  return {content:notice,embeds:[{color:0xe5a1b3,title:'Instagram · Set up posts',description:'Choose a source, channel, and delivery schedule below. Changes take effect when you choose **Save**. Each server manages its own setup—no bot-owner approval is needed.',fields:[
    {name:'Source',value:clean(d.name||'Not added yet')},
    {name:'Post in',value:d.channel?`<#${d.channel}>`:'Choose a channel below',inline:true},
    {name:'Notify',value:d.role?`<@&${d.role}>`:'No role notification',inline:true},
    {name:'Delivery',value:deliveryLabel(d)},
    {name:'Link previews',value:d.showPreviews?'On':'Off',inline:true},
    {name:'Following public Instagram accounts',value:'In **Source**, paste an RSS/Atom link from an Instagram feed service. A profile link alone will not work. Posts and stories depend on what that service provides. Empty roundups are skipped.'}
  ],footer:{text:'Private setup · Only you can use this menu · Expires after 30 minutes'}}],allowedMentions:{parse:[]},components:[
    row({type:3,custom_id:prefix+'choose',placeholder:'Add a source or manage an existing one',options:[{label:'＋ Add a new source',value:'new',default:!d.sourceId},...sources.map(f=>({label:String(f.name).slice(0,100),value:f.id,description:f.paused?'Paused':'Active',default:f.id===d.sourceId}))]}),
    row({type:8,custom_id:prefix+'channel',placeholder:'Choose where Instagram posts go',channel_types:[0,5],min_values:1,max_values:1,...(d.channel?{default_values:[{id:d.channel,type:'channel'}]}:{})}),
    row({type:6,custom_id:prefix+'role',placeholder:'Optional: choose a role to notify (clear to disable)',min_values:0,max_values:1,...(d.role?{default_values:[{id:d.role,type:'role'}]}:{})}),
    row({type:3,custom_id:prefix+'delivery',placeholder:'How often should posts arrive?',options:[{label:'Weekly roundup',value:'weekly',description:'All new posts on your chosen day',default:d.delivery!=='daily'},{label:'Daily roundup',value:'daily',description:'New posts once a day at your chosen time',default:d.delivery==='daily'}]}),
    row(...[['source','Source',2],['schedule','Schedule',2],['preview','Preview',2],['save','Save',3],['close','Close',2]].map(([action,label,style])=>({type:2,custom_id:prefix+action,label,style})))
  ]};
}
function form(d,action) {
  const fields=action==='source'?[['name','Name, e.g. Rosé updates',d.name||'',80],['url','RSS / Atom feed link',d.url||'',1500]]:[['zone','City or timezone, e.g. Seoul or Europe/London',d.zone,80],['time','Delivery time · 24-hour clock, e.g. 09:00',d.time,5],['day','Weekly delivery day, e.g. Sunday',days[d.weekday-1],12],['previews','Show link previews? yes or no',d.showPreviews?'yes':'no',3]];
  return new ModalBuilder().setCustomId(`instagram:${d.id}:${action}form`).setTitle(action==='source'?'Instagram · Choose a source':'Instagram · Delivery schedule').addComponents(fields.map(([id,label,value,max])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setValue(value))));
}

export function createInstagramSetup({store,settings,needStaff,destination,pingRole,load=loadFeed}) {
  function draft(i,source) {
    const base=source?{sourceId:source.id,version:source.settingsVersion||0,name:source.name,url:source.url,channel:source.channel,role:source.role,zone:source.zone||DIGEST_ZONE,time:source.time||'00:00',weekday:source.weekday||7,delivery:source.delivery||'weekly',showPreviews:Boolean(source.showPreviews)}:{zone:settings(i.guildId).zone||'UTC',time:'09:00',weekday:7,delivery:'weekly',showPreviews:false};
    return store.put(i.guildId,'instagram-draft',{...base,owner:i.user.id,expiresAt:Date.now()+1800000});
  }
  const panel=(i,d,notice)=>{
    const payload=instagramPanel(d,store.list(i.guildId,'feed'),notice);
    if(i.guild?.channels.cache&&!i.guild.channels.cache.has(d.channel))delete payload.components[1].components[0].default_values;
    if(i.guild?.roles.cache&&!i.guild.roles.cache.has(d.role))delete payload.components[2].components[0].default_values;
    return payload;
  };
  function current(i,d) {
    const f=d.sourceId?store.get(i.guildId,'feed',d.sourceId):null;
    if(d.sourceId&&(!f||(f.settingsVersion||0)!==d.version))throw new UserError('This source changed while your menu was open. Open /instagram setup again to see the latest settings.');
    if(f?.batch)throw new UserError('This roundup is being delivered or needs review. Check its channel and /settings status before changing its setup.');
    return f;
  }
  return async function instagram(i) {
    const opens=i.isChatInputCommand()&&i.commandName==='instagram'&&i.options.getSubcommand(false)==='setup';
    if(!opens&&!i.customId?.startsWith('instagram:'))return false;
    needStaff(i);
    if(opens) {
      for(const old of store.list(i.guildId,'instagram-draft'))if(old.expiresAt<Date.now())store.remove(i.guildId,'instagram-draft',old.id);
      // One live menu per member prevents unbounded abandoned drafts.
      for(const old of store.list(i.guildId,'instagram-draft'))if(old.owner===i.user.id)store.remove(i.guildId,'instagram-draft',old.id);
      const d=draft(i);
      await respond(i,{...panel(i,d),flags:MessageFlags.Ephemeral});return true;
    }
    const [,id,action]=i.customId.split(':');
    let d=store.get(i.guildId,'instagram-draft',id);
    if(!d||d.owner!==i.user.id||d.expiresAt<Date.now())throw new UserError('This setup menu has expired or belongs to someone else. Open your own with /instagram setup.');
    if(action==='source'||action==='schedule'){await showForm(i,form(d,action));return true;}
    if(action==='preview') {
      await acknowledge(i);
      if(!d.url)throw new UserError('Choose Source and add your Instagram feed link first.');
      const items=await step(i,load(d.url));
      if(!items.length)throw new UserError('There are no posts to preview yet. You can still save this source.');
      const sample=digestParts({...d,role:null,name:d.name||'Instagram'},items.slice(0,3))[0];
      await respond(i,{...sample,flags:MessageFlags.Ephemeral,content:`**Sample roundup · Nothing has been posted or removed from your queue**\n${sample.content}`,allowedMentions:{parse:[]}});return true;
    }
    if(action==='close'){store.remove(i.guildId,'instagram-draft',d.id);await updateResponse(i,{content:'Setup closed. Your saved sources keep their existing settings.',embeds:[],components:[]});return true;}
    if(action==='choose') {
      const source=i.values[0]==='new'?null:store.get(i.guildId,'feed',i.values[0]);
      if(i.values[0]!=='new'&&!source)throw new UserError('That source was removed. Open /instagram setup again.');
      store.remove(i.guildId,'instagram-draft',d.id);d=draft(i,source);
    } else if(action==='channel')d.channel=i.values[0];
    else if(action==='role')d.role=i.values[0]||null;
    else if(action==='delivery') {
      if(!['daily','weekly'].includes(i.values[0]))throw new UserError('Choose daily or weekly delivery.');
      d.delivery=i.values[0];
    } else if(action==='sourceform') {
      const name=i.fields.getTextInputValue('name').trim(),url=allowedUrl(i.fields.getTextInputValue('url').trim()).href;
      if(!name||name.length>80)throw new UserError('Give this source a name with 1–80 characters.');
      Object.assign(d,{name,url});
    } else if(action==='scheduleform') {
      Object.assign(d,scheduleFields(Object.fromEntries(['zone','time','day','previews'].map(k=>[k,i.fields.getTextInputValue(k)]))));
    } else if(action==='save') {
      i.instagramSetupUpdate=true;
      await withDeadline(i.deferUpdate(),8000,'Discord did not accept the setup action.');
      if(!d.name||!d.url)throw new UserError('Choose Source to add a name and feed link before saving.');
      if(!d.channel)throw new UserError('Choose a channel from the menu before saving.');
      current(i,d);
      const channel=await destination(i,d.channel),role=await pingRole(i,d.role,channel);
      let old=current(i,d);
      const changed=!old||old.url!==d.url;
      if(changed&&old?.pending?.length)throw new UserError('This source still has posts waiting. Keep its feed link until the roundup is delivered, or add a separate source.');
      const items=changed?await step(i,load(d.url)):null;
      needStaff(i);
      old=current(i,d);
      if(changed&&old?.pending?.length)throw new UserError('New posts arrived while you were editing. Keep this feed link and add a separate source.');
      const sources=store.list(i.guildId,'feed');
      if(!old&&sources.length>=10)throw new UserError('You already follow 10 sources. Remove one before adding another.');
      if(sources.some(f=>f.id!==old?.id&&f.url===d.url&&f.channel===d.channel))throw new UserError('This source already posts in that channel. Choose it from the top menu to change its settings.');
      const now=Date.now(),scheduleChanged=!old||['zone','time','weekday','delivery'].some(k=>old[k]!==d[k]);
      const f={...old,name:d.name,url:d.url,channel:d.channel,role,zone:d.zone,time:d.time,weekday:d.weekday,delivery:d.delivery,showPreviews:d.showPreviews,settingsVersion:(old?.settingsVersion||0)+1};
      if(changed)Object.assign(f,{seen:items.map(x=>x.key),pending:[],checked:now,nextCheck:now+86400000,collectionFailed:false,error:null});
      f.paused=old?.paused||false;
      if(scheduleChanged||!Number.isFinite(f.nextDigest))f.nextDigest=nextDigest(now,f);
      store.put(i.guildId,'feed',f);
      d.sourceId=f.id;d.version=f.settingsVersion;
      store.put(i.guildId,'instagram-draft',d);
      await respond(i,panel(i,d,`Saved! ${f.paused?'This source remains paused. Resume it with /instagram resume.':`Next roundup: <t:${Math.floor(f.nextDigest/1000)}:F>.`} ${changed?'Only new posts will be collected; older posts will not be resent.':'Waiting posts are preserved.'}`));return true;
    } else throw new UserError('This control is no longer available. Open /instagram setup again.');
    store.put(i.guildId,'instagram-draft',d);await updateResponse(i,panel(i,d,'Changes are ready to review. Choose Save to apply them.'));return true;
  };
}
