import {UserError} from './user-error.js';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import Parser from 'rss-parser';
import {webUrl} from './domain.js';
const parser = new Parser();
// Every server can supply a source; resolve and pin public addresses on every request.
export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || b===2 || (b===88&&c===99))) || (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
  }
  // Only global-unicast IPv6; exclude documentation and transition ranges.
  return isIP(ip)===6 && /^[23]/i.test(ip) && !/^(2001:db8:|2002:|3fff:)/i.test(ip) && !(ip.toLowerCase().startsWith('2001:')&&parseInt(ip.split(':')[1]||'0',16)<0x200);
}
export function allowedUrl(text) {
  let url;try{url=new URL(text);}catch{throw new UserError('Paste the full feed link supplied by your source, starting with https://.');}
  if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || isIP(url.hostname.replace(/[\[\]]/g,'')) || !url.hostname.includes('.') || /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new UserError('Use an HTTPS RSS or Atom link from your Instagram feed service. Local addresses and links containing login details are not supported.');
  return url;
}
export async function loadFeed(text,{resolve=lookup,get=https.get}={}) {
  const url = allowedUrl(text);
  let addresses;
  try {addresses=await resolve(url.hostname,{all:true});}catch{throw new UserError('This feed service could not be reached. Check the feed link and try again later.');}
  if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new UserError('This source does not have a public internet address. Choose a public HTTPS feed link.');
  const chosen = addresses[0];
  const xml = await new Promise((resolve,reject)=>{
    const request = get(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'NumberOneDiscordBot/0.1 RSS reader','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml'},lookup:(_host,opts,cb)=>opts.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},response=>{
      if (response.statusCode!==200) {response.resume(); reject(new UserError('This feed link did not open. Check that your feed service supplied a working, direct RSS/Atom link. Redirects are not supported.')); return;}
      let size=0; const chunks=[];
      response.on('data',chunk=>{size+=chunk.length; if(size>2_000_000) {response.destroy(new UserError('This feed is too large. Choose a feed containing fewer recent posts (under 2 MB).'));} else chunks.push(chunk);});
      response.on('error',reject); response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.setTimeout(15000,()=>request.destroy(new UserError('This feed service took too long to respond. Try again later.'))); request.on('error',()=>reject(new UserError('This feed service could not be reached. Check the link and try again later.')));
  });
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UserError('The bot cannot read this feed format. Ask your source provider for another feed link.');
  let feed;
  try {feed=await parser.parseString(xml);} catch {throw new UserError('This link is not a readable RSS or Atom feed. Use the feed link from your Instagram feed service, rather than an Instagram profile link.');}
  return (feed.items || []).slice(0,100).flatMap(item=>{
    try {const link=webUrl(item.link); return [{key:String(item.guid || link),title:String(item.title || 'New post').slice(0,250),link,date:item.isoDate || item.pubDate || ''}];} catch {return [];}
  });
}
export function feedMessage(feed,item) {
  return {content:`${feed.role ? `<@&${feed.role}> ` : ''}**${feed.name.replace(/[\\*_~`|<>@]/g,'')}**\n${item.title.replace(/[@<>]/g,'')}\n${item.link}`.slice(0,2000),allowedMentions:{parse:[],roles:feed.role?[feed.role]:[],users:[]}};
}
