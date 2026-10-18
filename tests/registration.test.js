import test from 'node:test';
import assert from 'node:assert/strict';
import {registerCommands} from '../src/registration.js';
import {commands} from '../src/commands.js';
test('public registration replaces global commands and removes server overrides owned by this application',async()=>{
  const writes=[],reads=[];
  const rest={put:async(route,payload)=>writes.push({route,...payload}),get:async route=>{
    reads.push(route);
    if(route==='/users/@me/guilds')return[{id:'one'},{id:'two'}];
    return route.includes('/one/')?[{name:'events'}]:[];
  }};
  await registerCommands(rest,'app',undefined,()=>{});
  assert.deepEqual(writes,[{route:'/applications/app/commands',body:commands},{route:'/applications/app/guilds/one/commands',body:[]}]);
  assert.ok(reads.includes('/applications/app/guilds/two/commands'));assert.equal(commands.some(c=>c.name==='events'),false);
});
test('test registration replaces only the selected guild command set',async()=>{
  const writes=[];
  await registerCommands({put:async(route,payload)=>writes.push({route,...payload}),get:async()=>{throw Error('Unexpected global operation');}},'app','test',()=>{});
  assert.deepEqual(writes,[{route:'/applications/app/guilds/test/commands',body:commands}]);
});
