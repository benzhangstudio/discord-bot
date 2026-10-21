import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, assert } from './core.js';
import { Discord } from './discord.js';

const here = dirname(fileURLToPath(import.meta.url));
const token = () => randomBytes(32).toString('hex');
export function config(env = process.env) {
  const c = { mode:env.AGE_MODE || 'demo',origin:env.AGE_ORIGIN || 'http://127.0.0.1:3100',port:Number(env.AGE_PORT || 3100),guild:env.AGE_GUILD_ID,clientId:env.AGE_CLIENT_ID,clientSecret:env.AGE_CLIENT_SECRET,botToken:env.AGE_BOT_TOKEN,reviewerRole:env.AGE_REVIEWER_ROLE_ID,verifiedRole:env.AGE_VERIFIED_ROLE_ID };
  assert(['demo','discord','setup'].includes(c.mode), 500, 'AGE_MODE must be demo, discord or setup.');
  assert(Number.isInteger(c.port) && c.port > 0 && c.port <= 65535,500,'Web port must be between 1 and 65535.');
  const origin = new URL(c.origin);
  assert(origin.origin === c.origin && !origin.username && !origin.password, 500, 'AGE_ORIGIN must be an exact origin without a trailing slash.');
  if (c.mode === 'demo') assert(origin.hostname === '127.0.0.1' && origin.protocol === 'http:', 500, 'Demo is loopback only.');
  else {
    assert(origin.protocol === 'https:', 500, 'Discord mode requires HTTPS.');
    if(c.mode === 'setup') return c;
    assert(c.clientSecret && c.botToken && [c.guild,c.clientId,c.reviewerRole,c.verifiedRole].every(x => /^\d{17,20}$/.test(x || '')),500,'Configure all Discord credentials and IDs.');
    assert(c.reviewerRole !== c.verifiedRole && c.reviewerRole !== c.guild && c.verifiedRole !== c.guild,500,'Reviewer and verified roles must be distinct, non-everyone roles.');
  }
  return c;
}
export function application(c, store, discord = new Discord(c)) {
  const sessions = new Map(), states = new Map(), rates = new Map(), inFlight = new Set();
  const cookieName = c.mode === 'discord' ? '__Host-age' : 'age';
  const secure = c.mode === 'discord' ? '; Secure' : '';
  function setSession(res, id) {
    const sid = token(); sessions.set(sid, {id,csrf:token(),expires:Date.now()+3600000});
    res.setHeader('Set-Cookie', `${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure}`);
  }
  async function body(req) {
    assert(req.headers['content-type'] === 'application/json',415,'Only small JSON requests are accepted. File uploads are disabled.');
    let raw = ''; for await (const chunk of req) { raw += chunk; assert(Buffer.byteLength(raw) <= 1024,413,'Uploads are disabled.'); }
    try { const data = JSON.parse(raw); assert(data && !Array.isArray(data) && typeof data === 'object',400,'Invalid JSON.'); return data; } catch { assert(false,400,'Invalid JSON.'); }
  }
  function keys(data, allowed) { assert(Object.keys(data).every(k => allowed.includes(k)),400,'Unsupported fields. Raw ID data is never accepted.'); }
  const send = (res, data, status = 200) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
  const redirect = (res, location) => { res.writeHead(302,{Location:location});res.end(); };
  async function deliver(id) {
    const item = store.get(id); if (!item) return;
    inFlight.add(id);
    try {
    if (item.roleState === 'pending') {
      store.delivery(id,'roleState','uncertain');
      try { if(c.mode === 'discord') await discord.role(item.member); store.delivery(id,'roleState',c.mode === 'demo' ? 'simulated' : 'delivered'); }
      catch { store.delivery(id,'roleState','uncertain'); }
    }
    if (item.dmState === 'pending') {
      store.delivery(id,'dmState','uncertain');
      try { if(c.mode === 'discord') await discord.dm(item.member,item.status); store.delivery(id,'dmState',c.mode === 'demo' ? 'simulated' : 'delivered'); }
      catch { store.delivery(id,'dmState','uncertain'); }
    }
    } finally { inFlight.delete(id); }
  }
  return createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(c.mode !== 'demo') res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url = new URL(req.url,c.origin), path = url.pathname;
      assert(req.headers.host === new URL(c.origin).host,400,'Unexpected host.');
      // Wispbyte terminates TLS upstream. Never serve sessions through its plain HTTP port.
      if(c.publicHosted) assert(req.headers['x-forwarded-proto'] === 'https',426,'Open the HTTPS dashboard address. The Wispbyte proxy must forward X-Forwarded-Proto: https.');
      const now = Date.now();
      for(const [k,v] of sessions) if(v.expires <= now) sessions.delete(k);
      for(const [k,v] of states) if(v.expires <= now) states.delete(k);
      for(const [k,v] of rates) if(v.until <= now) rates.delete(k);
      const ip = req.socket.remoteAddress; const rate = rates.get(ip) || {n:0,until:now+60000}; rates.set(ip,rate);
      assert(++rate.n <= 180,429,'Too many requests. Wait one minute.');
      const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')));
      const session = sessions.get(cookies[cookieName]);
      if(req.method === 'GET' && ['/','/verify','/verify/','/app.js','/style.css','/portrait.svg'].includes(path)) {
        const file = path === '/' ? 'dashboard.html' : path.startsWith('/verify') ? 'index.html' : path.slice(1);
        res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});
        return res.end(readFileSync(resolve(here,'public',file)));
      }
      if(req.method === 'GET' && path === '/api/config') return send(res,{mode:c.mode,version:'0.1',syntheticOnly:true});
      assert(c.mode !== 'setup',503,'Verification is locked while the server owner configures Discord sign-in.');
      if(req.method === 'GET' && path === '/auth/login') {
        assert(c.mode === 'discord',400,'Use demo sign-in.');
        const state = token(), binding = token(); states.set(state,{binding,expires:now+300000});
        res.setHeader('Set-Cookie',`oauth=${binding}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=300`);
        return redirect(res,'https://discord.com/oauth2/authorize?' + new URLSearchParams({client_id:c.clientId,redirect_uri:c.origin+'/auth/callback',response_type:'code',scope:'identify',state}));
      }
      if(req.method === 'GET' && path === '/auth/callback') {
        assert(c.mode === 'discord',400,'OAuth unavailable in demo.');
        const state = states.get(url.searchParams.get('state')); states.delete(url.searchParams.get('state'));
        assert(state && state.expires > now && state.binding === cookies.oauth,403,'OAuth state expired or invalid. Sign in again.');
        assert(url.searchParams.get('code'),400,'Discord authorization was cancelled.');
        const identity = await discord.exchange(url.searchParams.get('code'));
        sessions.delete(cookies[cookieName]); setSession(res,identity.id); return redirect(res,'/verify');
      }
      if(req.method === 'POST' && path === '/api/demo-login') {
        assert(c.mode === 'demo',404,'Not available.');assert(req.headers.origin === c.origin,403,'Invalid origin.');
        const data = await body(req);keys(data,['identity']);
        assert(['member','reviewer','reviewer2','owner','outsider'].includes(data.identity),400,'Unknown demo identity.');
        sessions.delete(cookies[cookieName]);setSession(res,data.identity); return send(res,{ok:true});
      }
      assert(session && session.expires > now,401,'Sign in to continue.');
      // Refresh membership and reviewer authorization on EVERY protected request; no cached grants.
      const identity = c.mode === 'discord' ? await discord.identity(session.id) : {id:session.id,owner:session.id==='owner',reviewer:['owner','reviewer','reviewer2'].includes(session.id)};
      assert(identity.id !== 'outsider',403,'You must belong to the configured server.');
      if(req.method === 'GET' && path === '/api/me') {
        store.purge();const item = store.mine(identity.id);
        return send(res,{...identity,csrf:session.csrf,case:item ? {id:item.id,status:item.status,roleState:item.roleState,dmState:item.dmState} : null});
      }
      const reviewer = () => assert(identity.reviewer,403,'Server owner or configured reviewer role required.');
      if(req.method === 'GET' && path === '/api/queue') {reviewer();return send(res,store.list());}
      if(req.method === 'GET' && path === '/api/evidence') {reviewer();return send(res,store.evidence(url.searchParams.get('id'),identity.id));}
      if(req.method === 'GET' && path === '/api/privacy/export') return send(res,store.export(identity.id));
      if(req.method === 'GET' && path === '/api/admin') {
        assert(identity.owner,403,'Only the server owner can access audit and privacy administration.');
        return send(res,{requests:store.db.prepare('SELECT * FROM privacy ORDER BY created DESC').all(),audit:store.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()});
      }
      assert(req.method === 'POST',404,'Route not found.');
      assert(req.headers.origin === c.origin,403,'Invalid origin.');
      const csrf = req.headers['x-csrf-token'];assert(typeof csrf === 'string' && /^[a-f0-9]{64}$/.test(csrf) && timingSafeEqual(Buffer.from(csrf),Buffer.from(session.csrf)),403,'Refresh the page and try again.');
      const data = await body(req);
      if(path === '/api/logout') {keys(data,[]);sessions.delete(cookies[cookieName]);res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);return send(res,{ok:true});}
      if(path === '/api/submit') {keys(data,['fixture','consent']);return send(res,{id:store.submit(identity.id,data.fixture,data.consent)},201);}
      if(path === '/api/claim') {reviewer();keys(data,['id']);store.claim(data.id,identity.id);return send(res,{ok:true});}
      if(path === '/api/decision') {reviewer();keys(data,['id','decision']);assert(store.get(data.id)?.member !== identity.id,403,'You cannot review your own submission.');store.decide(data.id,identity.id,data.decision);await deliver(data.id);return send(res,store.list().find(x=>x.id===data.id));}
      if(path === '/api/privacy') {keys(data,['kind']);return send(res,{id:store.request(identity.id,data.kind)});}
      if(path === '/api/admin/delete') {
        assert(identity.owner,403,'Only the server owner can fulfill deletion requests.');keys(data,['requestId']);
        const p = store.db.prepare("SELECT * FROM privacy WHERE id=? AND kind='delete' AND state='open'").get(data.requestId);assert(p,404,'Open deletion request not found.');
        const item = store.mine(p.member);assert(!item || (!inFlight.has(item.id) && !['pending','uncertain'].includes(item.roleState)),409,'Role delivery is in progress or uncertain. Inspect Discord, then reconcile the role first.');
        if(item) inFlight.add(item.id);
        try {
          if(c.mode === 'discord' && item?.status === 'approved') await discord.role(p.member,'DELETE');
          store.erase(p.member); for(const [key,s] of sessions) if(s.id===p.member) sessions.delete(key);
        } finally { if(item) inFlight.delete(item.id); }
        return send(res,{ok:true});
      }
      if(path === '/api/admin/reconcile') {
        assert(identity.owner,403,'Only the server owner can reconcile role delivery.'); keys(data,['id']);
        const item = store.get(data.id); assert(item?.status === 'approved' && item.roleState === 'uncertain' && !inFlight.has(item.id),409,'No completed uncertain role delivery to reconcile. Wait for any active delivery.');
        inFlight.add(item.id);
        try {
          const member = c.mode === 'discord' ? await discord.api(`/guilds/${c.guild}/members/${item.member}`) : {roles:[]};
          store.delivery(item.id,'roleState',member.roles.includes(c.verifiedRole)?'delivered':'not_delivered');return send(res,{ok:true});
        } finally { inFlight.delete(item.id); }
      }
      assert(false,404,'Route not found.');
    } catch(error) {
      if(!res.headersSent) send(res,{error:error.status ? error.message : 'Unable to complete request. Check configuration and retry.'},error.status || 500);
      else res.end();
    }
  });
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const c = config(); const path = resolve(here,process.env.AGE_DB || 'data/age.sqlite');mkdirSync(dirname(path),{recursive:true});
  const store = new Store(path); store.purge();
  // An interrupted mutation must never be silently retried after restart.
  store.db.exec("UPDATE cases SET roleState='uncertain' WHERE roleState='pending'; UPDATE cases SET dmState='uncertain' WHERE dmState='pending';");
  const server = application(c,store);
  server.requestTimeout=15000;server.headersTimeout=10000;
  const purge = setInterval(()=>store.purge(),60000);purge.unref();
  server.listen(c.port,'127.0.0.1',()=>console.log(`Number One Age Beta v0.1: ${c.origin} (${c.mode}; synthetic IDs only)`));
}
