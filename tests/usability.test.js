import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionFlagsBits as P,PermissionsBitField} from 'discord.js';
import {Store} from '../src/store.js';
import {suggestions} from '../src/suggestions.js';
import {parseColor,parseTime} from '../src/domain.js';
import {commands} from '../src/commands.js';
import {UserError} from '../src/user-error.js';
import {reportFailure} from '../src/responses.js';
function query(command,name,value='',sub='show') {
  return {commandName:command,guildId:'mine',member:{id:'member'},inGuild:()=>true,options:{getFocused:()=>({name,value}),getSubcommand:()=>sub},guild:{channels:{cache:new Map()}}};
}
test('saved message and source suggestions use names and stay within their server and staff access',()=>{
  const s=new Store(':memory:');s.put('mine','embed',{id:'a',name:'Welcome'});s.put('other','embed',{id:'b',name:'Private announcement'});s.put('mine','feed',{id:'f',name:'Music updates'});
  assert.deepEqual(suggestions(s,query('embed','message','wel'),{canManage:true}),[{name:'Welcome',value:'a'}]);
  assert.deepEqual(suggestions(s,query('embed','message'),{canManage:false}),[]);
  assert.deepEqual(suggestions(s,query('instagram','source','music'),{canManage:true}),[{name:'Music updates',value:'f'}]);s.close();
});
test('event suggestions never reveal inaccessible meetings or allow nonstaff management choices',()=>{
  const s=new Store(':memory:');s.put('mine','event',{id:'public',title:'Community night',channel:'public'});s.put('mine','event',{id:'secret',title:'Private meeting',channel:'secret'});
  const i=query('schedule','event');i.guild.channels.cache.set('public',{permissionsFor:()=>new PermissionsBitField([P.ViewChannel])});i.guild.channels.cache.set('secret',{permissionsFor:()=>new PermissionsBitField([])});
  assert.deepEqual(suggestions(s,i),[{name:'Community night',value:'public'}]);i.options.getSubcommand=()=> 'cancel';assert.deepEqual(suggestions(s,i),[]);s.close();
});
test('timezone suggestions accept city names and keep timezone changes staff-only',()=>{
  const s=new Store(':memory:');assert.equal(suggestions(s,query('settings','zone','new york'),{canConfigure:true})[0].value,'America/New_York');
  assert.equal(suggestions(s,query('schedule','zone','seoul'),{canManage:true})[0].value,'Asia/Seoul');
  assert.deepEqual(suggestions(s,query('settings','zone','new york')),[]);s.close();
});
test('dates with ordinary spaces and named colors work without special codes',()=>{
  assert.equal(parseTime('2027-01-15 19:00','America/New_York'),parseTime('2027-01-15T19:00','America/New_York'));
  assert.equal(parseColor('pink'),0xe5a1b3);assert.equal(parseColor('BLUE'),0x3498db);assert.equal(parseColor('#E5A1B3'),0xe5a1b3);assert.equal(parseColor('black'),0);
  assert.throws(()=>parseColor('unknown'),/Choose a color/);
});
test('saved-item options use meaningful names and descriptions avoid backend terminology',()=>{
  const descriptions=[];for(const c of commands){descriptions.push(c.description);for(const sub of c.options||[]){descriptions.push(sub.description);for(const opt of sub.options||[]){descriptions.push(opt.description);assert.notEqual(opt.name,'id');if(['message','event','source'].includes(opt.name))assert.equal(opt.autocomplete,true);}}}
  assert.doesNotMatch(descriptions.join(' '),/IANA|ISO |recurrence|occurrences|hostname|schema|payload|saved item ID|user IDs/i);
});
test('users see helpful validation messages while unexpected backend errors stay in the console',async()=>{
  const messages=[],logs=[];const i={commandName:'feed',reply:async p=>messages.push(p.content)};
  await reportFailure(i,Error('XML parser failed with internal details'),s=>logs.push(s));assert.doesNotMatch(messages[0],/XML|internal details/);assert.match(logs[0],/XML/);
  await reportFailure(i,new UserError('Choose a source from the suggestions.'),()=>{});assert.match(messages[1],/Choose a source/);
});
