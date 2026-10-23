// Staff evidence attached to moderation cases: screenshots (re-uploaded to the
// moderation log channel so they outlive Discord's expiring CDN links) and
// Discord message links. Proof is never included in member DMs.
import {UserError} from './user-error.js';
export const PROOF={
 type:'Proof screenshots must be PNG, JPEG, GIF or WebP images.',
 size:'Each proof screenshot must be 10 MB or smaller.',
 link:'Proof links must be Discord message links from this server, such as https://discord.com/channels/…',
 tooMany:'Add up to 5 proof message links.',
 none:'Attach a screenshot or add a message link as proof.',
 full:'This case already has the maximum of 10 proof items.',
};
export const MAX_IMAGE_BYTES=10*1024*1024,MAX_LINKS=5,MAX_ITEMS=10;
const IMAGE_TYPES=['image/png','image/jpeg','image/gif','image/webp'];
const LINK=/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/;
export const proofOptions=[
 {type:11,name:'proof',description:'Screenshot as proof (image)'},
 {type:11,name:'proof2',description:'Extra screenshot as proof'},
 {type:11,name:'proof3',description:'Extra screenshot as proof'},
 {type:3,name:'proof_link',description:'Discord message link(s) as proof, separated by spaces',max_length:600},
];
const fail=m=>{throw new UserError(m);};
const safeName=(name,n)=>{const ext=(/\.(png|jpe?g|gif|webp)$/i.exec(String(name||''))?.[1]||'png').toLowerCase();return `proof-${n}.${ext}`;};
// Reads and validates proof options. Returns [] when none were given.
export function readProof(i,{actor=i.user?.id,now=Date.now()}={}){
 const items=[];
 const atts=['proof','proof2','proof3'].map(n=>i.options?.getAttachment?.(n)).filter(Boolean);
 for(const a of atts){
  const type=String(a.contentType||'').split(';')[0].trim().toLowerCase();
  if(!IMAGE_TYPES.includes(type))fail(PROOF.type);
  if(!(Number(a.size)>0&&Number(a.size)<=MAX_IMAGE_BYTES))fail(PROOF.size);
  items.push({type:'image',url:String(a.url),name:safeName(a.name,items.length+1),size:Number(a.size),addedBy:actor,at:now,stored:false});
 }
 const raw=i.options?.getString?.('proof_link');
 if(raw!=null&&String(raw).trim()){
  const links=[...new Set(String(raw).split(/[\s,]+/).filter(Boolean))];
  if(links.length>MAX_LINKS)fail(PROOF.tooMany);
  for(const l of links){const m=LINK.exec(l);if(!m||m[1]!==i.guildId)fail(PROOF.link);const url=`https://discord.com/channels/${m[1]}/${m[2]}/${m[3]}`;if(!items.some(p=>p.url===url))items.push({type:'link',url,addedBy:actor,at:now});}
 }
 return items;
}
export const proofItems=c=>Array.isArray(c?.details?.proof)?c.details.proof:[];
// Best durable URL: the re-uploaded log copy when available.
export const imageUrl=p=>p.storedUrl||p.url;
export function proofSummary(c,{max=1000}={}){
 const items=proofItems(c);if(!items.length)return null;
 let n=0,l=0;
 const lines=items.map(p=>p.type==='image'?`[Screenshot ${++n}](${imageUrl(p)})${p.logMessage?` · [log copy](${p.logMessage})`:''}`:`[Message link ${++l}](${p.url})`);
 let out='';for(const line of lines){if((out+line).length+1>max){out+='\n…';break;}out+=(out?'\n':'')+line;}
 return out;
}
export const firstImage=c=>{const p=proofItems(c).find(p=>p.type==='image');return p?imageUrl(p):null;};
export function addProof(c,items){
 const all=[...proofItems(c),...items];if(all.length>MAX_ITEMS)fail(PROOF.full);
 c.details={...c.details,proof:all};return c;
}
