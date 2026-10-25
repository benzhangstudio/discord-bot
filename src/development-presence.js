import {ActivityType} from 'discord.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const DEVELOPMENT_WINDOW_MS=60*60*1000;
export const DEVELOPMENT_ACTIVITY='BETA • Being updated by the developer';
const COMMITS_URL='https://api.github.com/repos/benzhangstudio/number-one/commits?sha=main&per_page=1';

export function readRunningCommit(){
  try{
    const [sha,date]=execFileSync('git',['show','-s','--format=%H%n%cI','HEAD'],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:['ignore','pipe','ignore'],timeout:3000}).toString().trim().split(/\r?\n/);
    return {sha,date};
  }catch{return null;}
}

// A notification can request a refresh, but cannot supply a timestamp, status,
// repository or activity text. Only verified public main-branch metadata is used.
export function createDevelopmentPresence({client,initialCommit=null,fetcher=globalThis.fetch,now=Date.now,log=console,
  schedule=setTimeout,cancel=clearTimeout,every=setInterval,stopEvery=clearInterval,requestTimeoutMs=5000}={}){
  let expiresAt=0,lastSha=null,lastCheck=-Infinity,blockedUntil=0,etag=null,inFlight=null,controller=null;
  let expiryTimer=null,pollTimer=null,refreshTimer=null,lastVisible=null,started=false,stopped=false;
  const timer=(fn,delay)=>{const id=schedule(fn,Math.max(1,delay));id?.unref?.();return id;};
  function remember(commit){
    const at=Date.parse(commit?.date);
    if(!/^[a-f0-9]{40}$/i.test(commit?.sha||'')||!Number.isFinite(at)||at>now()+60000)return;
    if(commit.sha===lastSha)return;
    lastSha=commit.sha;
    expiresAt=Math.min(at,now())+DEVELOPMENT_WINDOW_MS;
  }
  remember(initialCommit);
  function apply(){
    if(stopped||!client?.user||client.isReady?.()===false)return;
    const active=expiresAt>now();
    if(active!==lastVisible){
      try{client.user.setPresence({status:'online',activities:active?[{name:DEVELOPMENT_ACTIVITY,type:ActivityType.Watching}]:[]});lastVisible=active;}
      catch{log.warn('Could not update the development activity.');}
    }
    if(expiryTimer)cancel(expiryTimer);expiryTimer=null;
    if(active)expiryTimer=timer(apply,expiresAt-now());
  }
  function refresh({notify=false}={}){
    if(stopped)return Promise.resolve();
    apply();
    if(inFlight){if(notify&&!refreshTimer)refreshTimer=timer(()=>{refreshTimer=null;void refresh();},Math.max(lastCheck+60000,blockedUntil)-now());return inFlight;}
    const wait=Math.max(lastCheck+60000,blockedUntil)-now();
    if(wait>0){
      if(notify&&!refreshTimer)refreshTimer=timer(()=>{refreshTimer=null;void refresh();},wait);
      return Promise.resolve();
    }
    lastCheck=now();controller=new AbortController();
    inFlight=(async()=>{
      let requestTimer,requestActive=true;
      try{
        const request=async()=>{
          const response=await fetcher(COMMITS_URL,{headers:{Accept:'application/vnd.github+json','User-Agent':'Number-One-Development-Status',...(etag?{'If-None-Match':etag}:{})},redirect:'error',signal:controller.signal});
          if(stopped||!requestActive)return;
          if(response.status===304)return;
          if(response.status===403||response.status===429){
            const retry=response.headers.get('retry-after'),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
            const retryAt=retry?(Number.isFinite(Number(retry))?now()+Number(retry)*1000:Date.parse(retry)):0;
            blockedUntil=Math.max(now()+60000,Number.isFinite(reset)?reset:0,Number.isFinite(retryAt)?retryAt:0);return;
          }
          if(!response.ok)throw Error('GitHub unavailable');
          const rows=await response.json();if(stopped||!requestActive)return;
          const item=Array.isArray(rows)?rows[0]:null;
          remember({sha:item?.sha,date:item?.commit?.committer?.date});
          etag=response.headers.get('etag')||null;
        };
        await Promise.race([request(),new Promise((_,reject)=>{requestTimer=setTimeout(()=>{controller?.abort();reject(Error('timeout'));},requestTimeoutMs);})]);
      }catch{if(!stopped)log.warn('Development status check unavailable; the current activity still expires on time.');}
      finally{requestActive=false;clearTimeout(requestTimer);inFlight=null;controller=null;apply();}
    })();
    return inFlight;
  }
  return {
    refresh,
    start(){if(started||stopped)return;started=true;apply();void refresh();pollTimer=every(()=>void refresh(),5*60000);pollTimer?.unref?.();},
    stop(){stopped=true;if(expiryTimer)cancel(expiryTimer);if(refreshTimer)cancel(refreshTimer);if(pollTimer)stopEvery(pollTimer);controller?.abort();},
  };
}
