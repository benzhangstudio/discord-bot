import test from 'node:test';
import assert from 'node:assert/strict';
import {commands} from '../src/commands.js';
import {moderationCommands} from '../src/moderation-commands.js';
import {validateCommandSchema} from '../src/command-schema.js';
import {registerCommands,syncApplicationCommands} from '../src/registration.js';

test('the complete serialized production command inventory is valid',()=>{
  assert.equal(validateCommandSchema(commands),commands);
  validateCommandSchema(JSON.parse(JSON.stringify(commands)));
});

test('case options preserve their names and saved-item names remain meaningful',()=>{
  const c=commands.find(c=>c.name==='case');assert(c.options.every(o=>o.type!==1));
  assert.equal(c.options.find(o=>o.name==='number').type,4);
  assert(c.options.every(o=>!o.autocomplete));
  // Every moderation definition must survive shared command normalization.
  for(const original of moderationCommands)assert.deepEqual(JSON.parse(JSON.stringify(commands.find(c=>c.name===original.name).options)),original.options);
  for(const [command,name] of [['embed','message'],['schedule','event'],['instagram','source']]) {
    const options=commands.find(c=>c.name===command).options.flatMap(s=>s.options||[]);
    assert.ok(options.some(o=>o.name===name));assert.ok(options.every(o=>o.name!=='id'));
  }
});

test('missing nested names reproduce the exact Discord rejection path',()=>{
  const broken=Array.from({length:9},(_,n)=>({type:1,name:'command'+n,description:'Example'}));broken[8].options=[{type:1,name:'view',description:'View',options:[{type:3,description:'Missing name'}]}];
  assert.throws(()=>validateCommandSchema(broken),/8\.options\[0\]\.options\[0\]\.name/);
});

const parameter={type:3,name:'value',description:'A value'};
const sub={type:1,name:'view',description:'View',options:[parameter]};
const root=options=>[{type:1,name:'example',description:'Example',options}];
for(const [label,body] of [
  ['empty name',root([{...parameter,name:''}])],
  ['uppercase name',root([{...parameter,name:'Bad'}])],
  ['missing description',root([{...parameter,description:undefined}])],
  ['duplicate names',root([parameter,parameter])],
  ['invalid type',root([{...parameter,type:12}])],
  ['too many options',root(Array.from({length:26},(_,n)=>({...parameter,name:'value'+n})))],
  ['required after optional',root([parameter,{...parameter,name:'next',required:true}])],
  ['mixed subcommands and parameters',root([sub,parameter])],
  ['nested subcommand',root([{...sub,options:[sub]}])],
  ['group containing parameter',root([{...sub,type:2,options:[parameter]}])],
  ['parameter containing options',root([{...parameter,options:[parameter]}])],
  ['choices with autocomplete',root([{...parameter,autocomplete:true,choices:[{name:'One',value:'one'}]}])],
  ['wrong choice value type',root([{...parameter,choices:[{name:'One',value:1}]}])],
])test(`schema rejects ${label}`,()=>assert.throws(()=>validateCommandSchema(body),/Invalid application command schema/));

test('valid subcommand groups are validated recursively',()=>{
  validateCommandSchema(root([{type:2,name:'group',description:'Group',options:[sub]}]));
});

test('both registration entry points reject malformed payloads before any REST call',async()=>{
  const option=commands.find(c=>c.name==='embed').options[0].options[0],original=option.name;
  let calls=0;const rest={get:async()=>{calls++;},put:async()=>{calls++;}};
  try {
    delete option.name;
    await assert.rejects(syncApplicationCommands({rest,applicationId:'app'}),/options\[0\]\.options\[0\]\.name/);
    for(const guild of [undefined,'test'])await assert.rejects(registerCommands(rest,'app',guild),/options\[0\]\.options\[0\]\.name/);
    assert.equal(calls,0);
  } finally {option.name=original;}
});
