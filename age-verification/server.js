import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,assert,DEMO_GUILDS} from './core.js';
import {Discord} from './discord.js';
import {VerificationWorkflow} from './workflow.js';
import {createDashboardApi} from '../src/dashboard-api.js';
import {Store as BotStore} from '../src/store.js';
const here=dirname(fileURLToPath(import.meta.url));
const token=()=>randomBytes(32).toString('hex');
const snowflake=id=>typeof id==='string'&&/^\d{17,20}$/.test(id);
export function config(env=process.env){
  const c={mode:env.AGE_MODE||'demo',origin:env.AGE_ORIGIN||'http://127.0.0.1:3100',port:Number(env.AGE_PORT||3100),clientId:env.AGE_CLIENT_ID,clientSecret:env.AGE_CLIENT_SECRET,botToken:env.AGE_BOT_TOKEN};
  assert(['demo','discord','setup'].includes(c.mode),500,'AGE_MODE must be demo, discord or setup.');assert(Number.isInteger(c.port)&&c.port>0&&c.port<=65535,500,'Web port must be between 1 and 65535.');
  const origin=new URL(c.origin);assert(origin.origin===c.origin&&!origin.username&&!origin.password,500,'AGE_ORIGIN must be an exact origin without a trailing slash.');
  if(c.mode==='demo')assert(origin.hostname==='127.0.0.1'&&origin.protocol==='http:',500,'Demo is loopback only.');
  else{assert(origin.protocol==='https:',500,'Discord mode requires HTTPS.');if(c.mode==='discord')assert(c.clientSecret&&c.botToken&&snowflake(c.clientId),500,'Configure the application OAuth credentials. Server roles are configured on the website.');}
  return c;
}
export function application(c,root,discord=new Discord(c),plugins=null,onCommit=null){
  const sessions=new Map(),states=new Map(),rates=new Map();
  const workflow=new VerificationWorkflow({root,discord,mode:c.mode,authorize:identityFor,timeout:c.workflowTimeout??8000});
  plugins?.bindVerification?.(root);
  const cookieName=c.mode==='discord'?'__Host-age':'age',secure=c.mode==='discord'?'; Secure':'';
  function setSession(res,identity){const sid=token();sessions.set(sid,{...identity,csrf:token(),expires:Date.now()+3600000});res.setHeader('Set-Cookie',`${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure}`);}
  async function body(req,limit=1024){
    assert(req.headers['content-type']==='application/json',415,'Only small JSON requests are accepted. File uploads are disabled.');let raw='';
    for await(const chunk of req){raw+=chunk;assert(Buffer.byteLength(raw)<=limit,413,'Uploads are disabled.');}
    try{const data=JSON.parse(raw);assert(data&&!Array.isArray(data)&&typeof data==='object',400,'Invalid JSON.');return data;}catch{assert(false,400,'Invalid JSON.');}
  }
  function keys(data,allowed){assert(Object.keys(data).every(k=>allowed.includes(k)),400,'Unsupported fields. Raw ID data is never accepted.');}
  const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const redirect=(res,location)=>{res.writeHead(302,{Location:location});res.end();};
  const invite=guild=>'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:c.clientId||'',scope:'bot applications.commands',permissions:'268553408',...(guild?{guild_id:guild,disable_guild_select:'true'}:{})});
  async function identityFor(guild,session,dashboardOnly=false){
    const settings=root.forGuild(guild).settings();
    assert(!session.expires||session.expires>Date.now(),401,'Your session expired. Sign in again.');
    const raw=c.mode==='discord'?await workflow.bounded(()=>(dashboardOnly&&discord.dashboardIdentity?discord.dashboardIdentity(guild,session.id):discord.identity(guild,session.id,settings))):{id:session.id,name:DEMO_GUILDS.find(g=>g.id===guild)?.name,owner:session.id==='owner',ownerId:'owner',manager:['owner','manager'].includes(session.id),reviewer:session.id==='owner'||!!settings&&['reviewer','reviewer2'].includes(session.id)};
    if(!raw.owner&&settings&&plugins?.verificationRoleConflicts?.(guild,[settings.reviewerRole]))raw.reviewer=false;
    return plugins?plugins.dashboardIdentity(guild,raw):{...raw,dashboard:!!raw.owner,manager:!!raw.owner};
  }
  async function guildList(session,verification=false){
    const rows=[];
    // Membership-only communities are reserved for the separate member verification flow.
    // Only owner/delegate candidates trigger bot lookups, rather than every Discord community.
    for(const guild of session.guilds){
      let owner=guild.owner===true,manageable=false;
      const present=plugins?plugins.hasBot(guild.id):null;
      if(owner||plugins?.dashboardCandidate(guild.id,session.id)){
        if(present===false){manageable=owner;}
        else{
          try{const identity=await identityFor(guild.id,session,true);owner=identity.owner;manageable=identity.dashboard;}
          catch(error){if(error.status!==403)throw error;owner=false;}
        }
      }
      if(verification||manageable)rows.push({id:guild.id,name:guild.name,icon:guild.icon||null,owner,manageable,access:manageable?(owner?'owner':'approved'):null,botPresent:present,inviteUrl:owner&&c.mode==='discord'?invite(guild.id):null});
    }
    return rows;
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(c.mode!=='demo')res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const url=new URL(req.url,c.origin),path=url.pathname;assert(req.headers.host===new URL(c.origin).host,400,'Unexpected host.');
      if(c.publicHosted)assert(req.headers['x-forwarded-proto']==='https',426,'Open the HTTPS dashboard address. The Wispbyte proxy must forward X-Forwarded-Proto: https.');
      const now=Date.now();for(const[k,v]of sessions)if(v.expires<=now)sessions.delete(k);for(const[k,v]of states)if(v.expires<=now)states.delete(k);for(const[k,v]of rates)if(v.until<=now)rates.delete(k);
      const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));const session=sessions.get(cookies[cookieName]);
      // Per-session limits prevent the shared Wispbyte proxy IP from throttling all signed-in users together.
      const rateKey=session?cookies[cookieName]:req.socket.remoteAddress;const rate=rates.get(rateKey)||{n:0,until:now+60000};rates.set(rateKey,rate);assert(++rate.n<=180,429,'Too many requests. Wait one minute.');
      // One single-page dashboard; /verify (member links) and /dashboard/... deep links share it.
      const page=['/','/verify','/verify/','/dashboard','/dashboard/'].includes(path)||/^\/dashboard\/\d{17,20}(\/[a-z]{1,20})?\/?$/.test(path);
      if(req.method==='GET'&&(page||['/app.js','/dashboard.js','/style.css','/portrait.svg','/logo.svg'].includes(path))){
        const file=page?'dashboard.html':path.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});return res.end(readFileSync(resolve(here,'public',file)));
      }
      if(req.method==='GET'&&path==='/api/config')return send(res,{mode:c.mode,version:'0.2',syntheticOnly:true,inviteUrl:c.mode==='discord'?invite():null});
      if(req.method==='POST'&&path==='/api/commit-status'){
        assert(typeof onCommit==='function',404,'Route not found.');
        assert(!req.headers['transfer-encoding']&&Number(req.headers['content-length']||0)===0,400,'No request body is accepted.');
        // Public refresh only: no supplied status, SHA, time or private data.
        // The controller verifies GitHub and limits outbound requests itself.
        void Promise.resolve().then(onCommit).catch(()=>console.warn('Commit status refresh unavailable.'));
        return send(res,{ok:true},202);
      }
      assert(c.mode!=='setup',503,'Public sign-in is temporarily unavailable. The bot operator must finish the application OAuth connection.');
      if(req.method==='GET'&&path==='/auth/login'){
        assert(c.mode==='discord',400,'Use demo sign-in.');const guild=url.searchParams.get('guild');assert(!guild||snowflake(guild),400,'Invalid server link.');
        const state=token(),binding=token();states.set(state,{binding,guild,expires:now+300000});res.setHeader('Set-Cookie',`oauth=${binding}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=300`);
        return redirect(res,'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:c.clientId,redirect_uri:c.origin+'/auth/callback',response_type:'code',scope:'identify guilds',state}));
      }
      if(req.method==='GET'&&path==='/auth/callback'){
        assert(c.mode==='discord',400,'OAuth unavailable in demo.');const state=states.get(url.searchParams.get('state'));states.delete(url.searchParams.get('state'));
        assert(state&&state.expires>now&&state.binding===cookies.oauth,403,'OAuth state expired or invalid. Sign in again.');assert(url.searchParams.get('code'),400,'Discord authorization was cancelled.');
        const identity=await discord.exchange(url.searchParams.get('code'));sessions.delete(cookies[cookieName]);setSession(res,identity);return redirect(res,state.guild?'/verify?guild='+state.guild:'/dashboard');
      }
      if(req.method==='POST'&&path==='/api/demo-login'){
        assert(c.mode==='demo',404,'Not available.');assert(req.headers.origin===c.origin,403,'Invalid origin.');const data=await body(req);keys(data,['identity']);assert(['member','reviewer','reviewer2','owner','manager','outsider'].includes(data.identity),400,'Unknown demo identity.');
        sessions.delete(cookies[cookieName]);setSession(res,{id:data.identity,name:'Demo '+data.identity,guilds:data.identity==='outsider'?[]:DEMO_GUILDS.map(g=>({...g,owner:data.identity==='owner',manageable:data.identity==='owner'}))});return send(res,{ok:true});
      }
      assert(session&&session.expires>now,401,'Sign in with Discord to continue.');
      if(req.method==='GET'&&path==='/api/session')return send(res,{id:session.id,name:session.name||null,avatar:session.avatar||null,csrf:session.csrf,guilds:await guildList(session)});
      if(req.method==='GET'&&path==='/api/guilds')return send(res,{guilds:await guildList(session,url.searchParams.get('scope')==='verification'),inviteUrl:c.mode==='discord'?invite():null});
      let data;
      if(req.method==='POST'||req.method==='PUT'){
        assert(req.headers.origin===c.origin,403,'Invalid origin.');const csrf=req.headers['x-csrf-token'];assert(typeof csrf==='string'&&/^[a-f0-9]{64}$/.test(csrf)&&timingSafeEqual(Buffer.from(csrf),Buffer.from(session.csrf)),403,'Refresh the page and try again.');data=await body(req,req.method==='PUT'?20000:1024);
        if(path==='/api/logout'){keys(data,[]);sessions.delete(cookies[cookieName]);res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);return send(res,{ok:true});}
      }
      const route=path.match(/^\/api\/guilds\/(\d{17,20})\/(.+)$/);assert(route,404,'Route not found.');const[,guild,endpoint]=route;
      assert(session.guilds.some(g=>g.id===guild),403,'This Discord account does not belong to that server. Join it or sign in again after joining.');
      const store=root.forGuild(guild),settings=store.settings();
      // Fresh bot-side membership, owner and role checks on every server API request.
      let identity;
      try{identity=await identityFor(guild,session);}
      catch(error){if(error.status===403)return send(res,{error:'Number One must be installed and you must still belong to this server. Add the bot if you manage this server, then sign in again.',inviteUrl:invite(guild)},403);throw error;}
      const reviewer=()=>assert(identity.reviewer,403,'Server owner or this server’s configured reviewer role required.');
      identity.reauthorize=async()=>{const fresh=await identityFor(guild,session);assert(fresh.dashboard,403,'Your dashboard access was removed.');return fresh;};
      const manager=()=>assert(identity.dashboard,403,'Only the server owner or members they approve can configure this server.');
      const owner=()=>assert(identity.owner,403,'Only the current server owner can access privacy and audit administration.');
      const enabled=()=>assert(store.settings()?.enabled,409,'Verification is not open for this server. Its owner can enable it here.');
      if(req.method==='GET'){
        if(endpoint==='context'){store.purge();const item=store.mine(identity.id);return send(res,{...identity,guild,configured:!!settings,enabled:!!settings?.enabled,capabilities:{submit:!!settings?.enabled&&!item&&!store.deletionPending(identity.id),review:!!identity.reviewer,configure:!!identity.owner,privacyAdmin:!!identity.owner,realAgeVerification:false},shareUrl:c.origin+'/verify?guild='+guild,case:item?{id:item.id,status:item.status,roleState:item.roleState,dmState:item.dmState}:null});}
        if(endpoint==='settings'){manager();return send(res,{settings,roles:c.mode==='discord'?await discord.roleOptions(guild):[{id:'333333333333333333',name:'Demo reviewers',canVerify:false},{id:'444444444444444444',name:'Beta test verified',canVerify:true}]});}
        if(endpoint==='queue'){reviewer();return send(res,store.list());}
        if(endpoint==='evidence'){reviewer();return send(res,workflow.evidence(store,url.searchParams.get('id'),identity.id));}
        if(endpoint==='privacy/export')return send(res,store.export(identity.id));
        if(endpoint==='admin'){owner();return send(res,{requests:store.requests(),audit:store.audits()});}
      }
      if(endpoint==='overview'||endpoint.startsWith('plugins/')){
        assert(plugins,503,'Bot settings are unavailable on this dashboard instance. Use slash commands in Discord.');
        const result=await plugins.handle({method:req.method,endpoint,data,guild,identity,verification:{configured:!!settings,enabled:!!settings?.enabled}});
        return send(res,result);
      }
      assert(req.method==='POST',404,'Route not found.');
      if(endpoint==='settings'){
        assert(identity.owner,403,'Only the current server owner can choose verification roles and open submissions.');keys(data,['reviewerRole','verifiedRole','enabled','betaAcknowledged']);assert(snowflake(data.reviewerRole)&&snowflake(data.verifiedRole)&&typeof data.enabled==='boolean'&&data.betaAcknowledged===true,400,'Select both roles and acknowledge the synthetic-only Beta.');
        assert(data.reviewerRole!==data.verifiedRole&&data.reviewerRole!==guild&&data.verifiedRole!==guild,400,'Choose different custom roles, excluding @everyone.');
        if(c.mode==='discord')await workflow.bounded(()=>discord.validateRoles(guild,data.reviewerRole,data.verifiedRole));
        else assert(data.reviewerRole==='333333333333333333'&&data.verifiedRole==='444444444444444444',400,'Choose the available demo roles.');
        // Recheck management after the asynchronous role validation.
        assert((await identityFor(guild,session)).owner,403,'Only the current server owner can choose verification roles and open submissions.');
        assert(!plugins?.verificationRoleConflicts?.(guild,[data.reviewerRole,data.verifiedRole]),409,'Choose dedicated verification roles that are not offered by reaction-role messages or temporary role assignments.');
        store.configure(identity.id,data.reviewerRole,data.verifiedRole,data.enabled);return send(res,{ok:true});
      }
      if(endpoint==='submit'){keys(data,['fixture','consent']);return send(res,{id:store.submit(identity.id,data.fixture,data.consent)},201);}
      if(endpoint==='claim'){reviewer();enabled();keys(data,['id']);workflow.claim(store,data.id,identity.id);return send(res,{ok:true});}
      if(endpoint==='decision'){
        reviewer();enabled();keys(data,['id','decision']);assert(store.get(data.id),404,'Case not found in this server.');
        return send(res,await workflow.decide(store,data.id,session,data.decision));
      }
      if(endpoint==='privacy'){keys(data,['kind']);return send(res,{id:store.request(identity.id,data.kind)});}
      if(endpoint==='admin/delete'){
        owner();keys(data,['requestId']);return send(res,await workflow.erase(store,data.requestId,session));
      }
      if(endpoint==='admin/reconcile'){
        owner();keys(data,['id']);return send(res,await workflow.reconcile(store,data.id,session));
      }
      assert(false,404,'Route not found.');
    }catch(error){if(!res.headersSent)send(res,{error:error.status?error.message:'Unable to complete request. Check the server settings and try again.'},error.status||500);else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const c=config(),path=resolve(here,process.env.AGE_DB||'data/age.sqlite');mkdirSync(dirname(path),{recursive:true});const root=new Store(path);root.purge();
  // Local demo uses a separate throwaway bot store, never the live data/rose.sqlite.
  const bot=c.mode==='demo'?new BotStore(resolve(here,'data/demo-bot.sqlite')):null;
  const server=application(c,root,undefined,bot?createDashboardApi({store:bot,demo:true}):null);const purge=setInterval(()=>root.purge(),60000);purge.unref();server.listen(c.port,'127.0.0.1',()=>console.log(`Number One public Beta: ${c.origin} (${c.mode}; synthetic IDs only)`));
}
