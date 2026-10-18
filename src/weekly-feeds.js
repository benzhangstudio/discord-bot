import {DateTime} from 'luxon';
import {loadFeed} from './feeds.js';
export const DIGEST_ZONE='America/New_York';
const DAY=86400000;

// Sunday 00:00 means the beginning of Sunday, following the local calendar.
export function nextDigest(now) {
  const local=DateTime.fromMillis(now,{zone:DIGEST_ZONE});
  let sunday=local.startOf('day').plus({days:(7-local.weekday)%7});
  if(sunday.toMillis()<=now)sunday=sunday.plus({weeks:1});
  return sunday.toMillis();
}
export function digestParts(feed,items) {
  const clean=text=>String(text).replace(/[\\*_~`|<>@\[\]]/g,'');
  const header=`**${clean(feed.name)} · Weekly posts**\n`;
  const parts=[];let content=header;
  for(const item of items) {
    const url=new URL(item.link);
    if(!['http:','https:'].includes(url.protocol))continue;
    const line=`• ${clean(item.title).slice(0,200)}\n<${url.href}>\n`;
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
    if(!feed || feed.paused)continue;
    feed.nextDigest ??= nextDigest(now);
    feed.pending ??= [];
    feed.nextCheck ??= (feed.checked || 0)+DAY;
    store.put(saved.guild,'feed',feed);
    const due=now>=feed.nextDigest;
    if(now>=feed.nextCheck || (due&&feed.digestCheckedFor!==feed.nextDigest)) {
      try {
        const items=await load(feed.url);
        const current=store.get(saved.guild,'feed',feed.id);
        if(!current || current.paused)continue;
        feed=current;
        const seen=new Set(feed.seen || []),pending=new Map((feed.pending || []).map(item=>[item.key,item]));
        for(const item of [...items].reverse())if(!seen.has(item.key)){pending.set(item.key,item);seen.add(item.key);}
        feed.pending=[...pending.values()];
        feed.seen=[...new Set([...items.map(item=>item.key),...seen])].slice(0,2000);
        feed.checked=now;feed.nextCheck=now+DAY;feed.collectionFailed=false;feed.error=null;
      } catch(error) {
        const current=store.get(saved.guild,'feed',feed.id);
        if(!current)continue;
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
        const channel=await client.channels.fetch(feed.channel);
        if(!channel || channel.guildId!==saved.guild || !channel.isTextBased())throw Error('Weekly batch channel unavailable.');
        while(feed.batch.part<feed.batch.parts.length) {
          const current=store.get(saved.guild,'feed',feed.id);
          if(!current || current.paused)break;
          feed=current;
          const key=`digest:${saved.guild}:${feed.id}:${feed.batch.slot}:${feed.batch.part}`;
          try {
            const sent=await send(store,key,channel,feed.batch.parts[feed.batch.part]);
            if(!sent && store.delivery(key)?.state!=='sent')throw Error('Delivery is uncertain; check the channel before posting the batch manually.');
          } catch(error) {
            feed.paused=true;feed.error=`Weekly batch paused: ${error.message}`;store.put(saved.guild,'feed',feed);throw error;
          }
          const latest=store.get(saved.guild,'feed',feed.id);
          if(!latest)break;
          feed=latest;feed.batch.part++;store.put(saved.guild,'feed',feed);
        }
        if(!store.get(saved.guild,'feed',feed.id) || feed.paused || feed.batch.part<feed.batch.parts.length)continue;
        const delivered=new Set(feed.batch.keys);feed.pending=feed.pending.filter(item=>!delivered.has(item.key));delete feed.batch;
      }
      feed.nextDigest=nextDigest(now);store.put(saved.guild,'feed',feed);
    } catch(error) {
      const current=store.get(saved.guild,'feed',feed.id);
      if(current){current.error=error.message;store.put(saved.guild,'feed',current);}
      console.error(`Weekly feed ${feed.id}: ${error.name}`);
    }
  }
}
