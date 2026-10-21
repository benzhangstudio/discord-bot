import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {config,application} from '../age-verification/server.js';
import {Store} from '../age-verification/core.js';

export function hostedConfig(env=process.env) {
  if(env.DASHBOARD_ENABLED === '0') return null;
  const c=config({
    ...env,
    AGE_MODE:env.AGE_MODE || 'setup',
    AGE_ORIGIN:env.AGE_ORIGIN || 'https://number-one.wispbyte.app',
    AGE_PORT:env.AGE_PORT || env.SERVER_PORT || '16243',
    AGE_CLIENT_ID:env.AGE_CLIENT_ID || env.DISCORD_APPLICATION_ID,
    AGE_BOT_TOKEN:env.AGE_BOT_TOKEN || env.DISCORD_TOKEN
  });
  if(c.mode === 'demo') throw Error('Public dashboard cannot use AGE_MODE=demo. Use setup or discord.');
  return {...c,publicHosted:true,host:'0.0.0.0'};
}

// The existing bot startup owns this listener; no second process or gateway login.
export async function startHostedDashboard(env=process.env) {
  const c=hostedConfig(env);if(!c)return null;
  const path=resolve(env.AGE_DB || 'data/age-verification.sqlite');
  mkdirSync(dirname(path),{recursive:true});
  const store=new Store(path);
  store.purge();
  store.db.exec("UPDATE cases SET roleState='uncertain' WHERE roleState='pending'; UPDATE cases SET dmState='uncertain' WHERE dmState='pending';");
  const server=application(c,store);
  server.requestTimeout=15000;server.headersTimeout=10000;
  const purge=setInterval(()=>store.purge(),60000);purge.unref();
  try {
    await new Promise((done,reject)=>{server.once('error',reject);server.listen(c.port,c.host,done);});
  } catch(error) {clearInterval(purge);store.db.close();throw error;}
  server.on('error',()=>console.error('Dashboard listener failed. Check the Wispbyte web port and restart after correcting it.'));
  console.log(`Number One dashboard listening on 0.0.0.0:${c.port}; public verification ${c.mode === 'setup'?'locked pending configuration':'synthetic-only with Discord sign-in'}.`);
  let closed=false;
  return {server,async stop(){if(closed)return;closed=true;clearInterval(purge);await new Promise(done=>{server.close(done);server.closeAllConnections();});store.db.close();}};
}
