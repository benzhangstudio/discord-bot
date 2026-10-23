import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionRowBuilder,MessageFlags} from 'discord.js';
import {EventEmitter} from 'node:events';
import {Store} from '../src/store.js';
import {createInstagramSetup,instagramZone,scheduleFields} from '../src/instagram.js';
import {nextDigest,processFeeds} from '../src/weekly-feeds.js';
import {allowedUrl,loadFeed} from '../src/feeds.js';
import {commands} from '../src/commands.js';
const post={key:'old',title:'A post',link:'https://www.instagram.com/p/example/'};
function harness() {
  const store=new Store(':memory:'),outputs=[];let loads=0,allowed=true,hook;
  const handle=createInstagramSetup({store,settings:()=>({zone:'Asia/Seoul'}),needStaff:i=>{if(!i.staff)throw Error('Staff only');},destination:async()=>{if(!allowed)throw Error('Channel unavailable');return{id:'123456789012345678'};},pingRole:async(i,r)=>r,load:async()=>{loads++;await hook?.();return[post];}});
  const interaction=(action,values=[],fields={})=>({guildId:'g',user:{id:'member'},staff:true,commandName:action?'':'instagram',options:{getSubcommand:()=> 'setup'},customId:action?`instagram:${store.list('g','instagram-draft')[0]?.id}:${action}`:undefined,values,fields:{getTextInputValue:k=>fields[k]},isChatInputCommand:()=>!action,
    update:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p);},
    reply:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p);},showModal:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p.toJSON());},
    deferReply:async function(){assert.ok(!this.replied&&!this.deferred);this.deferred=true;},deferUpdate:async function(){assert.ok(!this.replied&&!this.deferred);this.deferred=true;},editReply:async function(p){assert.ok(this.replied||this.deferred);outputs.push(p);}});
  const run=(a,v,f)=>handle(interaction(a,v,f));
  const configure=async()=>{await run();await run('sourceform',[],{name:'Rosé',url:'https://provider.example/rss'});await run('channel',['123456789012345678']);};
  return {store,outputs,handle,interaction,run,configure,get loads(){return loads;},deny:()=>{allowed=false;},hook:f=>{hook=f;}};
}
test('Instagram replaces feed and setup exposes Discord channel/role pickers and valid forms',async()=>{
  assert.ok(!commands.some(c=>c.name==='feed'));assert.ok(commands.find(c=>c.name==='instagram').options.some(s=>s.name==='setup'));
  const h=harness();await h.run();const p=h.outputs[0];assert.equal(p.flags,undefined);assert.equal(p.components.length,5);
  for(const r of p.components)ActionRowBuilder.from(r).toJSON();
  assert.equal(p.components[1].components[0].type,8);assert.equal(p.components[2].components[0].type,6);
  for(const action of ['source','schedule']){await h.run(action);const form=h.outputs.at(-1);assert.ok(form.components.length<=5);for(const r of form.components){assert.ok(r.components[0].label.length<=45);assert.ok(r.components[0].value.length<=r.components[0].max_length);}}
  assert.equal(h.store.list('g','feed').length,0);h.store.close();
});
test('self-service save validates source, channel, role and chosen local delivery; no historical backlog',async()=>{
  const h=harness();await h.configure();await h.run('role',['234567890123456789']);await h.run('delivery',['daily']);
  await h.run('scheduleform',[],{zone:'London',time:'08:15',day:'Monday',previews:'yes'});await h.run('save');
  const f=h.store.list('g','feed')[0];assert.equal(f.zone,'Europe/London');assert.equal(f.time,'08:15');assert.equal(f.delivery,'daily');assert.equal(f.role,'234567890123456789');assert.equal(f.showPreviews,true);assert.deepEqual(f.seen,['old']);assert.deepEqual(f.pending,[]);assert.ok(f.nextDigest>Date.now());assert.equal(h.loads,1);h.store.close();
});
test('editing saved schedule preserves queued posts and does not refetch or reset seen items',async()=>{
  const h=harness();await h.configure();await h.run('save');let f=h.store.list('g','feed')[0];f.pending=[{...post,key:'new'}];h.store.put('g','feed',f);
  await h.run('choose',[f.id]);await h.run('scheduleform',[],{zone:'Asia/Tokyo',time:'10:30',day:'Friday',previews:'no'});await h.run('role',[]);await h.run('save');
  f=h.store.get('g','feed',f.id);assert.equal(f.zone,'Asia/Tokyo');assert.equal(f.weekday,5);assert.equal(f.pending[0].key,'new');assert.deepEqual(f.seen,['old']);assert.equal(f.role,null);assert.equal(h.loads,1);h.store.close();
});
test('private preview never pings, activates a draft or consumes queued posts',async()=>{
  const h=harness();await h.configure();await h.run('role',['234567890123456789']);await h.run('preview');
  assert.equal(h.store.list('g','feed').length,0);assert.deepEqual(h.outputs.at(-1).allowedMentions,{parse:[]});assert.doesNotMatch(h.outputs.at(-1).content,/<@&/);await h.run('close');assert.equal(h.store.list('g','instagram-draft').length,0);h.store.close();
});

