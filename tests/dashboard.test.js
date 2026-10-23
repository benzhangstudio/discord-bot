import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request} from 'node:http';
import {hostedConfig,startHostedDashboard} from '../src/dashboard.js';
import {Discord} from '../age-verification/discord.js';
const credentials={DISCORD_TOKEN:'test',DISCORD_APPLICATION_ID:'999999999999999999',AGE_CLIENT_SECRET:'test'};

test('hosted dashboard uses application credentials and server settings are website-owned',()=>{
  const c=hostedConfig({});assert.equal(c.host,'0.0.0.0');assert.equal(c.port,16243);assert.equal(c.origin,'https://number-one.wispbyte.app');assert.equal(c.mode,'setup');assert.equal(c.publicHosted,true);
  assert.equal(hostedConfig({SERVER_PORT:'17000'}).port,17000);assert.equal(hostedConfig({SERVER_PORT:'17000',AGE_PORT:'18000'}).port,18000);assert.equal(hostedConfig({DASHBOARD_ENABLED:'0'}),null);
  assert.throws(()=>hostedConfig({AGE_MODE:'demo',AGE_ORIGIN:'http://127.0.0.1:3100'}),/cannot use/);assert.throws(()=>hostedConfig({AGE_PORT:'NaN'}),/port/);
  const live=hostedConfig({...credentials,AGE_GUILD_ID:'ignored',AGE_REVIEWER_ROLE_ID:'ignored',AGE_VERIFIED_ROLE_ID:'ignored'});assert.equal(live.mode,'discord');assert.equal(live.guild,undefined);assert.equal(live.botToken,'test');assert.equal(live.clientId,credentials.DISCORD_APPLICATION_ID);
  assert.equal(hostedConfig({...credentials,AGE_MODE:'setup'}).mode,'setup');
});
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('hosted listener serves public pages; missing application secret keeps APIs closed',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'number-one-web-')),port=await freePort();const service=await startHostedDashboard({AGE_PORT:String(port),AGE_DB:join(dir,'age.sqlite')});t.after(async()=>{await service.stop();rmSync(dir,{recursive:true});});
  const call=(path,options={})=>new Promise((done,reject)=>{const req=request({host:'127.0.0.1',port,path,method:options.method||'GET',headers:{Host:'number-one.wispbyte.app','X-Forwarded-Proto':'https',...options.headers}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>done({status:res.statusCode,text:async()=>body}));});req.on('error',reject);req.end(options.body);});
  const home=await call('/');assert.equal(home.status,200);assert.match(await home.text(),/id="app"/);assert.equal((await call('/verify')).status,200);assert.equal((await call('/style.css')).status,200);
  for(const path of ['/api/session','/api/guilds/111111111111111111/queue','/auth/login'])assert.equal((await call(path)).status,503);
  assert.equal((await call('/api/demo-login',{method:'POST',body:'{"identity":"owner"}'})).status,503);assert.equal((await call('/',{headers:{'X-Forwarded-Proto':'http'}})).status,426);assert.equal((await call('/',{headers:{Host:'attacker.example'}})).status,400);
});
test('port conflict fails clearly and releases resources',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'number-one-port-')),s=createServer();await new Promise(r=>s.listen(0,'0.0.0.0',r));try{await assert.rejects(startHostedDashboard({AGE_PORT:String(s.address().port),AGE_DB:join(dir,'age.sqlite')}),e=>e.code==='EADDRINUSE');}finally{await new Promise(r=>s.close(r));rmSync(dir,{recursive:true});}
});
const roleData=[{id:'g',permissions:'0',position:0,name:'everyone'},{id:'bot-role',permissions:String(1n<<28n),position:10,name:'bot'},{id:'reviewer',permissions:'0',position:9,name:'reviewer'},{id:'verified',permissions:'0',position:1,name:'test'},{id:'admin',permissions:'8',position:2,name:'admin'},{id:'managed',permissions:'0',position:2,managed:true,name:'managed'},{id:'above',permissions:'0',position:11,name:'above'}];
function fakeAPI(stage,calls=[]){return async(url)=>{
  const step=url.endsWith('/token/revoke')?'revoke':url.endsWith('/oauth2/token')?'token':url.includes('/users/@me/guilds?')?'guild-list':url.endsWith('/users/@me')?'user':url.endsWith('/guilds/g')?'guild':url.endsWith('/roles')?'roles':url.endsWith('/members/bot')?'bot-member':url.endsWith('/members/u')?'member':url.includes('/roles/')?'role':url.endsWith('/users/@me/channels')?'dm-create':'dm-send';calls.push(step);if(step===stage)return new Promise(()=>{});
  const values={token:{access_token:'transient'},user:{id:'u'},'guild-list':[{id:'g',name:'Community',permissions:'32',owner:false}],guild:{owner_id:'owner',name:'Community'},roles:roleData,'bot-member':{roles:['bot-role']},member:{roles:['reviewer']},revoke:{},role:{},'dm-create':{id:'dm'},'dm-send':{id:'message'}};return {ok:true,status:200,json:async()=>values[step]};
};}
for(const stage of ['token','user','guild-list','revoke','guild','member','roles','bot-member','role','dm-create','dm-send'])test(`Discord ${stage}: hanging request ends without retry`,async()=>{
  const calls=[],api=new Discord({clientId:'bot',origin:'https://test.example',requestTimeout:15},fakeAPI(stage,calls));let operation;
  if(['token','user','guild-list','revoke'].includes(stage))operation=api.exchange('test');else if(['guild','member','roles'].includes(stage))operation=api.identity('g','u',{reviewerRole:'reviewer'});else if(stage==='bot-member')operation=api.roleOptions('g');else if(stage==='role')operation=api.role('g','u','verified');else operation=api.dm('g','u','approved');
  if(stage==='revoke')assert.equal((await operation).id,'u');else await assert.rejects(operation,/uncertain/);assert.equal(calls.filter(x=>x===stage).length,1);
});
test('fresh permissions distinguish managers from reviewers and owners',async()=>{
  const api=new Discord({clientId:'bot'},fakeAPI());let identity=await api.identity('g','u',{reviewerRole:'reviewer'});assert.equal(identity.reviewer,true);assert.equal(identity.manager,false);assert.equal(identity.owner,false);
  const owner=new Discord({},async url=>({ok:true,status:200,json:async()=>url.endsWith('/roles')?roleData:url.endsWith('/guilds/g')?{owner_id:'u',name:'Community'}:{roles:[]}}));identity=await owner.identity('g','u',null);assert.equal(identity.owner,true);assert.equal(identity.manager,true);assert.equal(identity.reviewer,true);
});
test('server role setup rejects elevated, managed, everyone, identical and unassignable roles',async()=>{
  const api=new Discord({clientId:'bot'},fakeAPI());await api.validateRoles('g','reviewer','verified');
  for(const role of ['admin','managed','above','g','missing','reviewer'])await assert.rejects(api.validateRoles('g','reviewer',role));
  const roles=await api.roleOptions('g');assert(!roles.some(r=>r.id==='managed'||r.id==='g'));assert.equal(roles.find(r=>r.id==='above').canVerify,false);
});
test('OAuth guild pagination preserves all servers and never stores bearer tokens',async()=>{
  let pages=0;const calls=[];const api=new Discord({origin:'https://test.example'},async(url,options)=>{
    calls.push(url);if(url.includes('/users/@me/guilds?')){pages++;return {ok:true,status:200,json:async()=>pages===1?Array.from({length:200},(_,i)=>({id:String(i+1),name:'Community',permissions:'0',owner:false})):[{id:'201',name:'Last',permissions:'32'}]};}return fakeAPI()(url,options);
  });const identity=await api.exchange('x');assert.equal(identity.guilds.length,201);assert.equal(identity.guilds.at(-1).manageable,true);assert(!JSON.stringify(identity).includes('transient'));assert(calls.some(x=>x.endsWith('after=200')));
});
