import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PermissionsBitField,PermissionFlagsBits as P,ActionRowBuilder} from 'discord.js';
import {createApp} from '../src/app.js';
import {Store} from '../src/store.js';
import {WORKING_MESSAGE} from '../src/responses.js';
import {commands} from '../src/commands.js';

function harness({manager=true,visible=true,privateChannel=false,guildId='server-a',replyEditTimeoutMs=8000,operationTimeoutMs=15000}={}) {
  const store=new Store(':memory:'),client=new EventEmitter(),app=createApp(client,store,{replyEditTimeoutMs,operationTimeoutMs,feedLoader:async()=>[{key:'post',title:'Latest post',link:'https://example.com/post'}]}),outputs=[],sent=[];
  const member={id:'123456789012345678',roles:{cache:new Map()}};
  const perms=new PermissionsBitField(manager?[P.ManageGuild,P.MentionEveryone]:[]);
  const channel={id:'234567890123456789',type:0,permissionsFor:target=>new PermissionsBitField(target==='everyone'?(privateChannel?[]:[P.ViewChannel]):target===member&&!visible?[]:[P.ViewChannel,P.SendMessages,P.EmbedLinks,P.MentionEveryone]),send:async p=>{sent.push(p);return {id:'posted',url:'https://discord.com/channels/server/channel/message'};}};
  const guild={id:guildId,channels:{cache:new Map([[channel.id,channel]]),fetch:async id=>id===channel.id?channel:null},members:{me:'bot',fetch:async()=>member},roles:{everyone:'everyone',fetch:async id=>({id,mentionable:true,managed:false})}};
  channel.guild=guild;
  const interaction=(name,sub,values={})=>({
    guildId,guild,user:{id:member.id},member,memberPermissions:perms,commandName:name,inGuild:()=>true,isButton:()=>false,isModalSubmit:()=>false,isChatInputCommand:()=>true,
    options:{getSubcommand:()=>sub,getString:k=>values[k]??null,getInteger:k=>values[k]??null,getRole:k=>values[k]?{id:values[k]}:null,getUser:k=>values[k]?{id:values[k]}:null,getChannel:()=>channel},
    reply:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;if(p.content!==WORKING_MESSAGE)outputs.push(p);},
    editReply:async function(p){assert.ok(this.deferred||this.replied);outputs.push(p);},
    deferReply:async function(){assert.ok(!this.deferred&&!this.replied);this.deferred=true;},
    deferUpdate:async function(){assert.ok(!this.deferred&&!this.replied);this.deferred=true;},
    showModal:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p.toJSON());},
    update:async function(p){assert.ok(!this.deferred&&!this.replied);this.replied=true;outputs.push(p);}
  });
  return {store,app,outputs,sent,channel,member,interaction};
}

