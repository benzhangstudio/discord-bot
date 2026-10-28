import {rollForward,rotationMember} from './domain.js';
import {processFeeds} from './weekly-feeds.js';
import {PermissionFlagsBits as P} from 'discord.js';
import {pluginEnabled} from './plugins.js';
import {withDeadline} from './responses.js';

export async function deliver(store,key,channel,payload) {
  if (!store.claim(key)) return false;
  try {const message=await withDeadline(channel.send({...payload,nonce: String((BigInt(Date.now())<<22n) + BigInt(Math.floor(Math.random()*4194304))),enforceNonce:true}),15000,'Message delivery was not confirmed.'); store.delivered(key,'sent',message.id); return true;}
  catch(error) {store.delivered(key,'failed',error.message); throw error;}
}
export function startWorker(client,store) {
  let running=false;
  const tick = async()=>{
    if(running) return; running=true;
    try {
      const now=Date.now();
      for(const event of store.all('event')) {
        if(event.cancelled || event.complete || !pluginEnabled(store,event.guild,'scheduler')) continue;
        try {
          if(now>=event.start-event.reminder*60000 && now<=event.start+event.duration*60000) {
            const channel=await withDeadline(client.channels.fetch(event.channel),8000,'Event channel check timed out.');
            if(!channel || channel.guildId!==event.guild || !channel.isTextBased()) throw Error('Event channel unavailable.');
            if(event.kind!=='event' && channel.permissionsFor(channel.guild.roles.everyone)?.has(P.ViewChannel)) throw Error('Staff event channel is no longer private; delivery withheld.');
            const current=store.get(event.guild,'event',event.id);
            // A dashboard edit may finish while Discord resolves the old destination.
            // Skip that snapshot; the next tick uses the saved destination and content.
            const fields=['start','channel','kind','title','description','location','role','assignees','rotationIndex','duration','reminder','repeat','zone'];
            if(!current || current.cancelled || current.complete || !pluginEnabled(store,event.guild,'scheduler') || fields.some(key=>JSON.stringify(current[key])!==JSON.stringify(event[key])))continue;
            const person=rotationMember(event);
            const content=[event.role?`<@&${event.role}>`:'',person?`On duty: <@${person}>`:'',`**${event.title}**`, `<t:${Math.floor(event.start/1000)}:F> (<t:${Math.floor(event.start/1000)}:R>)`,event.description || '',event.location || ''].filter(Boolean).join('\n');
            await deliver(store,`event:${event.guild}:${event.id}:${event.start}`,channel,{content:content.slice(0,2000),allowedMentions:{parse:[],roles:event.role?[event.role]:[],users:person?[person]:[]},components:[{type:1,components:[{type:2,style:1,label:'Going',custom_id:`rsvp:${event.id}:${event.start}:going`},{type:2,style:2,label:'Maybe',custom_id:`rsvp:${event.id}:${event.start}:maybe`},{type:2,style:2,label:'Can’t make it',custom_id:`rsvp:${event.id}:${event.start}:declined`}]}]});
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
      await processFeeds(client,store,now,{send:deliver});
    } finally {running=false;}
  };
  const timer=setInterval(()=>tick().catch(error=>console.error(error.message)),15000);
  tick().catch(error=>console.error(error.message));
  return ()=>clearInterval(timer);
}
