import test from 'node:test';
import assert from 'node:assert/strict';
import {DateTime} from 'luxon';
import {SlashCommandBuilder,ModalBuilder,ActionRowBuilder,TextInputBuilder,TextInputStyle} from 'discord.js';
import {Store} from '../src/store.js';
import {parseTime,advance,rollForward,rotationMember,validateEmbed} from '../src/domain.js';
import {allowedUrl,publicAddress} from '../src/feeds.js';
import {deliver} from '../src/worker.js';
import {commands} from '../src/commands.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';

test('server data and item IDs cannot leak between servers',()=>{
  const s=new Store(':memory:');s.put('a','embed',{id:'shared',name:'Private'});
  assert.equal(s.get('b','embed','shared'),undefined);assert.deepEqual(s.list('b','embed'),[]);
  s.put('b','embed',{id:'shared',name:'Different'});s.remove('a','embed','shared');
  assert.equal(s.get('b','embed','shared').name,'Different');s.close();
});
test('delivery status filters by server before limiting recent problems',()=>{
  const s=new Store(':memory:');s.claim('event:mine:event:1');
  for(let n=0;n<20;n++)s.claim(`event:other:event:${n}`);
  assert.equal(s.problems('mine').length,1);assert.equal(s.problems('mine')[0].key,'event:mine:event:1');s.close();
});
test('database restart preserves saved state, weekly batch progress and delivery claims',()=>{
  const path=join(tmpdir(),`number-one-persistence-${randomUUID()}.sqlite`);
  let s;
  try {
    s=new Store(path);s.put('guild','embed',{id:'saved',name:'Welcome',embed:{description:'Saved'}});
    s.put('guild','feed',{id:'feed',pending:[{key:'post'}],batch:{slot:123,part:1,parts:[{content:'First'},{content:'Second'}]}});
    assert.equal(s.claim('digest:guild:feed:123:0'),true);s.delivered('digest:guild:feed:123:0','sent','message');s.close();
    s=new Store(path);assert.equal(s.get('guild','embed','saved').name,'Welcome');assert.equal(s.get('guild','feed','feed').batch.part,1);
    assert.equal(s.get('guild','feed','feed').pending[0].key,'post');assert.equal(s.claim('digest:guild:feed:123:0'),false);
  } finally {s?.close();for(const suffix of ['','-wal','-shm'])rmSync(path+suffix,{force:true});}
});
test('New York local input converts correctly; invalid and ambiguous daylight times require correction',()=>{
  assert.equal(new Date(parseTime('2026-10-20T19:00','America/New_York')).toISOString(),'2026-10-20T23:00:00.000Z');
  assert.throws(()=>parseTime('2026-03-08T02:30','America/New_York'),/does not exist/);
  assert.throws(()=>parseTime('2026-11-01T01:30','America/New_York'),/occurs twice/);
  assert.equal(new Date(parseTime('2026-11-01T01:30-05:00','America/New_York')).toISOString(),'2026-11-01T06:30:00.000Z');
  assert.throws(()=>parseTime('tomorrow','America/New_York'));
});
test('weekly schedules preserve local hour across daylight changes',()=>{
  const start=parseTime('2026-10-25T19:00','America/New_York');
  const next=advance({start,zone:'America/New_York',repeat:'weekly'},start+1000);
  assert.equal(DateTime.fromMillis(next,{zone:'America/New_York'}).toFormat('yyyy-MM-dd HH:mm'),'2026-11-01 19:00');
  assert.equal(next-start,169*3600000);
});
test('missed occurrences advance rotation fairly without a backlog of reminders',()=>{
  const start=parseTime('2026-10-18T10:00','America/New_York');
  const event={start,zone:'America/New_York',repeat:'daily',assignees:['a','b','c'],rotationIndex:0};
  const result=rollForward(event,start+2.5*86400000);assert.equal(result.count,3);
  assert.equal(rotationMember({...event,rotationIndex:result.count}),'a');
  assert.equal(advance({...event,repeat:'none'}),null);
});
test('Discord embed combined text and field limits are enforced',()=>{
  assert.throws(()=>validateEmbed({embed:{description:'x'.repeat(4096),fields:[{name:'n',value:'x'.repeat(1024)},{name:'n',value:'x'.repeat(1024)}]}}),/text limits/);
  assert.throws(()=>validateEmbed({embed:{description:'ok',fields:Array(26).fill({name:'n',value:'v'})}}),/25 fields/);
  assert.equal(validateEmbed({embed:{description:'<#123456789012345678>'}}).embed.description,'<#123456789012345678>');
});
test('RSS destinations must be operator-approved HTTPS public hosts',()=>{
  for(const url of ['http://feeds.example/rss','https://localhost/rss','https://127.0.0.1/rss','https://user:secret@feeds.example/rss','https://feeds.example:8443/rss'])assert.throws(()=>allowedUrl(url,'feeds.example'));
  assert.equal(allowedUrl('https://feeds.example/rss','feeds.example').hostname,'feeds.example');
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
});
test('delivery claims prevent repeat sends, including after an ambiguous send failure',async()=>{
  const s=new Store(':memory:');let sent=0;
  const channel={send:async()=>{sent++;return {id:'message'};}};
  assert.equal(await deliver(s,'event:a:id:123',channel,{content:'hello'}),true);
  assert.equal(await deliver(s,'event:a:id:123',channel,{content:'hello'}),false);assert.equal(sent,1);
  await assert.rejects(deliver(s,'event:a:id:456',{send:async()=>{throw Error('Connection lost');}},{content:'hello'}));
  assert.equal(await deliver(s,'event:a:id:456',channel,{content:'hello'}),false);assert.equal(sent,1);assert.equal(s.problems()[0].state,'failed');s.close();
});
test('command schema has valid option order, descriptions and guild-only entry points',()=>{
  for(const command of commands) {
    assert.deepEqual(command.contexts,[0]);assert.deepEqual(command.integration_types,[0]);
    assert.ok(command.description.length<=100);
    for(const sub of command.options || []) {
      assert.ok(sub.description.length<=100);let optional=false;
      for(const option of sub.options || []) {if(!option.required)optional=true;else assert.equal(optional,false,`${command.name} ${sub.name}: required options must come first`);assert.ok(option.description.length<=100);}
    }
  }
});
test('empty optional modal values serialize in the installed Discord builders',()=>{
  const modal=new ModalBuilder().setCustomId('test').setTitle('Test').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Text').setStyle(TextInputStyle.Short).setRequired(false).setValue('')));
  assert.equal(modal.toJSON().components.length,1);
});
