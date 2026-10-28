// Website editors reuse the bot's records. Saving a draft never sends a message.
import {DateTime,IANAZone} from 'luxon';
import {PermissionFlagsBits as P} from 'discord.js';
import {assert,Fault} from '../age-verification/core.js';
import {DEFAULT_ZONE,parseTime,parseColor,validateEmbed} from './domain.js';
import {allowedUrl,loadFeed} from './feeds.js';
import {deliveryLabel,nextDigest} from './weekly-feeds.js';

const names=['embeds','scheduler','instagram'];
const object=(v,allowed)=>assert(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k)),400,'Unsupported fields.');
const string=(v,max,label,{empty=false}={})=>{assert(typeof v==='string'&&v.length<=max&&(empty||v.trim()),400,`Enter ${label}${empty?'':` (up to ${max} characters)`}.`);return v.trim();};
const number=(v,min,max,label)=>{assert(Number.isInteger(v)&&v>=min&&v<=max,400,`${label} must be ${min} to ${max}.`);return v;};
const convert=fn=>{try{return fn();}catch(e){if(e?.name==='UserError')throw new Fault(400,e.message);throw e;}};

export function createDashboardFeatures({store,client=null,authorize=null,load=loadFeed,timeoutMs=8000,now=Date.now}={}){
  const cached=id=>client?.guilds?.cache?.get?.(id);
  const visible=(guild,id,identity)=>!!(identity?.owner||identity?.securityAdmin||identity?.demo||identity?.member&&cached(guild)?.channels?.cache?.get?.(id)?.permissionsFor?.(identity.member)?.has(P.ViewChannel));
  const timezone=guild=>store.get(guild,'settings','main')?.zone||DEFAULT_ZONE;
  const channels=guild=>[...(cached(guild)?.channels?.cache?.values?.()||[])].filter(c=>[0,5].includes(c.type)).map(c=>({id:c.id,name:String(c.name).slice(0,100)}));
  const label=(guild,id)=>id?{id,name:cached(guild)?.channels?.cache?.get?.(id)?.name||null}:null;
  const get=(guild,kind,id)=>{assert(typeof id==='string'&&id.length<=100,400,'Choose a saved item.');const saved=store.get(guild,kind,id);assert(saved,404,'That saved item is no longer available in this server.');return saved;};
  function view(guild,name,identity){
    if(name==='embeds')return {editable:true,limit:100,items:store.list(guild,'embed').map(d=>({id:d.id,name:String(d.name||'Untitled').slice(0,80),content:d.content||'',embed:d.embed||{},title:d.embed?.title||'',updatedAt:d.updatedAt||null}))};
    if(name==='scheduler')return {editable:true,limit:200,timezone:timezone(guild),channels:channels(guild).filter(c=>visible(guild,c.id,identity)),items:store.list(guild,'event').filter(e=>visible(guild,e.channel,identity)&&!e.cancelled&&!e.complete&&e.start+e.duration*60000>now()).sort((a,b)=>a.start-b.start).map(e=>({id:e.id,title:e.title,description:e.description||'',location:e.location||'',start:e.start,startLocal:DateTime.fromMillis(e.start,{zone:e.zone}).toFormat("yyyy-MM-dd'T'HH:mm"),zone:e.zone,kind:e.kind||'event',repeat:e.repeat||'none',duration:e.duration,reminder:e.reminder??30,channel:label(guild,e.channel),assignees:e.assignees||[],needsAttention:!!e.error}))};
    if(name==='instagram')return {editable:true,limit:10,timezone:timezone(guild),channels:channels(guild).filter(c=>visible(guild,c.id,identity)),items:store.list(guild,'feed').filter(f=>visible(guild,f.channel,identity)).map(f=>({id:f.id,name:f.name,channel:label(guild,f.channel),paused:!!f.paused,schedule:deliveryLabel(f),waiting:f.pending?.length||0,needsAttention:!!f.error,delivery:f.delivery||'weekly',zone:f.zone||DEFAULT_ZONE,time:f.time||'00:00',weekday:f.weekday||7,showPreviews:!!f.showPreviews,hasNotifications:!!f.role,inProgress:!!f.batch}))};
    return null;
  }
  async function update(guild,name,data,identity){
    assert(names.includes(name),404,'Unknown feature.');
    assert(identity?.owner||identity?.dashboard,403,'Dashboard access is required to manage this server.');
    object(data,name==='embeds'?['save','copy','delete']:name==='scheduler'?['save','cancel']:['save','pause','resume','remove']);
    assert(Object.keys(data).length===1,400,'Make one change at a time.');
    const existingId=data.save?.id||data.cancel||data.pause||data.resume||data.remove;
    if(name!=='embeds'&&existingId){const saved=get(guild,name==='scheduler'?'event':'feed',existingId);assert(visible(guild,saved.channel,identity),403,'You cannot access this saved item’s channel.');}
    const deadline=now()+timeoutMs;
    async function bounded(work){
      let timer;
      try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Fault(504,'This request took too long. No changes were saved.')),Math.max(1,deadline-now()));})]);}
      catch(e){if(e instanceof Fault)throw e;if(e?.name==='UserError')throw new Fault(400,e.message);throw new Fault(502,'Could not check the server or source. No changes were saved.');}
      finally{clearTimeout(timer);}
    }
    async function recheck(){
      if(authorize)return bounded(()=>authorize(guild,identity));
      if(identity.reauthorize)return bounded(()=>identity.reauthorize());
      // Callers performing async work must provide a fresh authorization check.
      throw new Fault(503,'Server access could not be checked. No changes were saved.');
    }
    async function destination(id,{privateOnly=false,people=[],role=null}={}){
      const g=cached(guild);assert(g,503,'The bot must be online and in this server to save a schedule or source.');
      const c=g.channels?.cache?.get?.(id);assert(c&&[0,5].includes(c.type),400,'Choose a text or announcement channel in this server.');
      const member=await bounded(()=>g.members.fetch({user:identity.id,force:true}));
      assert(c.permissionsFor?.(member)?.has([P.ViewChannel,P.SendMessages]),403,'Choose a channel you can view and send messages in.');
      assert(c.permissionsFor?.(g.members.me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]),400,'The bot needs View Channel, Send Messages and Embed Links in that channel.');
      assert(!privateOnly||!c.permissionsFor?.(g.roles.everyone)?.has(P.ViewChannel),400,'Choose a staff-only channel hidden from @everyone for meetings and rotations.');
      if(role){
        const r=g.roles.cache?.get?.(role);assert(r&&r.id!==guild&&!r.managed,400,'The saved notification role is no longer available. Change it in Discord before saving.');
        assert(r.mentionable||c.permissionsFor(member)?.has(P.MentionEveryone)&&c.permissionsFor(g.members.me)?.has(P.MentionEveryone),403,'You and the bot need permission to notify the saved role in this channel.');
      }
      for(const user of people){const person=await bounded(()=>g.members.fetch({user,force:true}));assert(person?.id===user,400,'Choose current server members for the rotation.');}
      return c;
    }
    if(name==='embeds'){
      if(data.delete)store.remove(guild,'embed',get(guild,'embed',data.delete).id);
      else if(data.copy){
        const saved=get(guild,'embed',data.copy);assert(store.list(guild,'embed').length<100,400,'There are already 100 saved messages. Delete one before creating another.');
        const {id,sendChannel,sendRole,sendUser,...draft}=saved;
        store.put(guild,'embed',{...draft,name:(saved.name+' (copy)').slice(0,80),owner:identity.id,updatedAt:now()});
      }else{
        const s=data.save;object(s,['id','name','title','description','color','content']);
        const old=s.id?get(guild,'embed',s.id):null;
        assert(old||store.list(guild,'embed').length<100,400,'There are already 100 saved messages. Delete one before creating another.');
        const draft={...old,name:string(s.name,80,'a draft name'),owner:old?.owner||identity.id,content:string(s.content??'',1800,'the accompanying message',{empty:true}),embed:{...old?.embed,title:string(s.title??'',256,'the title',{empty:true}),description:string(s.description??'',4096,'the message text',{empty:true})},updatedAt:now()};
        if(s.color)draft.embed.color=convert(()=>parseColor(string(s.color,20,'a color')));else delete draft.embed.color;
        convert(()=>validateEmbed(draft));store.put(guild,'embed',draft);
      }
    }
    if(name==='scheduler'){
      if(data.cancel){const old=get(guild,'event',data.cancel);store.put(guild,'event',{...old,cancelled:true});}
      else{
        const s=data.save;object(s,['id','title','start','zone','channel','kind','repeat','duration','reminder','description','location','people']);
        const old=s.id?get(guild,'event',s.id):null;assert(!old||!old.complete&&!old.cancelled,409,'This event is no longer active.');
        const title=string(s.title,150,'an event title'),zone=s.zone||old?.zone||timezone(guild);assert(typeof zone==='string'&&IANAZone.isValidZone(zone),400,'Choose a valid timezone.');
        const start=convert(()=>parseTime(string(s.start,40,'a start date and time'),zone));assert(start>now(),400,'Choose a future start time.');
        const kind=s.kind||old?.kind||'event',repeat=s.repeat||old?.repeat||'none';assert(['event','staff-meeting','rotation'].includes(kind)&&['none','daily','weekly'].includes(repeat),400,'Choose a valid event type and repeat schedule.');
        const duration=number(s.duration??60,1,10080,'Duration'),reminder=number(s.reminder??30,0,10080,'Reminder');
        assert(!(repeat==='daily'&&duration>=1440||repeat==='weekly'&&duration>=10080),400,'The event must end before its next repeat begins.');
        const people=string(s.people??(old?.assignees||[]).join(' '),1000,'the rotation members',{empty:true}).split(/[\s,]+/).filter(Boolean).map(v=>v.replace(/^<@!?|>$/g,''));
        assert(people.length<=30&&people.every(v=>/^\d{17,20}$/.test(v)),400,'Enter up to 30 Discord member IDs in rotation order.');
        assert(kind!=='rotation'||people.length&&repeat!=='none',400,'A rotation needs members and a daily or weekly repeat.');
        const description=string(s.description??'',2000,'the description',{empty:true}),location=string(s.location??'',300,'the location',{empty:true});
        const channel=string(s.channel,20,'a channel');await destination(channel,{privateOnly:kind!=='event',people:kind==='rotation'?people:[],role:old?.role});await recheck();
        const latest=old?get(guild,'event',old.id):null;assert(!latest||!latest.complete&&!latest.cancelled&&JSON.stringify(latest)===JSON.stringify(old),409,'This event changed while you were editing. Reload it before saving.');
        assert(latest||store.list(guild,'event').filter(e=>!e.cancelled&&!e.complete).length<200,400,'There are already 200 active events. Cancel one before adding another.');
        // Timing changes must not race a delivery already claimed for this occurrence.
        assert(!latest||!store.delivery(`event:${guild}:${latest.id}:${latest.start}`),409,'This event reminder has already started. Create a new event for a different time.');
        store.put(guild,'event',{...latest,title,description,location,channel,start,zone,kind,repeat,duration,reminder,assignees:kind==='rotation'?people:[],rotationIndex:latest?.rotationIndex||0,rsvps:{},updatedBy:identity.id,updatedAt:now()});
      }
    }
    if(name==='instagram'){
      if(data.remove)store.remove(guild,'feed',get(guild,'feed',data.remove).id);
      else if(data.pause||data.resume){const f=get(guild,'feed',data.pause||data.resume);assert(!data.resume||!f.batch,409,'This roundup has an unfinished delivery. Check its channel before resuming it.');store.put(guild,'feed',{...f,paused:!!data.pause,settingsVersion:(f.settingsVersion||0)+1,...(data.resume?{nextCheck:0}:{})});}
      else{
        const s=data.save;object(s,['id','name','url','channel','zone','time','weekday','delivery','showPreviews']);
        const old=s.id?get(guild,'feed',s.id):null;assert(!old?.batch,409,'This roundup has an unfinished delivery. Check its channel before changing it.');
        const name=string(s.name,80,'a source name'),url=convert(()=>allowedUrl(string(s.url||old?.url,1500,'an RSS or Atom feed link'))).href;
        const zone=s.zone||old?.zone||timezone(guild),time=s.time||old?.time||'09:00',weekday=s.weekday??old?.weekday??7,delivery=s.delivery||old?.delivery||'weekly';
        assert(typeof zone==='string'&&IANAZone.isValidZone(zone),400,'Choose a valid timezone.');assert(typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time),400,'Choose a delivery time using the 24-hour clock.');number(weekday,1,7,'Weekday');assert(['daily','weekly'].includes(delivery),400,'Choose daily or weekly delivery.');assert(s.showPreviews===undefined||typeof s.showPreviews==='boolean',400,'Choose on or off for link previews.');
        const changed=!old||old.url!==url;assert(!changed||!old?.pending?.length,409,'This source has waiting posts. Keep its feed link or add a separate source.');
        const channel=string(s.channel,20,'a channel');await destination(channel,{role:old?.role});
        const items=changed?await bounded(()=>load(url)):null;await recheck();
        const latest=old?get(guild,'feed',old.id):null;
        assert(!latest||!latest.batch&&(latest.settingsVersion||0)===(old.settingsVersion||0),409,'This source changed while you were editing. Reload it before saving.');
        assert(!changed||!latest?.pending?.length,409,'New posts arrived while you were editing. Keep the existing link or add a separate source.');
        const sources=store.list(guild,'feed');assert(latest||sources.length<10,400,'There are already 10 sources. Remove one before adding another.');assert(!sources.some(f=>f.id!==old?.id&&f.url===url&&f.channel===channel),400,'This source already posts in that channel. Edit the existing source.');
        const f={...latest,name,url,channel,zone,time,weekday,delivery,showPreviews:s.showPreviews??old?.showPreviews??false,paused:latest?.paused||false,settingsVersion:(latest?.settingsVersion||0)+1,updatedBy:identity.id,updatedAt:now()};
        if(changed)Object.assign(f,{seen:items.map(i=>i.key),pending:[],checked:now(),nextCheck:now()+86400000,collectionFailed:false,error:null});
        if(!latest||['zone','time','weekday','delivery'].some(k=>f[k]!==latest[k])||!Number.isFinite(f.nextDigest))f.nextDigest=nextDigest(now(),f);
        store.put(guild,'feed',f);
      }
    }
    return view(guild,name,identity);
  }
  return {view,update};
}
