import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PUBLIC_ERROR_MESSAGES,publicErrorMessage,GENERIC_ERROR,UNCERTAIN_ACTION} from '../src/public-errors.js';
import {UserError} from '../src/user-error.js';
import {reportFailure} from '../src/responses.js';

const technical=/Wispbyte|MODERATION_MESSAGE_CONTENT|Message Content Intent|\.env\b|process\.env|node_modules|SQLITE_|HTTP_\d|ECONN\w+|\b(?:SDK|stack trace|preflight|payload|database|webhook|queue)\b|(?:C:|\/srv|\/home)\\?\//i;
test('every approved Discord error is concise and free of server diagnostics',()=>{
 assert.ok(Object.keys(PUBLIC_ERROR_MESSAGES).length>100);
 for(const [detail,message]of Object.entries(PUBLIC_ERROR_MESSAGES)){
  assert.ok(message.length<=160,detail);assert.doesNotMatch(message,technical,detail);
  assert.equal(publicErrorMessage(new UserError(detail)),message);
 }
});

test('new validation errors require reviewed public copy; raw strings cannot become public by accident',()=>{
 for(const file of readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.js'))){
  for(const line of readFileSync(new URL('../src/'+file,import.meta.url),'utf8').split('\n')){
   if(!/new UserError\(|\bmust\(|withDeadline\(/.test(line))continue;
   for(const match of line.matchAll(/'((?:\\.|[^'\\])*)'/g)){
    const message=match[1].replace(/\\'/g,"'");
    if(/^[A-Z]/.test(message)&&message.length>18&&/[.!?]$/.test(message))assert.ok(Object.hasOwn(PUBLIC_ERROR_MESSAGES,message),`${file}: review public copy for ${message}`);
   }
  }
 }
});
test('Discord response paths do not bypass the public formatter with raw exception fields',()=>{
 for(const file of readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.js'))){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/(?:content|description)\s*:\s*(?:safeError\(|(?:error|failure|exception)\.(?:message|stack|code))/i,file);
  assert.doesNotMatch(source,/(?:reply|followUp|editReply|respond|update)\([^\n]*(?:content|description)\s*:\s*(?:error|failure|exception)\.(?:message|stack|code)/i,file);
 }
});

const diagnostics=[
 'SQLITE_BUSY: database locked at C:/private/node_modules/store.js:52',
 'Set MODERATION_MESSAGE_CONTENT=1 in Wispbyte .env and restart the server.',
 'HTTP_500 webhook queue failed; payload contains https://private.example/?token=private-token',
 'TypeError: internal preflight at /srv/number-one/private.js:25',
 'DiscordAPIError[50013]: Missing Permissions',
];
for(const detail of diagnostics)for(const kind of ['Error','UserError','forged'])test(`${kind} server diagnostics never become Discord error copy: ${detail.slice(0,25)}`,async()=>{
 const error=kind==='UserError'?new UserError(detail):new Error(detail);
 if(kind==='forged'){error.name='UserError';error.publicMessage=detail;}
 const sent=[],logs=[];await reportFailure({commandName:'ban',reply:async p=>sent.push(p)},error,s=>logs.push(s));
 assert.equal(sent[0].content,GENERIC_ERROR);assert.doesNotMatch(JSON.stringify(sent),technical);assert.ok(sent[0].content.length<=160);
 assert.match(logs[0],/failed/);assert.ok(!JSON.stringify(sent).includes('private-token'));
});

test('hosting setup failures offer support guidance while preserving operator instructions only in logs',async()=>{
 const detail='Set MODERATION_MESSAGE_CONTENT=1, enable Message Content Intent in Discord, and restart before enabling automod.';
 const sent=[],logs=[];await reportFailure({reply:async p=>sent.push(p)},new UserError(detail),s=>logs.push(s));
 assert.equal(sent[0].content,'Automod is not enabled for this bot. Contact the bot operator.');
 assert.match(logs[0],/MODERATION_MESSAGE_CONTENT=1/);assert.doesNotMatch(sent[0].content,technical);
});

test('deferred errors and their independent fallback share safe copy and preserve privacy',async()=>{
 for(const privateResponse of [true,false]){
  const sent=[];let attempts=0;
  const i={commandName:'ban',deferred:true,privateResponse,confirmationTransport:async(_i,method,p)=>{attempts++;sent.push({method,...p});if(method==='PATCH')throw Error('SDK backend queue failed');}};
  await reportFailure(i,new UserError(diagnostics[1]),()=>{});
  assert.equal(attempts,2);assert.equal(sent[0].content,GENERIC_ERROR);assert.equal(sent[1].content,GENERIC_ERROR);
  assert.equal(sent[1].flags,privateResponse?64:undefined);assert.doesNotMatch(JSON.stringify(sent),technical);
 }
});

test('uncertain actions give useful next steps without server recovery instructions or blind retry advice',()=>{
 for(const detail of ['Discord outcome is uncertain.','Operation deadline expired. Inspect Discord before reconciliation.','Discord could not deliver the result. Check the destination before repeating the action.']){
  assert.equal(publicErrorMessage(new UserError(detail)),UNCERTAIN_ACTION);
 }
 assert.match(UNCERTAIN_ACTION,/Check the result before trying again/);
 assert.doesNotMatch(publicErrorMessage(new UserError('An earlier action for this target is uncertain. The server owner must inspect Discord and use /mod-reconcile.')),/mod-reconcile|uncertain/);
});

test('public permission and rate limit guidance never echoes Discord error codes',()=>{
 for(const code of [50013,50001,429,'HTTP_429','HTTP_403',10062,10015,10003,10007]){
  const message=publicErrorMessage(Object.assign(Error(diagnostics[0]),{code}));
  assert.ok(message.length<=160);assert.doesNotMatch(message,technical);assert.ok(!message.includes(String(code)));
 }
});
