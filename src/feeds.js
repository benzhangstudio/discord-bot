import {UserError} from './user-error.js';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import Parser from 'rss-parser';
import {webUrl} from './domain.js';
const parser = new Parser();
// Reject private/special IPv4 and IPv6 destinations, even on an approved host.
export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===2))) || (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
  }
  // Only global-unicast IPv6; exclude documentation and transition ranges.
  return isIP(ip)===6 && /^[23]/i.test(ip) && !/^(2001:(db8|0|10|20):|2002:)/i.test(ip);
}
export function allowedUrl(text, hosts = process.env.FEED_ALLOWED_HOSTS || '') {
  let url;try{url=new URL(text);}catch{throw new UserError('Paste the full feed link supplied by your source, starting with https://.');}
  const allow = hosts.split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
  if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || isIP(url.hostname) || !allow.includes(url.hostname.toLowerCase())) throw new UserError('Use a feed link from a source approved by the bot owner. Ask the owner to add your source if needed. An Instagram profile link will not work.');
  return url;
}
export async function loadFeed(text) {
  const url = allowedUrl(text);
  const addresses = await lookup(url.hostname,{all:true});
  if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new UserError('Number One cannot open this source. Ask the bot owner for a supported feed link.');
  const chosen = addresses[0];
  const xml = await new Promise((resolve,reject)=>{
    const request = https.get(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'NumberOneDiscordBot/0.1 RSS reader','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml'},lookup:(_host,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},response=>{
      if (response.statusCode!==200) {response.resume(); reject(Error('This feed link did not open. Ask your source provider for a working, direct feed link.')); return;}
      let size=0; const chunks=[];
      response.on('data',chunk=>{size+=chunk.length; if(size>2_000_000) {response.destroy(Error('Feed exceeds 2 MB.'));} else chunks.push(chunk);});
      response.on('error',reject); response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.setTimeout(15000,()=>request.destroy(Error('Feed request timed out.'))); request.on('error',reject);
  });
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UserError('Number One cannot read this feed format. Ask your source provider for another feed link.');
  const feed = await parser.parseString(xml);
  return (feed.items || []).slice(0,100).flatMap(item=>{
    try {const link=webUrl(item.link); return [{key:String(item.guid || link),title:String(item.title || 'New post').slice(0,250),link,date:item.isoDate || item.pubDate || ''}];} catch {return [];}
  });
}
export function feedMessage(feed,item) {
  return {content:`${feed.role ? `<@&${feed.role}> ` : ''}**${feed.name.replace(/[\\*_~`|<>@]/g,'')}**\n${item.title.replace(/[@<>]/g,'')}\n${item.link}`.slice(0,2000),allowedMentions:{parse:[],roles:feed.role?[feed.role]:[],users:[]}};
}
