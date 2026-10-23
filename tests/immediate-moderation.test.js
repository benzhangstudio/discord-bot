import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,Guild,ChatInputCommandInteraction,PermissionFlagsBits as P} from 'discord.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
const gid='111111111111111111',actorId='222222222222222222',botId='333333333333333333',targetId='444444444444444444',botRole='555555555555555555',memberRole='666666666666666666';
function harness({admin=false,missingRole=false}={}){
 const client=new Client({intents:[]}),store=new Store(':memory:'),requests=[];
 const user=(id,bot=false)=>({id,username:id===targetId?'Alex':'Tester',discriminator:'0',avatar:null,bot});
 client.user=client.users._add(user(botId,true));
 const role=(id,position,permissions)=>({id,name:id,position,permissions:String(permissions),color:0,hoist:false,managed:false,mentionable:false});
 const member=(id,roles,bot=false)=>({user:user(id,bot),roles,joined_at:new Date().toISOString(),deaf:false,mute:false});
 const guild=new Guild(client,{id:gid,name:'Test server',owner_id:actorId,unavailable:false,roles:[role(gid,0,0n),role(botRole,20,P.ModerateMembers),role(memberRole,1,admin?P.Administrator:0n)],members:[member(actorId,[]),member(botId,[botRole],true),member(targetId,[memberRole])],channels:[],emojis:[],stickers:[]});
 client.guilds.cache.set(gid,guild);
 let lookups=0;
 for(const [object,key]of [[guild,'fetch'],[guild.members,'fetch'],[guild.members,'fetchMe'],[guild.roles,'fetch']])object[key]=()=>{lookups++;return new Promise(()=>{});};
 client.rest.post=async(route,{body})=>{requests.push({route,body});};
 const app=createApp(client,store,{operationTimeoutMs:20,acknowledgementDelayMs:0,confirmationTransport:async()=>{throw Error('A webhook reply would wait 693 seconds; it must not be used.');}});
 const interaction=name=>new ChatInputCommandInteraction(client,{id:'777777777777777777',application_id:botId,type:2,token:'test-interaction-token',version:1,guild_id:gid,channel:{id:'888888888888888888',type:0},data:{id:'999999999999999999',name,type:1,options:[{name:'user',type:6,value:targetId},...(name==='warn'?[{name:'reason',type:3,value:'Please follow the rules'}]:[])],resolved:{users:{[targetId]:user(targetId)},members:{[targetId]:{roles:missingRole?[memberRole,'101010101010101010']:[memberRole],joined_at:new Date().toISOString(),permissions:admin?'8':'0'}}}},member:{...member(actorId,[]),permissions:'8'},entitlements:[],authorizing_integration_owners:{},locale:'en-US'});
 return {app,store,client,guild,requests,interaction,get lookups(){return lookups;},close(){app.stop();client.destroy();store.close();}};
}
test('real SDK: admin-target warn error is the initial public response, with zero deferrals or webhook edits',async()=>{
 const h=harness({admin:true});try{const i=h.interaction('warn');await h.app.dispatch(i);assert.equal(h.lookups,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.type,4);assert.equal(h.requests[0].body.data.flags,undefined);assert.match(h.requests[0].body.data.content,/can’t moderate server admins/);assert.equal(i.deferred,false);assert.equal(h.store.list(gid,'mod-case').length,0);}finally{h.close();}
});
test('real SDK: a valid warning is recorded and confirmed through one initial response with no network preflight',async()=>{
 const h=harness();try{const i=h.interaction('warn');await h.app.dispatch(i);assert.equal(h.lookups,0);assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.type,4);assert.match(h.requests[0].body.data.content,/Warning recorded for Alex/);assert.equal(i.deferred,false);assert.equal(h.store.list(gid,'mod-case').length,1);assert.equal(h.store.list(gid,'mod-case')[0].state,'succeeded');}finally{h.close();}
});
test('real SDK: incomplete signed role data fails closed immediately instead of guessing rank or opening thinking',async()=>{
 const h=harness({missingRole:true});try{const i=h.interaction('warn');await h.app.dispatch(i);assert.equal(h.lookups,0);assert.equal(h.requests[0].body.type,4);assert.match(h.requests[0].body.data.content,/Could not check this member/);assert.equal(i.deferred,false);assert.equal(h.store.list(gid,'mod-case').length,0);}finally{h.close();}
});
test('real SDK: local warnings history returns its final response without a REST preflight or deferral',async()=>{
 const h=harness();try{const i=h.interaction('warnings');await h.app.dispatch(i);assert.equal(h.lookups,0);assert.equal(h.requests[0].body.type,4);assert.match(h.requests[0].body.data.content,/No active warnings/);assert.equal(i.deferred,false);}finally{h.close();}
});
