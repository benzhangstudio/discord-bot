import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {deliver} from '../src/worker.js';
import {nextDigest,digestParts,processFeeds} from '../src/weekly-feeds.js';
const time=s=>Date.parse(s);
const post=n=>({key:String(n),title:`Post ${n}`,link:`https://example.com/posts/${n}`});
function setup(start='2026-10-19T12:00:00-04:00') {
  const now=time(start),store=new Store(':memory:'),sent=[];
  store.put('g','feed',{id:'f',name:'Rosé',url:'https://example.com/rss',channel:'c',seen:['old'],pending:[],checked:now,nextCheck:now+86400000,nextDigest:nextDigest(now)});
  const client={channels:{fetch:async()=>({guildId:'g',isTextBased:()=>true,send:async p=>{sent.push(p);return{id:String(sent.length)};}})}};
  return {now,store,sent,client};
}
test('weekly boundary is the start of Sunday in New York, including daylight saving changes',()=>{
  assert.equal(new Date(nextDigest(time('2026-10-24T23:59:00-04:00'))).toISOString(),'2026-10-25T04:00:00.000Z');
  assert.equal(new Date(nextDigest(time('2026-10-25T00:00:00-04:00'))).toISOString(),'2026-11-01T04:00:00.000Z');
  assert.equal(new Date(nextDigest(time('2026-11-01T00:00:00-04:00'))).toISOString(),'2026-11-08T05:00:00.000Z');
  assert.equal(new Date(nextDigest(time('2026-03-08T00:00:00-05:00'))).toISOString(),'2026-03-15T04:00:00.000Z');
});
test('daily collection queues posts without sending; Sunday batch survives a worker restart and is not repeated',async()=>{
  const h=setup();let fetched=0;const load=async()=>{fetched++;return[post(2),post(1),{...post('old'),key:'old'}];};
  await processFeeds(h.client,h.store,h.now+86400000,{load,send:deliver});
  assert.equal(h.sent.length,0);assert.equal(h.store.get('g','feed','f').pending.length,2);
  await processFeeds(h.client,h.store,h.now+86400000+15000,{load,send:deliver});assert.equal(fetched,1);
  const sunday=time('2026-10-25T00:00:00-04:00');
  await processFeeds(h.client,h.store,sunday,{load:async()=>[],send:deliver});assert.equal(h.sent.length,1);assert.match(h.sent[0].content,/Post 1[\s\S]*Post 2/);assert.doesNotMatch(h.sent[0].content,/posts\/old/);
  await processFeeds(h.client,h.store,sunday+15000,{load,send:deliver});assert.equal(h.sent.length,1);assert.deepEqual(h.store.get('g','feed','f').pending,[]);h.store.close();
});
test('empty weeks are silent and paused feeds do not collect or post',async()=>{
  const h=setup();const sunday=time('2026-10-25T00:00:00-04:00');
  await processFeeds(h.client,h.store,sunday,{load:async()=>[],send:deliver});assert.equal(h.sent.length,0);
  const feed=h.store.get('g','feed','f');feed.paused=true;h.store.put('g','feed',feed);
  await processFeeds(h.client,h.store,sunday+8*86400000,{load:async()=>{throw Error('Must not fetch');},send:deliver});assert.equal(h.sent.length,0);h.store.close();
});
test('long batches split within Discord limits and notify a role only once',()=>{
  const parts=digestParts({name:'Rosé',role:'123'},Array.from({length:30},(_,n)=>({...post(n),title:'Long title '.repeat(20)})));
  assert.ok(parts.length>1);assert.ok(parts.every(p=>p.content.length<=2000));assert.deepEqual(parts[0].allowedMentions.roles,['123']);assert.ok(parts.slice(1).every(p=>p.allowedMentions.roles.length===0));
});
test('source failures retry after an hour and do not send an incomplete batch',async()=>{
  const h=setup();const sunday=time('2026-10-25T00:00:00-04:00');let fetched=0;
  const load=async()=>{fetched++;throw Error('Provider unavailable');};
  await processFeeds(h.client,h.store,sunday,{load,send:deliver});
  await processFeeds(h.client,h.store,sunday+15000,{load,send:deliver});assert.equal(fetched,1);assert.equal(h.sent.length,0);
  await processFeeds(h.client,h.store,sunday+3600000,{load:async()=>[post(1)],send:deliver});assert.equal(h.sent.length,1);h.store.close();
});
test('an uncertain Discord delivery pauses a batch rather than repeating notification pings',async()=>{
  const h=setup();const sunday=time('2026-10-25T00:00:00-04:00');let attempts=0;
  h.client.channels.fetch=async()=>({guildId:'g',isTextBased:()=>true,send:async()=>{attempts++;throw Error('Connection lost');}});
  await processFeeds(h.client,h.store,sunday,{load:async()=>[post(1)],send:deliver});assert.equal(h.store.get('g','feed','f').paused,true);
  await processFeeds(h.client,h.store,sunday+15000,{load:async()=>[post(1)],send:deliver});assert.equal(attempts,1);h.store.close();
});
test('removing a subscription during a fetch cannot resurrect it',async()=>{
  const h=setup();await processFeeds(h.client,h.store,h.now+86400000,{load:async()=>{h.store.remove('g','feed','f');return[post(1)];},send:deliver});assert.equal(h.store.get('g','feed','f'),undefined);assert.equal(h.sent.length,0);h.store.close();
});
