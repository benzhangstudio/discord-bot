import {DateTime} from 'luxon';
import {loadFeed} from './feeds.js';
import {pluginEnabled} from './plugins.js';
import {withDeadline} from './responses.js';
export const DIGEST_ZONE='America/New_York';
const DAY=86400000;

// Sunday 00:00 means the beginning of Sunday, following the local calendar.
export function nextDigest(now,feed={}) {
  const local=DateTime.fromMillis(now,{zone:feed.zone||DIGEST_ZONE});
  const [hour,minute]=(feed.time||'00:00').split(':').map(Number);
  const daily=feed.delivery==='daily',weekday=feed.weekday||7;
  let day=local.startOf('day').plus({days:daily?0:(weekday-local.weekday+7)%7});
  let next=day.set({hour,minute});
  if(next.toMillis()<=now){day=day.plus({days:daily?1:7});next=day.set({hour,minute});}
  return next.toMillis();
}
export function deliveryLabel(feed) {
  const day=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][(feed.weekday||7)-1];
  return `${feed.delivery==='daily'?'Every day':`Every ${day}`} at ${feed.time||'00:00'} · ${feed.zone||DIGEST_ZONE}`;
}
export function digestParts(feed,items) {
  const clean=text=>String(text).replace(/[\\*_~`|<>@\[\]]/g,'');
  const header=`**${clean(feed.name)} · ${feed.delivery==='daily'?'Daily':'Weekly'} posts**\n`;
  const parts=[];let content=header;
  for(const item of items) {
    const url=new URL(item.link);
    if(!['http:','https:'].includes(url.protocol))continue;
    const line=`• ${clean(item.title).slice(0,200)}\n${feed.showPreviews?url.href:`<${url.href}>`}\n`;
    if(line.length>1700)throw Error('A post link is too long to include in the weekly batch.');
    if(content.length+line.length>1800){parts.push(content);content=header;}
    content+=line;
  }
  if(content!==header)parts.push(content);
  return parts.map((text,index)=>({content:`${index===0&&feed.role?`<@&${feed.role}>\n`:''}${text}`,allowedMentions:{parse:[],roles:index===0&&feed.role?[feed.role]:[],users:[]}}));
}
export async function processFeeds(client,store,now,{load=loadFeed,send}) {
  for(const saved of store.all('feed')) {
    let feed=store.get(saved.guild,'feed',saved.id);
    if(!feed || feed.paused || !pluginEnabled(store,saved.guild,'instagram'))continue;
    feed.nextDigest ??= nextDigest(now,feed);
    feed.pending ??= [];
    feed.nextCheck ??= (feed.checked || 0)+DAY;
    store.put(saved.guild,'feed',feed);
    const due=now>=feed.nextDigest;
    if(now>=feed.nextCheck || (due&&feed.digestCheckedFor!==feed.nextDigest)) {
      const version=feed.settingsVersion||0;
      try {
        const items=await withDeadline(load(feed.url),15000,'Feed loading timed out.');
        const current=store.get(saved.guild,'feed',feed.id);
        if(!current || current.paused || !pluginEnabled(store,saved.guild,'instagram') || (current.settingsVersion||0)!==version)continue;
        feed=current;
        const seen=new Set(feed.seen || []),pending=new Map((feed.pending || []).map(item=>[item.key,item]));
        for(const item of [...items].reverse())if(!seen.has(item.key)){pending.set(item.key,item);seen.add(item.key);}
        feed.pending=[...pending.values()];
        feed.seen=[...new Set([...items.map(item=>item.key),...seen])].slice(0,2000);
        feed.checked=now;feed.nextCheck=now+DAY;feed.collectionFailed=false;feed.error=null;
      } catch(error) {
        const current=store.get(saved.guild,'feed',feed.id);
        if(!current || current.paused || (current.settingsVersion||0)!==version)continue;
        feed=current;feed.error=error.message;feed.collectionFailed=true;feed.nextCheck=now+3600000;
      }
      if(due)feed.digestCheckedFor=feed.nextDigest;
      store.put(saved.guild,'feed',feed);
    }
    if(!due || feed.collectionFailed)continue;
    try {
      if(!feed.batch && feed.pending.length) {
        feed.batch={slot:feed.nextDigest,keys:feed.pending.map(item=>item.key),parts:digestParts(feed,feed.pending),part:0};
        store.put(saved.guild,'feed',feed);
      }
      if(feed.batch) {
        const channel=await withDeadline(client.channels.fetch(feed.channel),8000,'Roundup channel check timed out.');
        if(!channel || channel.guildId!==saved.guild || !channel.isTextBased())throw Error('Weekly batch channel unavailable.');
        while(feed.batch.part<feed.batch.parts.length) {
          const current=store.get(saved.guild,'feed',feed.id);
          if(!current || current.paused || !pluginEnabled(store,saved.guild,'instagram'))break;
          feed=current;
          const key=`digest:${saved.guild}:${feed.id}:${feed.batch.slot}:${feed.batch.part}`;
          try {
            const sent=await send(store,key,channel,feed.batch.parts[feed.batch.part]);
            if(!sent && store.delivery(key)?.state!=='sent')throw Error('Delivery is uncertain; check the channel before posting the batch manually.');
          } catch(error) {
            // A source may be removed or paused while a Discord send is pending.
            // Never recreate a removed source or overwrite more recent settings.
            const current=store.get(saved.guild,'feed',feed.id);
            if(current){current.paused=true;current.error=`Weekly batch paused: ${error.message}`;store.put(saved.guild,'feed',current);}
            throw error;
          }
          const latest=store.get(saved.guild,'feed',feed.id);
          if(!latest)break;
          feed=latest;feed.batch.part++;store.put(saved.guild,'feed',feed);
        }
        if(!store.get(saved.guild,'feed',feed.id) || feed.paused || feed.batch.part<feed.batch.parts.length)continue;
        const delivered=new Set(feed.batch.keys);feed.pending=feed.pending.filter(item=>!delivered.has(item.key));delete feed.batch;
      }
      feed.nextDigest=nextDigest(now,feed);store.put(saved.guild,'feed',feed);
    } catch(error) {
      const current=store.get(saved.guild,'feed',feed.id);
      if(current){current.error=error.message;store.put(saved.guild,'feed',current);}
      console.error(`Weekly feed ${feed.id}: ${error.name}`);
    }
  }
}
