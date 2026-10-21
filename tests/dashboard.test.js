import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request} from 'node:http';
import {hostedConfig,startHostedDashboard} from '../src/dashboard.js';
import {Discord} from '../age-verification/discord.js';

test('Wispbyte defaults use assigned public listener and locked verification',()=>{
  const c=hostedConfig({});assert.equal(c.host,'0.0.0.0');assert.equal(c.port,16243);assert.equal(c.origin,'https://number-one.wispbyte.app');assert.equal(c.mode,'setup');assert.equal(c.publicHosted,true);
  assert.equal(hostedConfig({SERVER_PORT:'17000'}).port,17000);
  assert.equal(hostedConfig({SERVER_PORT:'17000',AGE_PORT:'18000'}).port,18000);
  assert.equal(hostedConfig({DASHBOARD_ENABLED:'0'}),null);
  assert.throws(()=>hostedConfig({AGE_MODE:'demo',AGE_ORIGIN:'http://127.0.0.1:3100'}),/cannot use/);
  assert.throws(()=>hostedConfig({AGE_PORT:'NaN'}),/port/);
  assert.throws(()=>hostedConfig({AGE_MODE:'discord'}),/credentials/);
  const live=hostedConfig({AGE_MODE:'discord',DISCORD_TOKEN:'test',DISCORD_APPLICATION_ID:'111111111111111111',AGE_CLIENT_SECRET:'test',AGE_GUILD_ID:'222222222222222222',AGE_REVIEWER_ROLE_ID:'333333333333333333',AGE_VERIFIED_ROLE_ID:'444444444444444444'});
  assert.equal(live.botToken,'test');assert.equal(live.clientId,'111111111111111111');
});
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('real hosted startup serves dashboard and /verify; HTTPS required and public demo closed',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'number-one-web-'));const port=await freePort();
  const service=await startHostedDashboard({AGE_PORT:String(port),AGE_DB:join(dir,'age.sqlite')});
  t.after(async()=>{await service.stop();rmSync(dir,{recursive:true});});
  const call=(path,options={})=>new Promise((done,reject)=>{
    const req=request({host:'127.0.0.1',port,path,method:options.method || 'GET',headers:{Host:'number-one.wispbyte.app','X-Forwarded-Proto':'https',...options.headers}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>done({status:res.statusCode,text:async()=>body}));
    });req.on('error',reject);req.end(options.body);
  });
  const home=await call('/');assert.equal(home.status,200);assert.match(await home.text(),/href="\/verify"/);
  assert.equal((await call('/verify')).status,200);assert.equal((await call('/style.css')).status,200);
  assert.equal((await call('/api/config')).status,200);
  for(const path of ['/api/me','/api/queue','/api/evidence','/auth/login','/api/admin'])assert.equal((await call(path)).status,503,path);
  assert.equal((await call('/api/demo-login',{method:'POST',body:'{"identity":"owner"}'})).status,503);
  assert.equal((await call('/',{headers:{'X-Forwarded-Proto':'http'}})).status,426);
  assert.equal((await call('/',{headers:{Host:'attacker.example'}})).status,400);
});
test('port conflict finishes with an error and releases dashboard resources',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'number-one-port-'));const s=createServer();await new Promise(r=>s.listen(0,'0.0.0.0',r));
  try{await assert.rejects(startHostedDashboard({AGE_PORT:String(s.address().port),AGE_DB:join(dir,'age.sqlite')}),e=>e.code==='EADDRINUSE');}
  finally{await new Promise(r=>s.close(r));rmSync(dir,{recursive:true});}
});
for(const stage of ['token','user','guild','member','revoke','role','dm-create','dm-send']) {
  test(`Discord ${stage}: never-settling network request finishes without duplicate mutation`,async()=>{
    const calls=[];
    const identify=url=>url.endsWith('/token/revoke')?'revoke':url.endsWith('/oauth2/token')?'token':url.endsWith('/users/@me')?'user':url.endsWith('/guilds/g')?'guild':url.endsWith('/members/u')?'member':url.includes('/roles/')?'role':url.endsWith('/users/@me/channels')?'dm-create':'dm-send';
    const api=new Discord({guild:'g',reviewerRole:'reviewer',verifiedRole:'verified',origin:'https://test.example',requestTimeout:15},async(url)=>{
      const step=identify(url);calls.push(step);if(step===stage)return new Promise(()=>{});
      const values={token:{access_token:'transient'},user:{id:'u'},guild:{owner_id:'u'},member:{roles:[]},revoke:{},role:{},'dm-create':{id:'dm'},'dm-send':{id:'message'}};
      return {ok:true,status:200,json:async()=>values[step]};
    });
    if(stage==='revoke')assert.equal((await api.exchange('test')).id,'u');
    else await assert.rejects(stage==='role'?api.role('u'):stage.startsWith('dm-')?api.dm('u','approved'):api.exchange('test'),/uncertain/);
    assert.equal(calls.filter(x=>x===stage).length,1);
  });
}
