import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {Store} from '../src/store.js';
import {createDashboardFeatures} from '../src/dashboard-features.js';
import {createDashboardApi} from '../src/dashboard-api.js';
import {Fault} from '../age-verification/core.js';

const G='111111111111111111',OTHER='222222222222222222',C='333333333333333333',U='444444444444444444',PERSON='555555555555555555';
const identity={id:U,owner:true,dashboard:true},now=()=>Date.UTC(2026,9,25,12);
function setup(t,options={}){
  const store=new Store(':memory:');t.after(()=>store.close());
  const everyone={id:G},bot={id:'bot'},member={id:U};
  const channel={id:C,name:'announcements',type:0,permissionsFor:who=>new PermissionsBitField(who===everyone?[]:[P.ViewChannel,P.SendMessages,P.EmbedLinks])};
  const guild={id:G,roles:{everyone,cache:new Map()},members:{me:bot,fetch:async({user})=>user===U?member:{id:user}},channels:{cache:new Map([[C,channel]])}};
  const client={guilds:{cache:new Map([[G,guild]])}};
  let checks=0,loads=0;
  const api=createDashboardFeatures({store,client,now,authorize:async()=>{checks++;},load:async()=>{loads++;return [{key:'old-post',title:'Old post',link:'https://example.com/post'}];},...options});
  return {store,guild,channel,member,api,checks:()=>checks,loads:()=>loads};
}
const saveEvent=extra=>({save:{title:'Community night',start:'2026-11-01T19:00',zone:'America/New_York',channel:C,kind:'event',repeat:'none',duration:60,reminder:30,...extra}});
const saveSource=extra=>({save:{name:'Artist updates',url:'https://feeds.example.com/artist',channel:C,zone:'America/New_York',time:'09:00',weekday:7,delivery:'weekly',showPreviews:false,...extra}});

test('embed drafts create, edit and copy without sending; advanced fields and other servers survive',async t=>{
  const {store,api,channel}=setup(t);let sent=0;channel.send=async()=>{sent++;return {id:'message'};};
  const result=await api.update(G,'embeds',{save:{name:'Welcome',title:'Hello',description:'Welcome everyone',color:'blue',content:'Read below'}},identity);
  const id=result.items[0].id;store.put(OTHER,'embed',{id,name:'Secret',embed:{title:'Other server'}});
  const saved=store.get(G,'embed',id);saved.embed.fields=[{name:'More',value:'Details'}];saved.embed.image={url:'https://example.com/image.png'};saved.sendChannel=C;store.put(G,'embed',saved);
  await api.update(G,'embeds',{save:{id,name:'Welcome again',title:'Updated',description:'New content',color:'black'}},identity);
  assert.equal(store.get(G,'embed',id).embed.color,0);assert.deepEqual(store.get(G,'embed',id).embed.fields,saved.embed.fields);assert.deepEqual(store.get(G,'embed',id).embed.image,saved.embed.image);
  const copy=await api.update(G,'embeds',{copy:id},identity);assert.equal(copy.items.length,2);const second=store.get(G,'embed',copy.items[1].id);assert.equal(second.name,'Welcome again (copy)');assert.equal(second.sendChannel,undefined);
  await api.update(G,'embeds',{delete:id},identity);assert.equal(store.get(G,'embed',id),undefined);assert.equal(store.get(OTHER,'embed',id).name,'Secret');assert.equal(sent,0);
});

test('embed validation rejects empty, oversized and combined actions without partially saving',async t=>{
  const {store,api}=setup(t);
  for(const data of [{save:{name:'Empty',title:'',description:''}},{save:{name:'Long',description:'x'.repeat(4097)}},{save:{name:'Bad color',description:'Text',color:'oops'}},{delete:'x',copy:'y'},{save:{id:'not-in-this-server',name:'Missing',description:'Text'}}])await assert.rejects(api.update(G,'embeds',data,identity));
  assert.deepEqual(store.list(G,'embed'),[]);
  await assert.rejects(api.update(G,'embeds',{save:{name:'No permission',description:'Text'}},{id:U,manager:true}),e=>e.status===403);
});