for(const action of ['preview','save'])test(`Instagram ${action} stops when its feed service never returns`,{timeout:1000},async()=>{
  const h=harness();await h.configure();h.hook(()=>new Promise(()=>{}));
  const i=h.interaction(action);i.operationTimeoutMs=10;
  await assert.rejects(h.handle(i),/too long/);assert.equal(h.store.list('g','feed').length,0);assert.equal(h.store.list('g','instagram-draft')[0].name,'Rosé');h.store.close();
});
test('menus enforce owner, guild, expiry, staff membership and current channel permission',async()=>{
  const h=harness();await h.configure();
  for(const change of [{user:{id:'other'}},{guildId:'other'},{staff:false}]){const i=h.interaction('save');Object.assign(i,change);await assert.rejects(h.handle(i));}
  h.deny();await assert.rejects(h.run('save'),/Channel unavailable/);assert.equal(h.store.list('g','feed').length,0);
  const d=h.store.list('g','instagram-draft')[0];d.expiresAt=1;h.store.put('g','instagram-draft',d);await assert.rejects(h.run('save'),/expired/);h.store.close();
});
test('stale edits and changing source while posts are queued cannot discard saved state',async()=>{
  const h=harness();await h.configure();await h.run('save');let f=h.store.list('g','feed')[0];f.settingsVersion++;h.store.put('g','feed',f);await assert.rejects(h.run('save'),/changed/);
  await h.run('choose',[f.id]);f.pending=[post];h.store.put('g','feed',f);await h.run('sourceform',[],{name:'Different account',url:'https://other.example/rss'});await assert.rejects(h.run('save'),/posts waiting/);assert.equal(h.store.get('g','feed',f.id).url,'https://provider.example/rss');
  f.batch={part:0,parts:[{}]};h.store.put('g','feed',f);await assert.rejects(h.run('save'),/being delivered/);h.store.close();
});
test('concurrent saves recheck quota and duplicate sources after network validation',async()=>{
  const h=harness();await h.configure();h.hook(()=>h.store.put('g','feed',{id:'other',url:'https://provider.example/rss',channel:'123456789012345678'}));await assert.rejects(h.run('save'),/already posts/);assert.equal(h.store.list('g','feed').length,1);h.store.close();
  const q=harness();await q.configure();q.hook(()=>{for(let n=0;n<10;n++)q.store.put('g','feed',{id:String(n),url:'https://other.example/'+n});});await assert.rejects(q.run('save'),/10 sources/);assert.equal(q.store.list('g','feed').length,10);q.store.close();
});
test('cities, timezones and human schedule inputs validate without a New York restriction',()=>{
  assert.equal(instagramZone('Seoul'),'Asia/Seoul');assert.equal(instagramZone('UTC'),'UTC');assert.equal(instagramZone('Pacific/Auckland'),'Pacific/Auckland');assert.throws(()=>instagramZone('nonsense'),/Enter a timezone/);
  const values={zone:'UTC',time:'09:00',day:'Sunday',previews:'no'};assert.equal(scheduleFields(values).weekday,7);
  for(const bad of [{time:'25:00'},{day:'Someday'},{previews:'maybe'}])assert.throws(()=>scheduleFields({...values,...bad}));
});
test('daily and weekly delivery follow each source timezone, including daylight saving',()=>{
  const next=(now,f)=>new Date(nextDigest(Date.parse(now),f)).toISOString();
  assert.equal(next('2026-10-19T00:00:00Z',{zone:'Asia/Seoul',time:'10:30',delivery:'daily'}),'2026-10-19T01:30:00.000Z');
  assert.equal(next('2026-10-19T01:30:00Z',{zone:'Asia/Seoul',time:'10:30',delivery:'daily'}),'2026-10-20T01:30:00.000Z');
  assert.equal(next('2026-10-23T12:00:00Z',{zone:'Europe/London',time:'09:00',weekday:1}),'2026-10-26T09:00:00.000Z');
  assert.equal(next('2026-03-07T12:00:00Z',{zone:'America/New_York',time:'02:30',weekday:7}),'2026-03-08T07:30:00.000Z');
  assert.equal(next('2026-11-01T05:30:00Z',{zone:'America/New_York',time:'01:30',delivery:'daily'}),'2026-11-02T06:30:00.000Z');
});

