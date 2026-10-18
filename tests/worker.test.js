import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionsBitField,PermissionFlagsBits as P} from 'discord.js';
import {Store} from '../src/store.js';
import {startWorker} from '../src/worker.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('due reminders send once across worker restarts; cancelled events send nothing',async()=>{
  const store=new Store(':memory:');const start=Date.now()+60000;const payloads=[];
  store.put('g','event',{id:'event',channel:'c',kind:'event',title:'Meeting',start,reminder:5,duration:60,repeat:'none',zone:'America/New_York'});
  store.put('g','event',{id:'cancelled',channel:'c',kind:'event',title:'Cancelled',start,reminder:5,duration:60,cancelled:true});
  const client={channels:{fetch:async()=>({guildId:'g',isTextBased:()=>true,send:async p=>{payloads.push(p);return {id:'sent'};}})}};
  let stop=startWorker(client,store);await settle();stop();assert.equal(payloads.length,1);assert.equal(payloads[0].components[0].components.length,3);
  stop=startWorker(client,store);await settle();stop();assert.equal(payloads.length,1);store.close();
});
test('a staff channel becoming public withholds reminder delivery',async()=>{
  const store=new Store(':memory:');store.put('g','event',{id:'staff',channel:'c',kind:'staff-meeting',title:'Secret meeting',start:Date.now()+60000,reminder:5,duration:60});
  let sent=0;const client={channels:{fetch:async()=>({guildId:'g',guild:{roles:{everyone:'everyone'}},permissionsFor:()=>new PermissionsBitField([P.ViewChannel]),isTextBased:()=>true,send:async()=>{sent++;return{id:'sent'};}})}};
  const stop=startWorker(client,store);await settle();stop();assert.equal(sent,0);assert.match(store.get('g','event','staff').error,/no longer private/);store.close();
});
test('expired one-off events complete without sending stale reminders',async()=>{
  const store=new Store(':memory:');store.put('g','event',{id:'old',channel:'c',kind:'event',title:'Old',start:Date.now()-86400000,reminder:30,duration:60,repeat:'none'});
  const stop=startWorker({channels:{fetch:async()=>{throw Error('Should not send');}}},store);await settle();stop();assert.equal(store.get('g','event','old').complete,true);store.close();
});
