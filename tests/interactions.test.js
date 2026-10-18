import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {createApp} from '../src/app.js';
import {Store} from '../src/store.js';

function harness({manager=true,visible=true,privateChannel=false,guildId='server-a'}={}) {
  const store=new Store(':memory:'),client=new EventEmitter(),app=createApp(client,store),outputs=[],sent=[];
  const member={id:'123456789012345678',roles:{cache:new Map()}};
  const perms=new PermissionsBitField(manager?[P.ManageGuild,P.MentionEveryone]:[]);
  const channel={id:'234567890123456789',type:0,permissionsFor:target=>new PermissionsBitField(target==='everyone'?(privateChannel?[]:[P.ViewChannel]):target===member&&!visible?[]:[P.ViewChannel,P.SendMessages,P.EmbedLinks,P.MentionEveryone]),send:async p=>{sent.push(p);return {id:'posted',url:'https://discord.com/channels/server/channel/message'};}};
  const guild={id:guildId,channels:{cache:new Map([[channel.id,channel]]),fetch:async id=>id===channel.id?channel:null},members:{me:'bot',fetch:async()=>member},roles:{everyone:'everyone',fetch:async id=>({id,mentionable:true,managed:false})}};
  channel.guild=guild;
  const interaction=(name,sub,values={})=>({
    guildId,guild,user:{id:member.id},member,memberPermissions:perms,commandName:name,inGuild:()=>true,isButton:()=>false,isModalSubmit:()=>false,isChatInputCommand:()=>true,
    options:{getSubcommand:()=>sub,getString:k=>values[k]??null,getInteger:k=>values[k]??null,getRole:k=>values[k]?{id:values[k]}:null,getUser:k=>values[k]?{id:values[k]}:null,getChannel:()=>channel},
    reply:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p);},
    editReply:async function(p){assert.ok(this.deferred||this.replied);outputs.push(p);},
    deferReply:async function(){assert.ok(!this.deferred&&!this.replied);this.deferred=true;},
    deferUpdate:async function(){assert.ok(!this.deferred&&!this.replied);this.deferred=true;},
    showModal:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p.toJSON());},
    update:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p);}
  });
  return {store,app,outputs,sent,channel,member,interaction};
}
test('only staff can create embeds, while all members can use help',async()=>{
  const h=harness({manager:false});await assert.rejects(h.app.handle(h.interaction('embed','create',{name:'Test'})),/Manage Server/);
  await h.app.handle(h.interaction('help',null));assert.match(h.outputs[0].content,/Number One/);assert.equal(h.store.list('server-a','embed').length,0);h.store.close();
});
test('embed form saves edits and publication only permits explicit mentions',async()=>{
  const h=harness();await h.app.handle(h.interaction('embed','create',{name:'Welcome'}));
  const d=h.store.list('server-a','embed')[0];const i=h.interaction();
  Object.assign(i,{isChatInputCommand:()=>false,isModalSubmit:()=>true,isFromMessage:()=>true,customId:`embedform:${d.id}:text`,fields:{getTextInputValue:k=>({title:'Welcome',description:`Visit <#${h.channel.id}>`,color:'E5A1B3',content:'@everyone hello'})[k]}});
  await h.app.handle(i);assert.equal(h.store.get('server-a','embed',d.id).embed.title,'Welcome');
  await h.app.handle(h.interaction('embed','send',{id:d.id,role:'345678901234567890'}));
  assert.deepEqual(h.sent[0].allowedMentions,{parse:[],roles:['345678901234567890'],users:[]});assert.match(h.sent[0].content,/@everyone/);h.store.close();
});
test('another server cannot publish an embed by guessing its ID',async()=>{
  const h=harness({guildId:'server-b'});h.store.put('server-a','embed',{id:'secret',name:'Secret',embed:{description:'private'}});
  await assert.rejects(h.app.handle(h.interaction('embed','send',{id:'secret'})),/not found/);assert.equal(h.sent.length,0);h.store.close();
});
test('staff meetings require a private channel and future local time',async()=>{
  const h=harness();await assert.rejects(h.app.handle(h.interaction('schedule','add',{title:'Meeting',start:'2030-12-01T19:00',kind:'staff-meeting'})),/hidden from/);assert.equal(h.store.list('server-a','event').length,0);h.store.close();
  const p=harness({privateChannel:true});await p.app.handle(p.interaction('schedule','add',{title:'Meeting',start:'2030-12-01T19:00',kind:'staff-meeting',repeat:'weekly'}));
  const e=p.store.list('server-a','event')[0];assert.equal(e.zone,'America/New_York');assert.equal(e.repeat,'weekly');assert.equal(e.reminder,30);p.store.close();
});
test('private schedule details are withheld and RSVP requires channel access',async()=>{
  const h=harness({manager:false,visible:false,privateChannel:true});
  const event={id:'meeting',title:'Private',channel:h.channel.id,start:Date.now()+600000,duration:60,rsvps:{}};h.store.put('server-a','event',event);
  await assert.rejects(h.app.handle(h.interaction('schedule','show',{id:'meeting'})),/cannot access/);
  const button=h.interaction();Object.assign(button,{isButton:()=>true,isChatInputCommand:()=>false,customId:`rsvp:meeting:${event.start}:going`});
  await assert.rejects(h.app.handle(button),/cannot access/);assert.deepEqual(h.store.get('server-a','event','meeting').rsvps,{});h.store.close();
});
test('RSVP rejects obsolete occurrences and cancel marks future delivery inactive',async()=>{
  const h=harness();const start=Date.now()+600000;h.store.put('server-a','event',{id:'meeting',title:'Test',kind:'event',channel:h.channel.id,start,duration:60,rsvps:{}});
  const button=h.interaction();Object.assign(button,{isButton:()=>true,isChatInputCommand:()=>false,customId:`rsvp:meeting:${start-1}:going`});await assert.rejects(h.app.handle(button),/no longer accepting/);
  button.customId=`rsvp:meeting:${start}:going`;await h.app.handle(button);assert.equal(h.store.get('server-a','event','meeting').rsvps[h.member.id],'going');
  await h.app.handle(h.interaction('schedule','cancel',{id:'meeting'}));assert.equal(h.store.get('server-a','event','meeting').cancelled,true);h.store.close();
});

