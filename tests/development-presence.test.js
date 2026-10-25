import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevelopmentPresence,DEVELOPMENT_ACTIVITY,DEVELOPMENT_WINDOW_MS} from '../src/development-presence.js';
import {application} from '../age-verification/server.js';
import {Store} from '../age-verification/core.js';
const T=Date.parse('2026-10-25T12:00:00Z'),A='a'.repeat(40),B='b'.repeat(40);
const commit=(sha,at)=>({sha,date:new Date(at).toISOString()});
const response=(sha,at,{status=200,headers={}}={})=>({status,ok:status===200,headers:{get:key=>headers[key]??null},json:async()=>[{sha,commit:{committer:{date:new Date(at).toISOString()}}}]});
function harness({initialCommit=null,fetcher}={}){
  let clock=T,sequence=0;const timers=new Map(),intervals=new Map(),calls=[],requests=[];
  const schedule=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:clock+ms});return id;};
  const service=createDevelopmentPresence({client:{isReady:()=>true,user:{setPresence:p=>calls.push(p)}},initialCommit,now:()=>clock,
    schedule,cancel:id=>timers.delete(id),every:fn=>{const id=++sequence;intervals.set(id,fn);return id;},stopEvery:id=>intervals.delete(id),
    fetcher:async(...args)=>{requests.push(args);return fetcher?fetcher(...args):response(A,T);},log:{warn(){}},requestTimeoutMs:5});
  return {service,calls,requests,timers,intervals,setTime:value=>{clock=value;},async advance(ms){clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await new Promise(setImmediate);}};
}

test('a recent commit shows BETA development activity and clears exactly one hour later, staying online',async()=>{
  const h=harness({initialCommit:commit(A,T)});h.service.start();await h.service.refresh();
  assert.equal(h.calls.at(-1).activities[0].name,DEVELOPMENT_ACTIVITY);
  await h.advance(DEVELOPMENT_WINDOW_MS-1);assert.equal(h.calls.at(-1).activities.length,1);
  await h.advance(1);assert.deepEqual(h.calls.at(-1),{status:'online',activities:[]});h.service.stop();
});

test('a new commit restarts the window; duplicate refreshes do not extend it',async()=>{
  let latest=response(A,T);const h=harness({fetcher:()=>latest});await h.service.refresh();
  await h.advance(30*60000);latest=response(B,T+30*60000);await h.service.refresh({notify:true});
  await h.advance(30*60000);await h.service.refresh();assert.equal(h.calls.at(-1).activities.length,1);
  await h.advance(30*60000);assert.equal(h.calls.at(-1).activities.length,0);h.service.stop();
});

test('commit notifications are deduplicated and throttled without accepting caller-supplied status',async()=>{
  const h=harness();await h.service.refresh();
  for(let n=0;n<20;n++)await h.service.refresh({notify:true,sha:B,date:new Date(T+DEVELOPMENT_WINDOW_MS).toISOString()});
  assert.equal(h.requests.length,1);assert.equal(h.timers.size,2);
  await h.advance(60000);assert.equal(h.requests.length,2);
  assert.match(h.requests[0][0],/repos\/benzhangstudio\/number-one\/commits\?sha=main&per_page=1$/);h.service.stop();
});

test('ETag polling retains the original deadline instead of treating a 304 as another commit',async()=>{
  let n=0;const h=harness({fetcher:()=>++n===1?response(A,T,{headers:{etag:'version-a'}}):response(A,T,{status:304})});
  await h.service.refresh();await h.advance(60000);await h.service.refresh();
  assert.equal(h.requests[1][1].headers['If-None-Match'],'version-a');
  await h.advance(DEVELOPMENT_WINDOW_MS-60000);assert.equal(h.calls.at(-1).activities.length,0);h.service.stop();
});

test('GitHub failure does not keep the activity on past its deadline',async()=>{
  const h=harness({initialCommit:commit(A,T),fetcher:async()=>{throw Error('offline');}});h.service.start();await h.service.refresh();
  await h.advance(DEVELOPMENT_WINDOW_MS);assert.equal(h.calls.at(-1).activities.length,0);h.service.stop();
});

test('GitHub Retry-After is respected, including notification requests',async()=>{
  const h=harness({fetcher:()=>response(A,T,{status:429,headers:{'retry-after':'600'}})});
  await h.service.refresh();await h.advance(60000);await h.service.refresh({notify:true});assert.equal(h.requests.length,1);
  await h.advance(9*60000);assert.equal(h.requests.length,2);h.service.stop();
});

test('future metadata and responses arriving after timeout cannot activate presence',async()=>{
  const future=harness({fetcher:()=>response(A,T+2*DEVELOPMENT_WINDOW_MS)});await future.service.refresh();assert.equal(future.calls.at(-1).activities.length,0);future.service.stop();
  let release;const h=harness({fetcher:()=>new Promise(resolve=>{release=resolve;})});await h.service.refresh();
  release(response(A,T));await new Promise(setImmediate);assert.equal(h.calls.at(-1).activities.length,0);h.service.stop();
});

test('stop cancels polling and expiry timers and ignores later refreshes',async()=>{
  const h=harness({initialCommit:commit(A,T)});h.service.start();await h.service.refresh();h.service.stop();
  assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);const n=h.requests.length;await h.service.refresh({notify:true});assert.equal(h.requests.length,n);
});

test('public commit notification only triggers a verified refresh and accepts no supplied payload',async t=>{
  const root=new Store(),c={mode:'demo',origin:'http://127.0.0.1:1',port:1};let refreshes=0;
  const server=application(c,root,undefined,null,()=>{refreshes++;});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));c.origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});root.db.close();});
  const endpoint=c.origin+'/api/commit-status';
  assert.equal((await fetch(endpoint,{method:'POST'})).status,202);await new Promise(setImmediate);assert.equal(refreshes,1);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha:B,date:new Date(T).toISOString()})})).status,400);assert.equal(refreshes,1);
});