// Inventory comes from the deployed command schema: adding a command without
// adding an exercised scenario fails the suite instead of silently missing it.
const scenarios={
  help:{},
  'settings view':{},'settings timezone':{zone:'Asia/Seoul'},'settings staff':{role:'345678901234567890'},'settings clear-staff':{},'settings status':{},
  'embed create':{name:'New announcement'},'embed edit':{message:'saved'},'embed list':{},'embed delete':{message:'saved'},'embed remove-section':{message:'saved',number:1},'embed send':{message:'saved'},
  'schedule add':{title:'New event',start:'2099-12-01 19:00'},'schedule list':{},'schedule show':{event:'saved'},'schedule edit':{event:'saved'},'schedule post':{event:'saved'},'schedule configure':{event:'saved',repeat:'weekly',duration:90,reminder:15},'schedule cancel':{event:'saved'},
  'instagram setup':{},'instagram list':{},'instagram preview':{source:'saved'},'instagram pause':{source:'saved'},'instagram resume':{source:'saved'},'instagram remove':{source:'saved'}
};
test('every registered subcommand has a complete reply or modal scenario',()=>{
  const registered=commands.flatMap(c=>c.options?.map(s=>`${c.name} ${s.name}`)||[c.name]);
  assert.deepEqual(Object.keys(scenarios).sort(),registered.sort());
});
for(const [name,values] of Object.entries(scenarios))test(`command audit: /${name} finishes with a visible response`,{timeout:2000},async()=>{
  const h=harness();
  try {
    h.store.put('server-a','embed',{id:'saved',name:'Saved announcement',content:'',embed:{description:'Hello',fields:[{name:'Section',value:'Details'}]}});
    h.store.put('server-a','event',{id:'saved',title:'Saved event',channel:h.channel.id,start:Date.now()+3600000,duration:60,reminder:30,repeat:'none',kind:'event',zone:'America/New_York',rsvps:{}});
    h.store.put('server-a','feed',{id:'saved',name:'Saved source',url:'https://example.com/rss',channel:h.channel.id,pending:[],seen:[],zone:'Asia/Seoul',time:'09:00',delivery:'daily'});
    const [command,sub]=name.split(' '),i=h.interaction(command,sub,values);
    await h.app.handle(i);assert.ok(i.replied||i.deferred);assert.ok(h.outputs.length>0,'A defer alone is not a completed reply');
    const modal=name==='schedule edit'||name==='embed create',slow=['embed send','schedule add','schedule post','instagram preview'].includes(name);
    if(!modal&&!slow){assert.ok(!i.deferred,'Local commands must not depend on deferred webhook edits');assert.equal(i.replied,true);}
    if(modal)assert.ok(h.outputs[0].custom_id.startsWith(name==='embed create'?'embedform:':'eventform:'));
    if(name==='settings timezone')assert.equal(h.store.get('server-a','settings','main').zone,'Asia/Seoul');
    if(name==='embed send'||name==='schedule post')assert.equal(h.sent.length,1);
    if(name==='instagram preview')assert.deepEqual(h.outputs.at(-1).allowedMentions,{parse:[]});
  } finally {h.store.close();}
});

test('settings timezone validation replies immediately and preserves the previous timezone',async()=>{
  const h=harness();h.store.put('server-a','settings',{id:'main',zone:'Asia/Tokyo'});const i=h.interaction('settings','timezone',{zone:'Not a timezone'});
  i.deferReply=async()=>{throw Error('Validation must reply immediately');};
  await h.app.dispatch(i);assert.match(h.outputs[0].content,/Choose a timezone/);assert.equal(h.store.get('server-a','settings','main').zone,'Asia/Tokyo');assert.equal(i.replied,true);h.store.close();
});

test('unknown saved names across commands get immediate useful replies without network work',async()=>{
  for(const [command,subs,key] of [['embed',['edit','send','delete','remove-section'],'message'],['schedule',['show','edit','post','configure','cancel'],'event'],['instagram',['preview','pause','resume','remove'],'source']]) {
    for(const sub of subs){const h=harness();const i=h.interaction(command,sub,{[key]:'deleted'});i.guild.channels.fetch=async()=>{throw Error('Must not fetch a missing item');};await h.app.dispatch(i);assert.match(h.outputs[0].content,/no longer available/);assert.equal(i.replied,true);h.store.close();}
  }
});

test('regular members get immediate permission replies for every staff subcommand',async()=>{
  const publicNames=new Set(['help','schedule list','schedule show']);
  for(const [name,values] of Object.entries(scenarios)) {
    if(publicNames.has(name))continue;
    const h=harness({manager:false}),[command,sub]=name.split(' '),i=h.interaction(command,sub,values);
    await h.app.dispatch(i);assert.match(h.outputs[0].content,/Manage Server|staff action/);assert.equal(i.replied,true);assert.ok(!i.deferred);assert.equal(h.sent.length,0);h.store.close();
  }
});

test('failed message publishing and channel permission checks finish with an error reply',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'saved',name:'Test',embed:{description:'Hello'}});
  h.channel.send=async()=>{throw Object.assign(Error('Missing Permissions'),{code:50013});};
  const i=h.interaction('embed','send',{message:'saved'});await h.app.dispatch(i);assert.equal(i.replied,true);assert.match(h.outputs[0].content,/permissions/);assert.match(h.outputs[0].content,/Reference:/);h.store.close();
});

