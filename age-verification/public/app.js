const $ = id => document.getElementById(id);
let me, selected, evidenceTimer;
function message(text) { $('message').textContent = text; }
async function api(path, data) {
  const r = await fetch(path,{method:data ? 'POST':'GET',headers:data ? {'Content-Type':'application/json','X-CSRF-Token':me?.csrf || ''}:{},...(data ? {body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(45000)});
  const result = await r.json();if(!r.ok) throw new Error(result.error);return result;
}
function action(fn) { return async event => {event?.preventDefault();const controls = [...document.querySelectorAll('button')];controls.forEach(b=>b.disabled=true);message('Working…');try{await fn();}catch(e){message(e.name==='TimeoutError'?'Request timed out. Refresh to inspect the saved result before trying again.':e.message);}finally{controls.forEach(b=>b.disabled=false);}}; }
function row(parent,text) {const el=document.createElement('div');el.className='row';const p=document.createElement('p');p.textContent=text;el.append(p);parent.append(el);return el;}
function button(parent,label,fn,cls='') {const b=document.createElement('button');b.textContent=label;b.className=cls;b.onclick=action(fn);parent.append(b);return b;}
function clearEvidence(){clearTimeout(evidenceTimer);selected=null;$('evidence').hidden=true;$('dob').textContent='';}
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearEvidence();});
async function refresh() {
  clearEvidence();me=await api('/api/me');$('portal').hidden=false;$('login').hidden=true;$('who').textContent=`Signed in: ${me.id}${me.owner?' · server owner':me.reviewer?' · reviewer':''}`;
  $('case').textContent=me.case ? `Status: ${me.case.status} · Role: ${me.case.roleState} · DM: ${me.case.dmState}`:'No submission yet.';
  $('submission').hidden=!!me.case;$('review').hidden=!me.reviewer;$('admin').hidden=!me.owner;
  if(me.reviewer){
    const queue=await api('/api/queue');$('queue').replaceChildren();if(!queue.length) $('queue').textContent='No cases waiting.';
    for(const c of queue){const el=row($('queue'),`${c.id} · ${c.status} · ${c.claimant && c.claimUntil>Date.now()?'claimed by '+c.claimant:'unclaimed'} · Role: ${c.roleState} · DM: ${c.dmState}`);
      if(c.status==='pending') button(el,'Claim & view',async()=>{clearEvidence();await api('/api/claim',{id:c.id});const e=await api('/api/evidence?id='+encodeURIComponent(c.id));selected=c.id;$('dob').textContent=e.dob;$('portrait').src=e.portrait;$('evidence').hidden=false;evidenceTimer=setTimeout(clearEvidence,590000);message('Claimed for 10 minutes. Only portrait and full DOB are released.');});
      if(me.owner && c.roleState==='uncertain') button(el,'Check Discord role status',async()=>{await api('/api/admin/reconcile',{id:c.id});await refresh();message('Role reconciled from current Discord membership. DM delivery remains uncertain if shown.');});
    }
  }
  if(me.owner){const a=await api('/api/admin');$('requests').replaceChildren();for(const p of a.requests){const el=row($('requests'),`${p.id} · ${p.member} · ${p.kind} · ${p.state}`);if(p.kind==='delete'&&p.state==='open') button(el,'Fulfill deletion & revoke role',async()=>{await api('/api/admin/delete',{requestId:p.id});await refresh();message('Deletion completed.');});}$('audit').textContent=a.audit.map(e=>`${new Date(e.at).toISOString()} ${e.action} · ${e.actor || 'anonymous'} · ${e.caseId || ''}`).join('\n');}
}
$('demoLogin').onclick=action(async()=>{await api('/api/demo-login',{identity:$('identity').value});await refresh();message('Demo session started. All Discord actions are simulated.');});
$('refresh').onclick=action(async()=>{await refresh();message('Updated.');});
$('logout').onclick=action(async()=>{await api('/api/logout',{});location.reload();});
$('submission').onsubmit=action(async()=>{await api('/api/submit',{fixture:$('fixture').value,consent:$('consent').checked});await refresh();message('Synthetic submission is ready for manual review.');});
for(const [id,decision] of [['approve','approved'],['deny','denied']]) $(id).onclick=action(async()=>{const result=await api('/api/decision',{id:selected,decision});await refresh();message(`Decision saved: ${result.status}. Role: ${result.roleState}. DM: ${result.dmState}. Uncertain delivery requires inspection in Discord; do not repeat the decision.`);});
$('delete').onclick=action(async()=>{const r=await api('/api/privacy',{kind:'delete'});message(`Deletion request ${r.id} is open for the server owner.`);});
$('export').onclick=action(async()=>{await api('/api/privacy',{kind:'export'});const data=await api('/api/privacy/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='number-one-privacy-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Privacy export downloaded.');});
(async()=>{try{const c=await api('/api/config');if(c.mode==='setup'){$('login').hidden=false;$('mode').textContent='Verification is not open yet. The server owner is configuring Discord sign-in. No submissions or reviewer access are available.';return;}$('mode').textContent=c.mode==='demo'?'Local demo · no Discord credentials or real identity processing.':'Discord sign-in · synthetic documents only. No real identity provider is connected.';$(c.mode==='demo'?'demo':'discord').hidden=false;try{await refresh();}catch(e){$('portal').hidden=true;$('login').hidden=false;if(!e.message.includes('Sign in'))message(e.message);}}catch(e){message(e.message);}})();
