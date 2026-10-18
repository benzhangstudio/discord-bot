import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,ChatInputCommandInteraction} from 'discord.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
test('real Discord SDK serializes /help as one immediate private callback containing the menu',async()=>{
  const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[];
  try {
    const app=createApp(client,store);
    client.rest.post=async(route,options)=>{requests.push({route,body:options.body});return undefined;};
    client.rest.patch=async()=>{throw Error('Help should not use a second request');};
    const i=new ChatInputCommandInteraction(client,{
      id:'123456789012345678',application_id:'234567890123456789',type:2,token:'test-only-interaction-token',version:1,guild_id:'345678901234567890',channel:{id:'456789012345678901',type:0},
      data:{id:'567890123456789012',name:'help',type:1},member:{user:{id:'678901234567890123',username:'Tester',discriminator:'0',avatar:null},roles:[],permissions:'32'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'
    });
    await app.handle(i);assert.equal(requests.length,1);assert.equal(requests[0].body.type,4);assert.equal(requests[0].body.data.flags,64);
    assert.match(requests[0].body.data.embeds[0].title,/Number One/);assert.equal(requests[0].body.data.components[0].components[0].custom_id,'help:topic');assert.equal(i.replied,true);assert.equal(i.deferred,false);
  } finally {client.destroy();store.close();}
});