test('an event cancelled during a channel lookup cannot be revived by configure',async()=>{
  const h=harness();h.store.put('server-a','event',{id:'event',title:'Meeting',channel:h.channel.id,start:Date.now()+600000,duration:60,repeat:'none',kind:'event'});
  h.channel.guild.channels.cache.clear();h.channel.guild.channels.fetch=async()=>{const e=h.store.get('server-a','event','event');e.cancelled=true;h.store.put('server-a','event',e);return h.channel;};
  await h.app.dispatch(h.interaction('schedule','configure',{event:'event',duration:90}));assert.equal(h.store.get('server-a','event','event').cancelled,true);assert.match(h.outputs[0].content,/no longer active/);h.store.close();
});

test('an announcement removed while permissions are being checked is not posted',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'saved',name:'Old',embed:{description:'Hello'}});
  h.channel.guild.channels.cache.clear();h.channel.guild.channels.fetch=async()=>{h.store.remove('server-a','embed','saved');return h.channel;};
  await h.app.dispatch(h.interaction('embed','send',{message:'saved'}));assert.equal(h.sent.length,0);assert.match(h.outputs[0].content,/no longer available/);h.store.close();
});

test('a failed confirmation edit sends the result separately without publishing twice',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'saved',name:'Test',embed:{description:'Hello'}});
  const i=h.interaction('embed','send',{message:'saved'}),followups=[];i.editReply=async()=>{throw Error('PATCH failed');};i.followUp=async p=>followups.push(p);
  await h.app.dispatch(i);assert.equal(h.sent.length,1);assert.equal(followups.length,1);assert.match(followups[0].content,/Message shared:/);assert.equal(followups[0].flags,64);h.store.close();
});

test('invalid reminder settings do not partially overwrite an existing event',async()=>{
  const h=harness();h.store.put('server-a','event',{id:'event',title:'Meeting',channel:h.channel.id,start:Date.now()+600000,duration:60,repeat:'none',kind:'event'});
  await h.app.dispatch(h.interaction('schedule','configure',{event:'event',repeat:'daily',duration:1440}));const saved=h.store.get('server-a','event','event');assert.equal(saved.duration,60);assert.equal(saved.repeat,'none');assert.match(h.outputs[0].content,/finish before/);h.store.close();
});

test('staff access cannot be delegated to everyone or an app-managed role',async()=>{
  const h=harness();const i=h.interaction('settings','staff');i.options.getRole=()=>({id:i.guildId,managed:false});await h.app.dispatch(i);assert.match(h.outputs[0].content,/@everyone/);assert.equal(h.store.get('server-a','settings','main'),undefined);h.store.close();
});

test('combined embed form saves a renamed draft, closes, reopens and publishes from its builder',async()=>{
  const h=harness();await h.app.handle(h.interaction('embed','create',{name:'Welcome'}));
  const d=h.store.list('server-a','embed')[0];assert.equal(h.outputs[0].custom_id,`embedform:${d.id}:form`);assert.equal(h.outputs[0].components.length,5);
  const form=h.interaction();Object.assign(form,{isChatInputCommand:()=>false,isModalSubmit:()=>true,isFromMessage:()=>false,customId:`embedform:${d.id}:form`,fields:{getTextInputValue:k=>({name:'Member welcome',title:'Welcome!',description:'Visit <#234567890123456789>',color:'blue',content:'Hello everyone'})[k]}});
  await h.app.handle(form);const panel=h.outputs.at(-1);assert.match(panel.content,/Saved automatically/);assert.equal(panel.components.length,5);for(const row of panel.components)ActionRowBuilder.from(row).toJSON();
  const saved=h.store.get('server-a','embed',d.id);assert.equal(saved.name,'Member welcome');assert.equal(saved.embed.color,0x3498db);assert.ok(saved.updatedAt);
  const button=action=>Object.assign(h.interaction(),{isChatInputCommand:()=>false,isButton:()=>true,customId:`embed:${d.id}:${action}`});
  await h.app.handle(button('save'));assert.deepEqual(h.outputs.at(-1).components,[]);assert.match(h.outputs.at(-1).content,/is saved/);
  await h.app.handle(h.interaction('embed','edit',{message:d.id}));assert.equal(h.outputs.at(-1).embeds[0].toJSON().title,'Welcome!');
  for(const [action,value] of [['channel',h.channel.id],['role','345678901234567890'],['user',h.member.id]]) {
    const i=Object.assign(h.interaction(),{isChatInputCommand:()=>false,isChannelSelectMenu:()=>action==='channel',isRoleSelectMenu:()=>action==='role',isUserSelectMenu:()=>action==='user',customId:`embed:${d.id}:${action}`,values:[value]});await h.app.dispatch(i);assert.equal(i.replied,true);
  }
  const publish=button('publish');publish.id='987654321098765432';await h.app.handle(publish);
  assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].allowedMentions,{parse:[],roles:['345678901234567890'],users:[h.member.id]});assert.equal(h.sent[0].nonce,publish.id);assert.equal(h.sent[0].enforceNonce,true);assert.ok(h.store.get('server-a','embed',d.id));assert.match(h.outputs.at(-1).content,/Message shared/);h.store.close();
});

