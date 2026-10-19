import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,ChatInputCommandInteraction,PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {UserError} from '../src/user-error.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
test('real Discord SDK serializes /help as one immediate public callback containing the menu',async()=>{
  const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[];
  try {
    const app=createApp(client,store);
    client.rest.post=async(route,options)=>{requests.push({route,body:options.body});return undefined;};
    client.rest.patch=async()=>{throw Error('Help should not use a second request');};
    const i=new ChatInputCommandInteraction(client,{
      id:'123456789012345678',application_id:'234567890123456789',type:2,token:'test-only-interaction-token',version:1,guild_id:'345678901234567890',channel:{id:'456789012345678901',type:0},
      data:{id:'567890123456789012',name:'help',type:1},member:{user:{id:'678901234567890123',username:'Tester',discriminator:'0',avatar:null},roles:[],permissions:'32'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'
    });
    await app.handle(i);assert.equal(requests.length,1);assert.equal(requests[0].body.type,4);assert.ok(!(requests[0].body.data.flags & 64));
    assert.match(requests[0].body.data.embeds[0].title,/Number One/);assert.equal(requests[0].body.data.components[0].components[0].custom_id,'help:topic');assert.equal(i.replied,true);assert.equal(i.deferred,false);
  } finally {client.destroy();store.close();}
});

test('real Discord SDK sends an empty schedule as one immediate private callback',async()=>{
  const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[];
  try {
    const app=createApp(client,store);
    client.rest.post=async(route,options)=>{requests.push({route,body:options.body});};
    client.rest.patch=async()=>{throw Error('Schedule list must not require a second webhook request');};
    const i=new ChatInputCommandInteraction(client,{
      id:'123456789012345678',application_id:'234567890123456789',type:2,token:'test-only-interaction-token',version:1,guild_id:'345678901234567890',channel:{id:'456789012345678901',type:0},
      data:{id:'567890123456789012',name:'schedule',type:1,options:[{type:1,name:'list'}]},member:{user:{id:'678901234567890123',username:'Tester',discriminator:'0',avatar:null},roles:[],permissions:'32'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'
    });
    await app.handle(i);assert.equal(requests.length,1);assert.equal(requests[0].body.type,4);assert.equal(requests[0].body.data.flags&64,64);
    assert.match(requests[0].body.data.content,/No upcoming events/);assert.equal(i.replied,true);assert.equal(i.deferred,false);
  } finally {client.destroy();store.close();}
});

const fastCases=[
  ['settings','timezone',[{name:'zone',type:3,value:'Asia/Seoul'}]],['settings','view',[]],['settings','clear-staff',[]],['settings','status',[]],
  ['embed','create',[{name:'name',type:3,value:'Welcome'}]],['embed','list',[]],['embed','edit',[{name:'message',type:3,value:'saved'}]],['embed','remove-section',[{name:'message',type:3,value:'saved'},{name:'number',type:4,value:1}]],['embed','delete',[{name:'message',type:3,value:'saved'}]],
  ['instagram','setup',[]],['instagram','list',[]],['instagram','pause',[{name:'source',type:3,value:'saved'}]],['instagram','resume',[{name:'source',type:3,value:'saved'}]],['instagram','remove',[{name:'source',type:3,value:'saved'}]]
];
for(const [name,sub,options] of fastCases)test(`real Discord SDK: /${name} ${sub} sends a complete initial reply`,{timeout:2000},async()=>{
  const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[],guild='345678901234567890';
  try {
    store.put(guild,'embed',{id:'saved',name:'Saved',embed:{description:'Hello',fields:[{name:'Info',value:'Details'}]}});
    store.put(guild,'feed',{id:'saved',name:'Updates',channel:'456789012345678901',url:'https://example.com/rss'});
    const app=createApp(client,store);
    client.rest.post=async(route,request)=>{requests.push(request.body);};
    client.rest.patch=async()=>{throw Error('Local replies must not rely on a second webhook request');};
    const i=new ChatInputCommandInteraction(client,{
      id:'123456789012345678',application_id:'234567890123456789',type:2,token:'test-only-interaction-token',version:1,guild_id:guild,channel:{id:'456789012345678901',type:0},
      data:{id:'567890123456789012',name,type:1,options:[{type:1,name:sub,options}]},member:{user:{id:'678901234567890123',username:'Tester',discriminator:'0',avatar:null},roles:[],permissions:'32'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'
    });
    await app.handle(i);assert.equal(requests.length,1);
    if(name==='embed'&&sub==='create'){assert.equal(requests[0].type,9);assert.equal(requests[0].data.components.length,5);}
    else {assert.equal(requests[0].type,4);assert.equal(requests[0].data.flags&64,64);assert.ok(requests[0].data.content||requests[0].data.embeds?.length);}
    assert.equal(i.deferred,false);
    if(sub==='timezone')assert.equal(store.get(guild,'settings','main').zone,'Asia/Seoul');
  } finally {client.destroy();store.close();}
});

for(const failed of [false,true])test(`real Discord SDK: slow feed ${failed?'failure':'success'} completes its deferred response`,{timeout:2000},async()=>{
  const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[],guild='345678901234567890',channel='456789012345678901';let i;
  try {
    store.put(guild,'feed',{id:'saved',name:'Updates',channel,url:'https://example.com/rss'});
    const app=createApp(client,store,{feedLoader:async()=>{assert.equal(i.deferred,true);if(failed)throw new UserError('The feed service is unavailable. Try again later.');return[{key:'p',title:'Latest post',link:'https://example.com/post'}];}});
    client.rest.post=async(route,request)=>{requests.push({method:'POST',body:request.body});};
    client.rest.patch=async(route,request)=>{
      requests.push({method:'PATCH',body:request.body});
      return {id:'789012345678901234',channel_id:channel,type:0,content:request.body.content,author:{id:'234567890123456789',username:'Number One',discriminator:'0',avatar:null,bot:true},timestamp:new Date().toISOString(),edited_timestamp:null,tts:false,mention_everyone:false,mentions:[],mention_roles:[],attachments:[],embeds:[],components:[],flags:64};
    };
    i=new ChatInputCommandInteraction(client,{
      id:'123456789012345678',application_id:'234567890123456789',type:2,token:'test-only-interaction-token',version:1,guild_id:guild,channel:{id:channel,type:0},
      data:{id:'567890123456789012',name:'instagram',type:1,options:[{type:1,name:'preview',options:[{name:'source',type:3,value:'saved'}]}]},member:{user:{id:'678901234567890123',username:'Tester',discriminator:'0',avatar:null},roles:[],permissions:'32'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'
    });
    Object.defineProperty(i,'guild',{value:{channels:{cache:new Map([[channel,{type:0,permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.SendMessages,P.EmbedLinks])}]])},members:{me:{}}}});
    await app.dispatch(i);assert.equal(requests.length,2);assert.equal(requests[0].body.type,5);assert.equal(requests[1].method,'PATCH');
    assert.match(requests[1].body.content,failed?/feed service is unavailable/:/Latest post/);assert.equal(requests[1].body.flags,undefined);assert.equal(i.replied,true);
  } finally {client.destroy();store.close();}
});

test('real Discord SDK: a hung embed confirmation completes through a follow-up without reposting', {timeout:2000},async()=>{
  const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[],guild='345678901234567890',channel='456789012345678901';let sent=0;
  try {
    store.put(guild,'embed',{id:'saved',name:'Welcome',embed:{description:'Hello'}});
    const app=createApp(client,store,{replyEditTimeoutMs:5});
    const result=content=>({id:'789012345678901234',channel_id:channel,type:0,content,author:{id:'234567890123456789',username:'Number One',discriminator:'0',avatar:null,bot:true},timestamp:new Date().toISOString(),edited_timestamp:null,tts:false,mention_everyone:false,mentions:[],mention_roles:[],attachments:[],embeds:[],components:[],flags:64});
    client.rest.post=async(route,request)=>{requests.push({method:'POST',body:request.body});if(request.body.type===5)return;return result(request.body.content);};
    client.rest.patch=()=>new Promise(()=>{});
    client.rest.delete=async()=>{throw Error('Must not delete the completed waiting response');};
    const i=new ChatInputCommandInteraction(client,{
      id:'123456789012345678',application_id:'234567890123456789',type:2,token:'test-only-interaction-token',version:1,guild_id:guild,channel:{id:channel,type:0},
      data:{id:'567890123456789012',name:'embed',type:1,options:[{type:1,name:'send',options:[{name:'message',type:3,value:'saved'},{name:'channel',type:7,value:channel}]}],resolved:{channels:{[channel]:{id:channel,name:'announcements',type:0,permissions:'3072'}}}},member:{user:{id:'678901234567890123',username:'Tester',discriminator:'0',avatar:null},roles:[],permissions:'32'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'
    });
    const target={id:channel,type:0,permissionsFor:()=>new PermissionsBitField([P.ViewChannel,P.SendMessages,P.EmbedLinks]),send:async()=>{sent++;return{id:'posted',url:'https://discord.com/channels/server/channel/posted'};}};
    Object.defineProperty(i,'guild',{value:{channels:{cache:new Map([[channel,target]])},members:{me:{}}}});
    await app.dispatch(i);assert.equal(sent,1);assert.equal(requests.length,2);assert.equal(requests[0].body.type,5);assert.match(requests[1].body.content,/Message shared/);assert.equal(requests[1].body.flags,64);assert.equal(i.replied,true);
  } finally {client.destroy();store.close();}
});
