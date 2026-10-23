import {UserError} from './user-error.js';
import {withDeadline,safeError} from './responses.js';
export const defaults={id:'main',modRole:null,privacyRole:null,logChannel:null,retentionDays:365,automod:false,blockedWords:[],mentionLimit:8,spamLimit:6,blockInvites:true,appealContact:null,dmAppeals:true};
export const clean=value=>String(value??'').replace(/@/g,'＠').replace(/[`*_~|>\\]/g,'').slice(0,1000);
export class Moderation {
 constructor(store,{timeoutMs=12000,now=Date.now}={}) {this.store=store;this.timeoutMs=timeoutMs;this.now=now;this.busy=new Set();this.windows=new Map();}
 config(g){return {...defaults,...this.store.get(g,'mod-config','main')};}
 saveConfig(g,patch){return this.store.put(g,'mod-config',{...this.config(g),...patch,id:'main'});}
 cases(g){return this.store.list(g,'mod-case').sort((a,b)=>b.created-a.created);}
 get(g,id){const c=this.store.get(g,'mod-case',id);if(!c)throw new UserError('Case not found in this server.');return c;}
 append(g,c,action,actor,reason){
  c.events.push({at:this.now(),action,actor,reason:clean(reason)});
  this.store.transaction(()=>{
   this.store.put(g,'mod-case',c);
   this.store.put(g,'mod-log',{id:`${c.id}-${c.events.length}`,caseId:c.id,state:'queued',event:c.events.at(-1)});
  });
  return c;
 }
 async run({guild,id,actor,target,action,reason,effect,details={}}) {
  const prior=this.store.get(guild,'mod-case',id);if(prior)return prior;
  if(!reason?.trim())throw new UserError('A reason is required.');
  if(this.cases(guild).some(c=>c.target===target&&['pending','uncertain'].includes(c.state)))throw new UserError('An earlier action for this target is uncertain. The server owner must inspect Discord and use /mod-reconcile.');
  const key=guild+':'+target;if(this.busy.has(key))throw new UserError('Another action is in progress for this target.');
  this.busy.add(key);
  const c={id,guild,actor,target,action,reason:clean(reason),created:this.now(),state:'pending',events:[],details};
  this.store.put(guild,'mod-case',c);
  let active=true;
  const assertActive=()=>{if(!active)throw new UserError('Operation deadline expired. Inspect Discord before reconciliation.');};
  try {
   if(effect)await withDeadline(Promise.resolve().then(()=>effect({assertActive})),this.timeoutMs,'Discord outcome is uncertain.');
   c.state='succeeded';
  }catch(error){
   // An HTTP rejection confirms failure; timeouts, connection errors and 5xx may follow a committed mutation.
   c.state=Number(error.status)>=400&&Number(error.status)<500?'failed':'uncertain';
   c.error=String(error.code||error.name||'Error');
   console.warn(`Moderation ${action} case ${id}: ${c.state} (${c.error}): ${safeError(error)}`);
  }finally{active=false;this.append(guild,c,c.state,actor,reason);this.busy.delete(key);}
  return c;
 }
 reconcile(g,id,actor,outcome,reason){const c=this.get(g,id);if(!['pending','uncertain'].includes(c.state))throw new UserError('Only uncertain or interrupted cases need reconciliation.');c.state=outcome;this.append(g,c,'reconciled:'+outcome,actor,reason);return c;}
 appeal(g,id,actor,caseId,body,submittedBy=actor){
  const c=this.get(g,caseId);if(c.target!==actor||c.state!=='succeeded')throw new UserError('Choose your own completed case in this server.');
  const existing=this.store.list(g,'mod-appeal').find(a=>a.caseId===caseId&&a.actor===actor);
  if(existing)throw new UserError('An appeal already exists for that case. Ask staff for its status.');
  return this.store.transaction(()=>{
   this.append(g,c,'appeal-opened',submittedBy,submittedBy===actor?'Member submitted an appeal':'Staff recorded an externally received appeal');
   return this.store.put(g,'mod-appeal',{id,caseId,actor,submittedBy,body:clean(body),state:'open',created:this.now()});
  });
 }
 review(g,id,actor,decision,reason){const a=this.store.get(g,'mod-appeal',id);if(!a||a.state!=='open')throw new UserError('Open appeal not found in this server.');const c=this.get(g,a.caseId);if(actor===a.actor||actor===c.actor)throw new UserError('A different moderator must review this appeal.');a.state=decision;a.reviewer=actor;a.reason=clean(reason);a.decided=this.now();return this.store.transaction(()=>{this.append(g,c,'appeal:'+decision,actor,reason);return this.store.put(g,'mod-appeal',a);});}
 filter(g,u,content,mentions){
  const cfg=this.config(g);if(!cfg.automod)return null;
  const key=g+':'+u,now=this.now(),window=(this.windows.get(key)||[]).filter(t=>t>now-10000);window.push(now);this.windows.set(key,window);
  if(this.windows.size>10000)for(const [k,w]of this.windows)if(w.at(-1)<now-10000)this.windows.delete(k);
  if(window.length>cfg.spamLimit)return 'Message flood';
  if(mentions>cfg.mentionLimit)return 'Excessive mentions';
  if(cfg.blockInvites&&/(?:discord\.gg|discord(?:app)?\.com\/invite)\s*\//i.test(content))return 'Discord invite';
  if(cfg.blockedWords.some(w=>content.toLowerCase().includes(w.toLowerCase())))return 'Blocked phrase';
  return null;
 }
 sweep(){for(const {guild,...c}of this.store.all('mod-case')){
  if(c.created>this.now()-this.config(guild).retentionDays*86400000||['pending','uncertain'].includes(c.state))continue;
  if(this.store.list(guild,'mod-appeal').some(a=>a.caseId===c.id&&a.state==='open'))continue;
  this.store.remove(guild,'mod-case',c.id);for(const row of this.store.list(guild,'mod-log'))if(row.caseId===c.id)this.store.remove(guild,'mod-log',row.id);
  for(const a of this.store.list(guild,'mod-appeal'))if(a.caseId===c.id)this.store.remove(guild,'mod-appeal',a.id);
 }}
}