test('scheduler saves future local times with named channels and cancels locally',async t=>{
  const {api,store,checks}=setup(t);const result=await api.update(G,'scheduler',saveEvent(),identity),event=result.items[0];
  assert.equal(checks(),1);assert.equal(event.channel.name,'announcements');assert.equal(event.startLocal,'2026-11-01T19:00');assert.equal(event.start,Date.UTC(2026,10,2,0));assert.deepEqual(store.get(G,'event',event.id).rsvps,{});
  const edited=await api.update(G,'scheduler',saveEvent({id:event.id,title:'Changed',description:'New details'}),identity);assert.equal(edited.items[0].title,'Changed');
  await api.update(G,'scheduler',{cancel:event.id},identity);assert.equal(store.get(G,'event',event.id).cancelled,true);assert.deepEqual(api.view(G,'scheduler').items,[]);
});

test('scheduler rejects ambiguous times, overlapping repeats, invalid rotations and public staff channels',async t=>{
  const {api,store,guild,channel}=setup(t);
  for(const extra of [{start:'2026-11-01T01:30'},{start:'2026-01-01T12:00'},{repeat:'daily',duration:1440},{kind:'rotation',repeat:'none',people:PERSON},{kind:'rotation',repeat:'weekly',people:'bad'},{duration:0}])await assert.rejects(api.update(G,'scheduler',saveEvent(extra),identity));
  channel.permissionsFor=()=>new PermissionsBitField([P.ViewChannel,P.SendMessages,P.EmbedLinks]);
  await assert.rejects(api.update(G,'scheduler',saveEvent({kind:'staff-meeting'}),identity),/staff-only/);
  assert.deepEqual(store.list(G,'event'),[]);assert.equal(guild.id,G);
});

test('scheduler checks current role notification permissions before moving existing schedules',async t=>{
  const {api,store,guild}=setup(t);const first=(await api.update(G,'scheduler',saveEvent(),identity)).items[0];
  const event=store.get(G,'event',first.id);event.role='666666666666666666';store.put(G,'event',event);guild.roles.cache.set(event.role,{id:event.role,mentionable:false});
  await assert.rejects(api.update(G,'scheduler',saveEvent({id:event.id}),identity),/permission to notify/);
  assert.equal(store.get(G,'event',event.id).role,event.role);
});

test('scheduler refuses editing an occurrence whose reminder was claimed',async t=>{
  const {api,store}=setup(t);const event=(await api.update(G,'scheduler',saveEvent(),identity)).items[0];
  store.claim(`event:${G}:${event.id}:${event.start}`);
  await assert.rejects(api.update(G,'scheduler',saveEvent({id:event.id,title:'Cannot race'}),identity),e=>e.status===409);assert.equal(store.get(G,'event',event.id).title,'Community night');
});

test('async scheduler commits recheck access and never save after revocation or hanging member lookup',async t=>{
  const {api,store}=setup(t,{authorize:async()=>{throw new Fault(403,'Access removed.');}});
  await assert.rejects(api.update(G,'scheduler',saveEvent(),identity),e=>e.status===403);assert.deepEqual(store.list(G,'event'),[]);
  const hung=setup(t,{timeoutMs:15});hung.guild.members.fetch=()=>new Promise(()=>{});
  await assert.rejects(hung.api.update(G,'scheduler',saveEvent(),identity),e=>e.status===504);assert.deepEqual(hung.store.list(G,'event'),[]);
});

test('Instagram sources save without posting a backlog, preserve queues on edits and manage lifecycle',async t=>{
  const {api,store,loads,checks}=setup(t);const source=(await api.update(G,'instagram',saveSource(),identity)).items[0];let f=store.get(G,'feed',source.id);
  assert.deepEqual(f.seen,['old-post']);assert.deepEqual(f.pending,[]);assert.equal(loads(),1);assert.equal(checks(),1);assert.equal(source.channel.name,'announcements');assert.equal(source.url,undefined);
  f.pending=[{key:'new-post',title:'New post',link:'https://example.com/new'}];store.put(G,'feed',f);
  await api.update(G,'instagram',{save:{...saveSource().save,id:source.id,url:'',time:'10:00'}},identity);f=store.get(G,'feed',source.id);assert.equal(f.pending.length,1);assert.equal(loads(),1);assert.equal(f.settingsVersion,2);
  await api.update(G,'instagram',{pause:source.id},identity);assert.equal(store.get(G,'feed',source.id).paused,true);
  await api.update(G,'instagram',{resume:source.id},identity);assert.equal(store.get(G,'feed',source.id).paused,false);assert.equal(store.get(G,'feed',source.id).nextCheck,0);
  await api.update(G,'instagram',{remove:source.id},identity);assert.deepEqual(store.list(G,'feed'),[]);
});