test('worker discards a fetch if staff change the source schedule while it is running',async()=>{
  const s=new Store(':memory:'),now=Date.now();
  s.put('g','feed',{id:'f',url:'https://provider.example/rss',seen:[],pending:[],nextCheck:0,nextDigest:now+3600000});
  await processFeeds({},s,now,{load:async()=>{const f=s.get('g','feed','f');f.zone='Asia/Seoul';f.settingsVersion=1;s.put('g','feed',f);return[post];},send:async()=>{throw Error('Must not deliver');}});
  assert.deepEqual(s.get('g','feed','f').pending,[]);assert.equal(s.get('g','feed','f').zone,'Asia/Seoul');s.close();
});
test('worker delivers and advances a configured daily roundup in Seoul',async()=>{
  const s=new Store(':memory:'),now=Date.parse('2026-10-19T01:30:00Z'),sent=[];
  s.put('g','feed',{id:'f',name:'Posts',url:'https://provider.example/rss',channel:'c',zone:'Asia/Seoul',delivery:'daily',time:'10:30',seen:[],pending:[],nextCheck:now,nextDigest:now});
  await processFeeds({channels:{fetch:async()=>({guildId:'g',isTextBased:()=>true})}},s,now,{load:async()=>[post],send:async(st,key,ch,p)=>{sent.push(p);return true;}});
  assert.match(sent[0].content,/Daily posts/);assert.equal(s.get('g','feed','f').nextDigest,now+86400000);s.close();
});
test('network loader blocks private DNS and redirects, pins DNS and parses public RSS without approval',async()=>{
  assert.equal(allowedUrl('https://any-provider.example/rss').hostname,'any-provider.example');
  for(const address of ['127.0.0.1','169.254.169.254','::1','2001:2::1'])await assert.rejects(loadFeed('https://provider.example/rss',{resolve:async()=>[{address,family:address.includes(':')?6:4}],get:()=>{throw Error('Must never connect');}}),/public internet/);
  const resolve=async()=>[{address:'8.8.8.8',family:4}];
  const get=(status,xml)=>(url,options,callback)=>{
    options.lookup('provider.example',{all:true},(err,answers)=>assert.equal(answers[0].address,'8.8.8.8'));
    const request=new EventEmitter();request.setTimeout=()=>{};
    queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=status;response.resume=()=>{};callback(response);if(status===200){response.emit('data',Buffer.from(xml));response.emit('end');}});return request;
  };
  await assert.rejects(loadFeed('https://provider.example/rss',{resolve,get:get(302,'')}),/Redirects/);
  await assert.rejects(loadFeed('https://provider.example/rss',{resolve,get:get(200,'<html>profile</html>')}),/RSS or Atom/);
  const items=await loadFeed('https://provider.example/rss',{resolve,get:get(200,'<rss version="2.0"><channel><title>Posts</title><item><title>Hello</title><link>https://www.instagram.com/p/hello/</link><guid>one</guid></item></channel></rss>')});assert.equal(items[0].key,'one');
});