test('a stalled confirmation request cannot hold a successful embed send indefinitely or trigger a repost', {timeout:2000},async()=>{
  const h=harness({replyEditTimeoutMs:10});h.store.put('server-a','embed',{id:'saved',name:'Test',embed:{description:'Hello'}});
  const i=h.interaction('embed','send',{message:'saved'}),followups=[];i.editReply=()=>new Promise(()=>{});i.followUp=async p=>followups.push(p);i.deleteReply=async()=>{throw Error('Must not delete the completed result');};
  await h.app.dispatch(i);assert.equal(h.sent.length,1);assert.equal(followups.length,1);assert.match(followups[0].content,/Message shared/);assert.equal(followups[0].flags,64);h.store.close();
});

for(const stage of ['channel','role','member','send'])test(`Publish stops and reports a never-returning ${stage} request`,{timeout:1000},async()=>{
  const h=harness({operationTimeoutMs:30}),never=()=>new Promise(()=>{});let attempts=0;
  h.store.put('server-a','embed',{id:'saved',name:'Test',embed:{description:'Hello'}});
  if(stage==='channel'){h.channel.guild.channels.cache.clear();h.channel.guild.channels.fetch=never;}
  if(stage==='role')h.channel.guild.roles.fetch=never;
  if(stage==='member')h.channel.guild.members.fetch=never;
  if(stage==='send')h.channel.send=()=>{attempts++;return never();};
  const i=h.interaction('embed','send',{message:'saved',...(stage==='role'?{role:'345678901234567890'}:{}),...(stage==='member'?{user:h.member.id}:{})});
  await h.app.dispatch(i);assert.equal(i.replied,true);assert.ok(!i.deferred);assert.equal(h.outputs.length,1);assert.match(h.outputs[0].content,/too long|timed out|did not confirm/);assert.ok(h.store.get('server-a','embed','saved'));assert.equal(attempts,stage==='send'?1:0);if(stage==='send')assert.match(h.outputs[0].content,/before retrying/);h.store.close();
});

test('embed copies are independent saved drafts and require a fresh publishing destination',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'saved',name:'Original',sendChannel:h.channel.id,sendRole:'345678901234567890',sendUser:h.member.id,embed:{description:'Hello'}});
  const i=Object.assign(h.interaction(),{isChatInputCommand:()=>false,isButton:()=>true,customId:'embed:saved:copy'});await h.app.handle(i);
  const copy=h.store.list('server-a','embed').find(d=>d.id!=='saved');assert.equal(copy.name,'Original (copy)');assert.equal(copy.sendChannel,undefined);assert.equal(copy.sendRole,undefined);assert.equal(copy.sendUser,undefined);
  copy.embed.description='Changed';h.store.put('server-a','embed',copy);assert.equal(h.store.get('server-a','embed','saved').embed.description,'Hello');h.store.close();
});

