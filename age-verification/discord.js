import {assert,Fault} from './core.js';
export async function boundedFetch(url,options={},fetcher=fetch,timeout=8000){
  const controller=new AbortController();let timer;
  try{return await Promise.race([
    (async()=>{const response=await fetcher(url,{...options,signal:controller.signal});const data=response.status===204?null:await response.json();
      if(!response.ok){const error=new Fault(response.status===403||response.status===404?403:502,response.status===429?'Discord rate limited this request. Wait before trying again.':'Discord request failed. Check server membership, bot installation and permissions.');error.discordStatus=response.status;error.discordCode=data?.code;throw error;}return data;})(),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Fault(504,'Discord delivery uncertain. Inspect Discord before retrying.'));},timeout);})
  ]);}finally{clearTimeout(timer);}
}
const ADMIN=8n,MANAGE_SERVER=32n,MANAGE_ROLES=1n<<28n;
// Test roles must not grant global moderation/administration capabilities.
const ELEVATED=ADMIN|MANAGE_SERVER|MANAGE_ROLES|2n|4n|(1n<<29n)|(1n<<40n);
export function permissions(roles,member){return roles.filter(r=>member.roles.includes(r.id)||r.everyone).reduce((p,r)=>p|BigInt(r.permissions),0n);}
export class Discord{
  constructor(config,fetcher=fetch){this.c=config;this.fetcher=fetcher;}
  api(path,method='GET',body){return boundedFetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:'Bot '+this.c.botToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},this.fetcher,this.c.requestTimeout??8000);}
  async exchange(code){
    const until=Date.now()+30000;const call=(url,options)=>{const remaining=until-Date.now();assert(remaining>0,504,'Discord sign-in timed out. Sign in again.');return boundedFetch(url,options,this.fetcher,Math.min(this.c.requestTimeout??8000,remaining));};
    const form={client_id:this.c.clientId,client_secret:this.c.clientSecret};
    const token=await call('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...form,grant_type:'authorization_code',code,redirect_uri:this.c.origin+'/auth/callback'})});
    assert(typeof token.access_token==='string',502,'Discord did not return an access token.');
    try{
      const options={headers:{Authorization:'Bearer '+token.access_token}};
      const user=await call('https://discord.com/api/v10/users/@me',options);const guilds=[];let after='0';
      for(let page=0;page<20;page++){
        const batch=await call('https://discord.com/api/v10/users/@me/guilds?limit=200&after='+after,options);assert(Array.isArray(batch),502,'Discord server list is unavailable. Sign in again.');
        guilds.push(...batch.map(g=>({id:g.id,name:g.name,manageable:g.owner||((BigInt(g.permissions)&(ADMIN|MANAGE_SERVER))!==0n)})));
        if(batch.length<200)return {id:user.id,guilds};
        assert(batch.at(-1).id!==after,502,'Discord server pagination failed. Sign in again.');after=batch.at(-1).id;
      }
      throw new Fault(502,'Discord server list exceeded the supported size. Contact Number One support.');
    }finally{
      // Tokens exist only during sign-in, never in the database/browser session.
      await boundedFetch('https://discord.com/api/oauth2/token/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...form,token:token.access_token})},this.fetcher,this.c.requestTimeout??8000).catch(()=>{});
    }
  }
  async identity(guild,id,settings){
    const [g,member,raw]=await Promise.all([this.api('/guilds/'+guild),this.api(`/guilds/${guild}/members/${id}`),this.api(`/guilds/${guild}/roles`)]);
    const roles=raw.map(r=>({...r,everyone:r.id===guild}));const owner=g.owner_id===id;
    return {id,name:g.name,owner,manager:owner||(permissions(roles,member)&(ADMIN|MANAGE_SERVER))!==0n,reviewer:owner||!!settings&&member.roles.includes(settings.reviewerRole)};
  }
  async roleOptions(guild){
    const [roles,bot]=await Promise.all([this.api(`/guilds/${guild}/roles`),this.api(`/guilds/${guild}/members/${this.c.clientId}`)]);
    const effective=permissions(roles.map(r=>({...r,everyone:r.id===guild})),bot);
    assert((effective&(ADMIN|MANAGE_ROLES))!==0n,409,'Number One needs Manage Roles permission in this server. Update its Discord role, then try again.');
    const highest=roles.filter(r=>bot.roles.includes(r.id)).reduce((p,r)=>Math.max(p,r.position),0);
    return roles.filter(r=>r.id!==guild&&!r.managed).map(r=>({id:r.id,name:r.name,canVerify:r.position<highest&&(BigInt(r.permissions)&ELEVATED)===0n}));
  }
  async validateRoles(guild,reviewerRole,verifiedRole){
    assert(reviewerRole!==verifiedRole,400,'Choose different reviewer and Beta test verified roles.');const roles=await this.roleOptions(guild);
    assert(roles.some(r=>r.id===reviewerRole),400,'Choose a current custom reviewer role.');
    assert(roles.some(r=>r.id===verifiedRole&&r.canVerify),400,'Choose an ordinary test role below Number One, without administrative permissions.');return roles;
  }
  async validateVerified(guild,role){assert((await this.roleOptions(guild)).some(r=>r.id===role&&r.canVerify),409,'The saved test role is missing, elevated or above Number One. Correct it in Discord before approving.');}
  role(guild,member,role,method='PUT'){return this.api(`/guilds/${guild}/members/${member}/roles/${role}`,method);}
  async removeRole(guild,member,role){
    try{return await this.role(guild,member,role,'DELETE');}catch(error){if(error.discordStatus===404&&error.discordCode===10007)return;throw error;}
  }
  async dm(guild,member,status){
    const channel=await this.api('/users/@me/channels','POST',{recipient_id:member});
    return this.api(`/channels/${channel.id}/messages`,'POST',{content:`Number One Age Verification Beta: your synthetic test submission for server ${guild} was ${status}. Check the member portal for role delivery status.`,allowed_mentions:{parse:[]}});
  }
  member(guild,id){return this.api(`/guilds/${guild}/members/${id}`);}
}
