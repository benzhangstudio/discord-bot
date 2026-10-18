import {rollForward,rotationMember} from './domain.js';
import {loadFeed,feedMessage} from './feeds.js';
import {PermissionFlagsBits as P} from 'discord.js';

export async function deliver(store,key,channel,payload) {
  if (!store.claim(key)) return false;
  try {const message=await channel.send({...payload,nonce: String((BigInt(Date.now())<<22n) + BigInt(Math.floor(Math.random()*4194304))),enforceNonce:true}); store.delivered(key,'sent',message.id); return true;}
  catch(error) {store.delivered(key,'failed',error.message); throw error;}
}
export function startWorker(client,store) {
  let running=false, lastFeed=0;
  const tick = async()=>{
    if(running) return; running=true;
    try {
      const now=Date.now();
      for(const event of store.all('event')) {
        if(event.cancelled || event.complete) continue;
        try {
          if(now>=event.start-event.reminder*60000 && now<=event.start+event.duration*60000) {
            const channel=await client.channels.fetch(event.channel);
            if(!channel || channel.guildId!==event.guild || !channel.isTextBased()) throw Error('Event channel unavailable.');
            if(event.kind!=='event' && channel.permissionsFor(channel.guild.roles.everyone)?.has(P.ViewChannel)) throw Error('Staff event channel is no longer private; delivery withheld.');
            const current=store.get(event.guild,'event',event.id);
            if(!current || current.cancelled || current.start!==event.start)continue;
            const person=rotationMember(event);
            const content=[event.role?`<@&${event.role}>`:'',person?`On duty: <@${person}>`:'',`**${event.title}**`, `<t:${Math.floor(event.start/1000)}:F> (<t:${Math.floor(event.start/1000)}:R>)`,event.description || '',event.location || ''].filter(Boolean).join('\n');
            await deliver(store,`event:${event.guild}:${event.id}:${event.start}`,channel,{content:content.slice(0,2000),allowedMentions:{parse:[],roles:event.role?[event.role]:[],users:person?[person]:[]},components:[{type:1,components:[{type:2,style:1,label:'Going',custom_id:`rsvp:${event.id}:${event.start}:going`},{type:2,style:2,label:'Maybe',custom_id:`rsvp:${event.id}:${event.start}:maybe`},{type:2,style:2,label:'Decline',custom_id:`rsvp:${event.id}:${event.start}:declined`}]}]});
          }
          if(now>event.start+event.duration*60000) {
            const current=store.get(event.guild,'event',event.id);
            if(!current || current.cancelled || current.start!==event.start)continue;
            const next=rollForward(event,now);
            if(next) {event.start=next.start; event.rotationIndex=(event.rotationIndex || 0)+next.count; event.rsvps={};} else event.complete=true;
            store.put(event.guild,'event',event);
          }
        } catch(error) {
          const current=store.get(event.guild,'event',event.id);
          if(current && current.start===event.start){current.error=error.message;store.put(event.guild,'event',current);}
          console.error(`Event ${event.id}: ${error.message}`);
        }
      }
      const period=Math.max(60,Number(process.env.FEED_POLL_SECONDS)||120)*1000;
      if(now-lastFeed>=period) {
        lastFeed=now;
        for(const feed of store.all('feed')) {
          if(feed.paused) continue;
          try {
            const items=await loadFeed(feed.url); const seen=new Set(feed.seen);
            const fresh=items.filter(item=>!seen.has(item.key)).reverse();
            const channel=await client.channels.fetch(feed.channel);
            if(!channel || channel.guildId!==feed.guild || !channel.isTextBased()) throw Error('Feed channel unavailable.');
            for(const item of fresh) {
              const current=store.get(feed.guild,'feed',feed.id);
              if(!current || current.paused)break;
              await deliver(store,`feed:${feed.guild}:${feed.id}:${item.key}`,channel,feedMessage(feed,item));
              seen.add(item.key);
            }
            feed.seen=[...new Set([...items.map(x=>x.key),...seen])].slice(0,1000);feed.checked=now;feed.error=null;
          } catch(error) {feed.error=error.message; console.error(`Feed ${feed.id}: ${error.message}`);}
          const current=store.get(feed.guild,'feed',feed.id);
          if(current)store.put(feed.guild,'feed',{...feed,paused:current.paused});
        }
      }
    } finally {running=false;}
  };
  const timer=setInterval(()=>tick().catch(error=>console.error(error.message)),15000);
  tick().catch(error=>console.error(error.message));
  return ()=>clearInterval(timer);
}