test('missing publishing destinations and invalid form submissions preserve saved work',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'saved',name:'Original',embed:{description:'Keep this'}});
  const button=Object.assign(h.interaction(),{isChatInputCommand:()=>false,isButton:()=>true,customId:'embed:saved:publish'});await h.app.dispatch(button);assert.match(h.outputs.at(-1).content,/Choose a channel/);assert.equal(h.sent.length,0);
  const form=Object.assign(h.interaction(),{isChatInputCommand:()=>false,isModalSubmit:()=>true,isFromMessage:()=>false,customId:'embedform:saved:form',fields:{getTextInputValue:k=>({name:'Renamed',title:'',description:'',color:'',content:''})[k]}});await h.app.dispatch(form);
  assert.equal(h.store.get('server-a','embed','saved').name,'Original');assert.equal(h.store.get('server-a','embed','saved').embed.description,'Keep this');h.store.close();
});
test('only staff can create embeds, while all members can use help',async()=>{
  const h=harness({manager:false});await assert.rejects(h.app.handle(h.interaction('embed','create',{name:'Test'})),/Manage Server/);
  await h.app.handle(h.interaction('help',null));assert.match(h.outputs[0].embeds[0].toJSON().title,/Number One/);assert.equal(h.store.list('server-a','embed').length,0);h.store.close();
});
test('embed form saves edits and publication only permits explicit mentions',async()=>{
  const h=harness();await h.app.handle(h.interaction('embed','create',{name:'Welcome'}));
  const d=h.store.list('server-a','embed')[0];const i=h.interaction();
  Object.assign(i,{isChatInputCommand:()=>false,isModalSubmit:()=>true,isFromMessage:()=>true,customId:`embedform:${d.id}:text`,fields:{getTextInputValue:k=>({title:'Welcome',description:`Visit <#${h.channel.id}>`,color:'E5A1B3',content:'@everyone hello'})[k]}});
  await h.app.handle(i);assert.equal(h.store.get('server-a','embed',d.id).embed.title,'Welcome');
  await h.app.handle(h.interaction('embed','send',{message:d.id,role:'345678901234567890'}));
  assert.deepEqual(h.sent[0].allowedMentions,{parse:[],roles:['345678901234567890'],users:[]});assert.match(h.sent[0].content,/@everyone/);h.store.close();
});
test('another server cannot publish an embed by guessing its ID',async()=>{
  const h=harness({guildId:'server-b'});h.store.put('server-a','embed',{id:'secret',name:'Secret',embed:{description:'private'}});
  await assert.rejects(h.app.handle(h.interaction('embed','send',{message:'secret'})),/no longer available/);assert.equal(h.sent.length,0);h.store.close();
});
test('staff meetings require a private channel and future local time',async()=>{
  const h=harness();await assert.rejects(h.app.handle(h.interaction('schedule','add',{title:'Meeting',start:'2030-12-01T19:00',kind:'staff-meeting'})),/hidden from/);assert.equal(h.store.list('server-a','event').length,0);h.store.close();
  const p=harness({privateChannel:true});await p.app.handle(p.interaction('schedule','add',{title:'Meeting',start:'2030-12-01T19:00',kind:'staff-meeting',repeat:'weekly'}));
  const e=p.store.list('server-a','event')[0];assert.equal(e.zone,'America/New_York');assert.equal(e.repeat,'weekly');assert.equal(e.reminder,30);p.store.close();
});
test('private schedule details are withheld and RSVP requires channel access',async()=>{
  const h=harness({manager:false,visible:false,privateChannel:true});
  const event={id:'meeting',title:'Private',channel:h.channel.id,start:Date.now()+600000,duration:60,rsvps:{}};h.store.put('server-a','event',event);
  await assert.rejects(h.app.handle(h.interaction('schedule','show',{event:'meeting'})),/cannot view/);
  const button=h.interaction();Object.assign(button,{isButton:()=>true,isChatInputCommand:()=>false,customId:`rsvp:meeting:${event.start}:going`});
  await assert.rejects(h.app.handle(button),/cannot view/);assert.deepEqual(h.store.get('server-a','event','meeting').rsvps,{});h.store.close();
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
  await h.app.handle(i);assert.equal(i.replied,true);assert.match(h.outputs[0].content,/older or unavailable/);assert.match(h.outputs[0].content,/schedule list/);h.store.close();
});
test('slow channel work is acknowledged before the REST request',async()=>{
  const h=harness();const e={id:'event',title:'Test',channel:h.channel.id,start:Date.now()+600000,duration:60,zone:'America/New_York',kind:'event',repeat:'none'};
  h.store.put('server-a','event',e);const i=h.interaction('schedule','show',{id:e.id});i.guild.channels.cache.clear();
  i.guild.channels.fetch=async()=>{assert.equal(i.replied,true);return h.channel;};
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

test('clearing the only embed content is rejected without corrupting its saved template',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'fields',name:'Fields only',embed:{fields:[{name:'Title',value:'Text'}]}});
  const i=h.interaction();Object.assign(i,{isButton:()=>true,isChatInputCommand:()=>false,customId:'embed:fields:clearfields'});
  await assert.rejects(h.app.handle(i),/Add a title/);assert.equal(h.store.get('server-a','embed','fields').embed.fields.length,1);h.store.close();
});
test('simultaneous RSVPs retain both members after asynchronous permission checks',async()=>{
  const h=harness();const start=Date.now()+600000;
  h.store.put('server-a','event',{id:'meeting',title:'Test',channel:h.channel.id,start,duration:60,rsvps:{}});
  const first=h.interaction(),second=h.interaction();second.user={id:'345678901234567890'};
  for(const i of [first,second])Object.assign(i,{isButton:()=>true,isChatInputCommand:()=>false,customId:`rsvp:meeting:${start}:going`});
  await Promise.all([h.app.handle(first),h.app.handle(second)]);
  assert.deepEqual(h.store.get('server-a','event','meeting').rsvps,{[first.user.id]:'going',[second.user.id]:'going'});h.store.close();
});
test('help dropdown updates the original menu without requiring staff access',async()=>{
  const h=harness({manager:false});const i=h.interaction();
  Object.assign(i,{isChatInputCommand:()=>false,isStringSelectMenu:()=>true,customId:'help:topic',values:['events']});
  await h.app.dispatch(i);assert.ok(!i.deferred&&i.replied);assert.match(h.outputs[0].embeds[0].toJSON().title,/Events & schedules/);assert.equal(h.outputs[0].components[0].components[0].type,3);h.store.close();
});
test('command autocomplete responds with saved names without deferring or exposing another server',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'ours',name:'Welcome'});h.store.put('other','embed',{id:'secret',name:'Secret'});
  const i=h.interaction('embed','edit');Object.assign(i,{isAutocomplete:()=>true,isChatInputCommand:()=>false,respond:async options=>h.outputs.push(options)});i.options.getFocused=()=>({name:'message',value:'wel'});
  await h.app.dispatch(i);assert.ok(!i.deferred);assert.deepEqual(h.outputs[0],[{name:'Welcome',value:'ours'}]);h.store.close();
});
test('every message-edit form opens with readable labels and valid Discord lengths',async()=>{
  const h=harness();h.store.put('server-a','embed',{id:'message',name:'Welcome',embed:{description:'Hello'}});
  for(const action of ['text','media','field','branding']) {
    const i=h.interaction();Object.assign(i,{isChatInputCommand:()=>false,isButton:()=>true,customId:`embed:message:${action}`});await h.app.handle(i);
    const form=h.outputs.at(-1);assert.equal(form.title,'Number One · Edit message');
    for(const row of form.components){const input=row.components[0];assert.ok(input.label.length<=45);assert.doesNotMatch(input.label,/URL|Hex|Inline|field/i);}
  }
  h.store.close();
});
test('empty saved lists offer a next step and delivery status omits internal failure details',async()=>{
  const h=harness();await h.app.handle(h.interaction('embed','list'));assert.match(h.outputs.at(-1).content,/No saved messages yet/);
  await h.app.handle(h.interaction('instagram','list'));assert.match(h.outputs.at(-1).content,/No sources yet/);
  h.store.put('server-a','feed',{id:'feed',name:'Updates',error:'XML parser schema stacktrace'});await h.app.handle(h.interaction('settings','status'));
  assert.match(h.outputs.at(-1).content,/Updates needs attention/);assert.doesNotMatch(h.outputs.at(-1).content,/XML|schema|stacktrace/);h.store.close();
});
test('/help sends its menu immediately without deferring or editing a webhook reply',async()=>{
  const h=harness();const i=h.interaction('help',null);
  i.deferReply=async()=>{throw Error('Help must not send a thinking response');};i.editReply=async()=>{throw Error('Help must not depend on editing a webhook response');};
  await h.app.handle(i);assert.equal(i.replied,true);assert.equal(h.outputs[0].flags,undefined);assert.equal(h.outputs[0].components[0].components[0].type,3);h.store.close();
});