test('Instagram rejects invalid sources, unsafe replacement, batch changes and cross-server records',async t=>{
  const {api,store}=setup(t);
  for(const extra of [{url:'http://localhost/feed'},{url:'https://127.0.0.1/feed'},{time:'25:00'},{weekday:8},{delivery:'hourly'}])await assert.rejects(api.update(G,'instagram',saveSource(extra),identity));
  const source=(await api.update(G,'instagram',saveSource(),identity)).items[0],f=store.get(G,'feed',source.id);f.pending=[{key:'waiting'}];store.put(G,'feed',f);
  await assert.rejects(api.update(G,'instagram',saveSource({id:source.id,url:'https://feeds.example.com/another'}),identity),e=>e.status===409);
  f.batch={part:0,parts:[{}]};f.paused=true;store.put(G,'feed',f);
  for(const data of [{resume:source.id},saveSource({id:source.id})])await assert.rejects(api.update(G,'instagram',data,identity),e=>e.status===409);
  for(const data of [{pause:source.id},{resume:source.id},{remove:source.id},saveSource({id:source.id})])await assert.rejects(api.update(OTHER,'instagram',data,identity),e=>e.status===404);
  assert.equal(store.get(G,'feed',source.id).pending.length,1);
});

test('Instagram network failures, hanging loads and revoked access never create records',async t=>{
  const hung=setup(t,{timeoutMs:15,load:()=>new Promise(()=>{})});await assert.rejects(hung.api.update(G,'instagram',saveSource(),identity),e=>e.status===504);assert.deepEqual(hung.store.list(G,'feed'),[]);
  const revoked=setup(t,{authorize:async()=>{throw new Fault(403,'Access removed.');}});await assert.rejects(revoked.api.update(G,'instagram',saveSource(),identity),e=>e.status===403);assert.deepEqual(revoked.store.list(G,'feed'),[]);
});

test('Instagram detects a concurrent source edit during feed validation',async t=>{
  const {api,store,guild}=setup(t);const source=(await api.update(G,'instagram',saveSource(),identity)).items[0];
  const race=createDashboardFeatures({store,client:{guilds:{cache:new Map([[G,guild]])}},now,authorize:async()=>{},load:async()=>{const f=store.get(G,'feed',source.id);f.settingsVersion++;f.name='Changed elsewhere';store.put(G,'feed',f);return [];}});
  await assert.rejects(race.update(G,'instagram',saveSource({id:source.id,url:'https://feeds.example.com/replaced'}),identity),e=>e.status===409);assert.equal(store.get(G,'feed',source.id).name,'Changed elsewhere');
});

test('dashboard API integrates editors, retains plugin metadata and rejects combined toggles atomically',async t=>{
  const {store,guild}=setup(t),api=createDashboardApi({store,client:{guilds:{cache:new Map([[G,guild]])}}});
  const call=data=>api.handle({guild:G,identity,method:'PUT',endpoint:'plugins/embeds',data});
  const saved=await call({save:{name:'From dashboard',description:'Saved only',color:'blue'}});
  assert.equal(saved.plugin,'embeds');assert.equal(saved.enabled,true);assert.equal(saved.toggleable,true);assert.equal(saved.editable,true);assert.equal(saved.items[0].name,'From dashboard');
  await assert.rejects(call({enabled:false,delete:saved.items[0].id}),e=>e.status===400);
  assert.equal(store.get(G,'dashboard-plugins','main'),undefined);assert.equal(store.list(G,'embed').length,1);
  await assert.rejects(api.handle({guild:G,identity:{id:U,manager:true},method:'GET',endpoint:'plugins/embeds'}),e=>e.status===403);
  const toggled=await call({enabled:false});assert.equal(toggled.enabled,false);assert.equal(toggled.items.length,1);
});
