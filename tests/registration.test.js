import test from 'node:test';
import assert from 'node:assert/strict';
import {registerCommands,syncApplicationCommands} from '../src/registration.js';
import {commands} from '../src/commands.js';
function fakeRest() {
  const writes=[],reads=[],data=new Map([
    ['/applications/app/commands',[{type:1,name:'events',description:'Old event library'}]],
    ['/applications/app/guilds/one/commands',[{type:1,name:'event',description:'Old event commands'}]],
    ['/applications/app/guilds/two/commands',[]]
  ]);
  return {writes,reads,data,put:async(route,payload)=>{writes.push({route,...payload});data.set(route,structuredClone(payload.body));},get:async(route,options)=>{
    reads.push({route,options});if(route==='/applications/@me')return{id:'app',name:'Number One'};
    if(route==='/users/@me/guilds')return[{id:'one'},{id:'two'}];return structuredClone(data.get(route)||[]);
  }};
}
test('startup sync replaces old global commands and removes verified server overrides',async()=>{
  const rest=fakeRest(),logs=[];await syncApplicationCommands({applicationId:'app',rest,log:s=>logs.push(s)});
  assert.deepEqual(rest.writes,[{route:'/applications/app/commands',body:commands},{route:'/applications/app/guilds/one/commands',body:[]}]);
  assert.deepEqual(rest.data.get('/applications/app/guilds/one/commands'),[]);assert.ok(logs.some(s=>s.includes('/events')));assert.ok(logs.at(-1).includes(`Verified ${commands.length} global commands`));
});
test('test registration replaces and verifies only the selected guild command set',async()=>{
  const rest=fakeRest();await registerCommands(rest,'app','test',()=>{});
  assert.deepEqual(rest.writes,[{route:'/applications/app/guilds/test/commands',body:commands}]);assert.equal(rest.data.get('/applications/app/commands')[0].name,'events');
});
test('normal restarts do not rewrite commands that already match',async()=>{
  const rest=fakeRest();await registerCommands(rest,'app',undefined,()=>{});rest.writes.length=0;
  await registerCommands(rest,'app',undefined,()=>{});assert.deepEqual(rest.writes,[]);
});
test('sync refuses to claim success if Discord retains an old global command',async()=>{
  const rest=fakeRest();rest.put=async()=>{};
  await assert.rejects(registerCommands(rest,'app',undefined,()=>{}),/did not match/);
});
test('sync verifies server-specific commands were actually removed',async()=>{
  const rest=fakeRest(),write=rest.put;rest.put=async(route,payload)=>{if(payload.body.length)await write(route,payload);};
  await assert.rejects(registerCommands(rest,'app',undefined,()=>{}),/still has server-specific commands/);
});
test('registration checks every page of joined servers',async()=>{
  const rest=fakeRest(),read=rest.get;let pages=0;
  rest.get=async(route,options)=>{
    if(route!=='/users/@me/guilds')return read(route,options);
    pages++;if(pages===1)return Array.from({length:200},(_,n)=>({id:String(n+1)}));
    assert.equal(options.query.get('after'),'200');return[{id:'one'}];
  };
  await registerCommands(rest,'app',undefined,()=>{});assert.equal(pages,2);assert.deepEqual(rest.data.get('/applications/app/guilds/one/commands'),[]);
});
test('wrong application credentials cannot remove another application’s commands',async()=>{
  const rest=fakeRest();await assert.rejects(syncApplicationCommands({applicationId:'wrong-app',rest,log:()=>{}}),/does not match/);assert.deepEqual(rest.writes,[]);
});