test('empty schedule replies immediately without a thinking response or channel lookup',async()=>{
  const h=harness();const i=h.interaction('schedule','list');
  i.deferReply=async()=>{throw Error('Must reply directly');};i.editReply=async()=>{throw Error('Must not edit a webhook');};
  i.guild.channels.fetch=async()=>{throw Error('Must not fetch channels');};
  await h.app.handle(i);assert.equal(i.replied,true);assert.equal(h.outputs[0].flags,64);assert.match(h.outputs[0].content,/No upcoming events/);assert.match(h.outputs[0].content,/schedule add/);h.store.close();
});

test('schedule list hides inaccessible, uncached, cancelled, completed and expired events without fetching',async()=>{
  const h=harness({manager:false}),start=Date.now()+600000;
  for(const [id,extra] of [['visible',{}],['hidden',{channel:'hidden'}],['uncached',{channel:'missing'}],['cancelled',{cancelled:true}],['complete',{complete:true}],['expired',{start:Date.now()-7200000}]])h.store.put('server-a','event',{id,title:id,channel:h.channel.id,start,duration:60,...extra});
  h.channel.guild.channels.cache.set('hidden',{type:0,permissionsFor:()=>new PermissionsBitField([])});
  h.channel.guild.channels.fetch=async()=>{throw Error('Must not fetch channels');};
  await h.app.handle(h.interaction('schedule','list',{page:999}));const text=h.outputs[0].content;
  assert.match(text,/visible/);assert.match(text,/page 1\/1/);assert.doesNotMatch(text,/hidden|uncached|cancelled|complete|expired/);h.store.close();
});