test('legacy /events returns a useful reply without fetching a member',async()=>{
  const h=harness();const i=h.interaction('events',null);
  i.guild.members.fetch=async()=>{throw Error('Should not fetch a member');};
  await h.app.handle(i);assert.equal(i.deferred,true);assert.match(h.outputs[0].content,/older or unavailable/);assert.match(h.outputs[0].content,/schedule list/);h.store.close();
});
test('slow channel work is acknowledged before the REST request',async()=>{
  const h=harness();const e={id:'event',title:'Test',channel:h.channel.id,start:Date.now()+600000,duration:60,zone:'America/New_York',kind:'event',repeat:'none'};
  h.store.put('server-a','event',e);const i=h.interaction('schedule','show',{id:e.id});i.guild.channels.cache.clear();
  i.guild.channels.fetch=async()=>{assert.equal(i.deferred,true);return h.channel;};
  await h.app.handle(i);assert.equal(h.outputs[0].embeds[0].toJSON().title,'Test');h.store.close();
});
test('forms remain the initial response and do not defer before showModal',async()=>{
  const h=harness();h.store.put('server-a','event',{id:'event',title:'Test',channel:h.channel.id,start:Date.now()+600000,duration:60,zone:'America/New_York',kind:'event',repeat:'none'});
  const i=h.interaction('schedule','edit',{id:'event'});await h.app.handle(i);assert.ok(!i.deferred);assert.equal(h.outputs[0].custom_id,'eventform:event:edit');h.store.close();
});
test('the production dispatcher replies to permission failures instead of swallowing them',async()=>{
  const h=harness({manager:false});await h.app.dispatch(h.interaction('embed','create',{name:'Test'}));
  assert.match(h.outputs[0].content,/Manage Server/);assert.match(h.outputs[0].content,/Reference:/);h.store.close();
});
