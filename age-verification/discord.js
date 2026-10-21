import { assert, Fault } from './core.js';

export async function boundedFetch(url, options = {}, fetcher = fetch, timeout = 8000) {
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { ...options, signal: controller.signal });
        const data = response.status === 204 ? null : await response.json();
        if (!response.ok) throw new Fault(502, response.status === 429 ? 'Discord rate limited this request. Wait before trying again.' : 'Discord request failed. Check bot permissions and server membership.');
        return data;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Fault(504, 'Discord delivery uncertain. Inspect Discord before retrying.')); }, timeout); })
    ]);
  } finally { clearTimeout(timer); }
}
export class Discord {
  constructor(config, fetcher = fetch) { this.c = config; this.fetcher = fetcher; }
  api(path, method = 'GET', body) {
    return boundedFetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + this.c.botToken, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, this.fetcher, this.c.requestTimeout ?? 8000);
  }
  async identity(id) {
    const [guild, member] = await Promise.all([this.api('/guilds/' + this.c.guild), this.api(`/guilds/${this.c.guild}/members/${id}`)]);
    return { id, owner: guild.owner_id === id, reviewer: guild.owner_id === id || member.roles.includes(this.c.reviewerRole) };
  }
  async exchange(code) {
    const token = await boundedFetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id:this.c.clientId,client_secret:this.c.clientSecret,grant_type:'authorization_code',code,redirect_uri:this.c.origin + '/auth/callback' }) }, this.fetcher, this.c.requestTimeout ?? 8000);
    assert(typeof token.access_token === 'string', 502, 'Discord did not return an access token.');
    try {
      const user = await boundedFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization:'Bearer ' + token.access_token } }, this.fetcher, this.c.requestTimeout ?? 8000);
      return await this.identity(user.id);
    } finally {
      // Access tokens are never persisted; revoke after obtaining the identity.
      await boundedFetch('https://discord.com/api/oauth2/token/revoke', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({client_id:this.c.clientId,client_secret:this.c.clientSecret,token:token.access_token}) }, this.fetcher, this.c.requestTimeout ?? 8000).catch(() => {});
    }
  }
  role(member, method = 'PUT') { return this.api(`/guilds/${this.c.guild}/members/${member}/roles/${this.c.verifiedRole}`, method); }
  async dm(member, status) {
    const channel = await this.api('/users/@me/channels', 'POST', { recipient_id:member });
    return this.api(`/channels/${channel.id}/messages`, 'POST', { content:`Number One Age Verification Beta: your synthetic test submission was ${status}. Check the member portal for role delivery status.`, allowed_mentions:{parse:[]} });
  }
}