test('schedule empty state also covers servers containing only inaccessible or inactive events',async()=>{
  const h=harness({manager:false,visible:false});h.store.put('server-a','event',{id:'private',title:'Secret meeting',channel:h.channel.id,start:Date.now()+600000,duration:60});
  await h.app.handle(h.interaction('schedule','list'));assert.match(h.outputs[0].content,/No upcoming events/);assert.doesNotMatch(h.outputs[0].content,/Secret|schedule add/);h.store.close();
});

test('production dispatcher routes Instagram setup and channel/role pickers to their saved draft',async()=>{
  const h=harness();await h.app.dispatch(h.interaction('instagram','setup'));
  const d=h.store.list('server-a','instagram-draft')[0];assert.ok(d);assert.equal(h.outputs.at(-1).flags,64);
  for(const [action,value] of [['channel',h.channel.id],['role','345678901234567890']]) {
    const i=h.interaction();Object.assign(i,{isChatInputCommand:()=>false,isChannelSelectMenu:()=>action==='channel',isRoleSelectMenu:()=>action==='role',customId:`instagram:${d.id}:${action}`,values:[value]});
    await h.app.dispatch(i);assert.equal(i.replied,true);assert.ok(!i.deferred);assert.equal(h.store.get('server-a','instagram-draft',d.id)[action],value);
  }
  const button=h.interaction();Object.assign(button,{isChatInputCommand:()=>false,isButton:()=>true,customId:`instagram:${d.id}:schedule`});await h.app.dispatch(button);assert.match(h.outputs.at(-1).title,/Delivery schedule/);assert.ok(!button.deferred);h.store.close();
});

test('a server staff role can configure Instagram without bot-owner access; regular members cannot',async()=>{
  const h=harness({manager:false});await h.app.dispatch(h.interaction('instagram','setup'));assert.equal(h.store.list('server-a','instagram-draft').length,0);
  h.store.put('server-a','settings',{id:'main',zone:'Europe/Paris',staff:'helpers'});h.member.roles.cache.set('helpers',{});
  await h.app.dispatch(h.interaction('instagram','setup'));assert.equal(h.store.list('server-a','instagram-draft')[0].zone,'Europe/Paris');h.store.close();
});

test('retired /feed returns current-command guidance and missing channels do not prevent removal',async()=>{
  const h=harness();await h.app.handle(h.interaction('feed','list'));assert.match(h.outputs.at(-1).content,/older or unavailable/);
  h.store.put('server-a','feed',{id:'orphan',name:'Old source',channel:'gone'});await h.app.handle(h.interaction('instagram','remove',{source:'orphan'}));assert.equal(h.store.list('server-a','feed').length,0);h.store.close();
});
