// Shared helpers and the Verification plugin. dashboard.js owns sign-in, routing and the shell.
const $=id=>document.getElementById(id);
const NO={session:null,busy:false};
NO.message=text=>{$('message').textContent=text;};
NO.api=async(path,data,method)=>{
  method=method||(data?'POST':'GET');
  const response=await fetch(path,{method,headers:data?{'Content-Type':'application/json','X-CSRF-Token':NO.session?.csrf||''}:{},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(60000)});
  const result=await response.json();
  if(!response.ok){if(result.inviteUrl){$('install').href=result.inviteUrl;$('installMessage').hidden=false;}const error=new Error(result.error);error.status=response.status;throw error;}
  return result;
};
NO.action=fn=>async event=>{
  event?.preventDefault();if(NO.busy)return;NO.busy=true;const controls=[...document.querySelectorAll('main button,main select,main input')].map(el=>({el,disabled:el.disabled}));controls.forEach(({el})=>el.disabled=true);NO.message('Working…');$('installMessage').hidden=true;
  try{await fn();}catch(error){Verification.clearEvidence();NO.message(error.name==='TimeoutError'?'The request timed out. Refresh to check the saved result before trying again.':error.message);}
  finally{NO.busy=false;controls.forEach(({el,disabled})=>el.disabled=disabled);if($('share'))$('share').readOnly=true;}
};
NO.row=(parent,text)=>{const el=document.createElement('div');el.className='row';const p=document.createElement('p');p.textContent=text;el.append(p);parent.append(el);return el;};
NO.button=(parent,label,fn,cls)=>{const b=document.createElement('button');b.textContent=label;if(cls)b.className=cls;b.onclick=NO.action(fn);parent.append(b);return b;};

const Verification=(()=>{
  let guild='',selected,evidenceTimer;
  const serverApi=(path,data)=>NO.api('/api/guilds/'+encodeURIComponent(guild)+'/'+path,data);
  function clearEvidence(){clearTimeout(evidenceTimer);selected=null;$('evidence').hidden=true;$('dob').textContent='';}
  function reset(){clearEvidence();for(const id of ['vSettings','review','admin'])$(id).hidden=true;$('queue').replaceChildren();$('requests').replaceChildren();$('audit').textContent='';$('settingsForm').reset();}
  function options(id,roles,chosen){const select=$(id);select.replaceChildren(new Option('Choose a role',''));for(const role of roles)select.add(new Option(role.name,role.id));select.value=chosen||'';}
  async function load(id){
    guild=id;reset();
    const info=await serverApi('context');$('serverName').textContent=info.name;$('share').value=info.shareUrl;
    $('availability').textContent=info.enabled?'Verification is open in this server.':info.manager?'Complete setup below to open verification.':'Verification is not open in this server yet.';
    $('case').textContent=info.case?`Status: ${info.case.status} · Role: ${info.case.roleState} · DM: ${info.case.dmState}`:'No submission in this server.';$('submission').hidden=!!info.case||!info.enabled;
    if(info.reviewer){$('review').hidden=false;const queue=await serverApi('queue');if(!queue.length)$('queue').textContent='No cases waiting.';
      for(const item of queue){const el=NO.row($('queue'),`${item.id.slice(0,8)} · ${item.status} · ${item.claimant&&item.claimUntil>Date.now()?'claimed by '+item.claimant:'unclaimed'} · Role: ${item.roleState} · DM: ${item.dmState}`);
        if(item.status==='pending'&&info.enabled)NO.button(el,'Claim and view',async()=>{clearEvidence();await serverApi('claim',{id:item.id});const evidence=await serverApi('evidence?id='+encodeURIComponent(item.id));selected=item.id;$('dob').textContent=evidence.dob;$('portrait').src=evidence.portrait;$('evidence').hidden=false;evidenceTimer=setTimeout(clearEvidence,590000);NO.message('Claimed for 10 minutes.');});
        if(info.owner&&item.roleState==='uncertain')NO.button(el,'Check role status',async()=>{await serverApi('admin/reconcile',{id:item.id});await load(guild);NO.message('Role status checked. Nothing was resent.');});
      }}
    if(info.owner){$('admin').hidden=false;const data=await serverApi('admin');for(const request of data.requests){const el=NO.row($('requests'),`${request.id.slice(0,8)} · ${request.member} · ${request.kind} · ${request.state}`);if(request.kind==='delete'&&request.state==='open')NO.button(el,'Delete records and remove role',async()=>{await serverApi('admin/delete',{requestId:request.id});await load(guild);NO.message('Records deleted for this server.');},'danger');}$('audit').textContent=data.audit.map(e=>`${new Date(e.at).toISOString()} ${e.action} · ${e.actor||'anonymous'} · ${e.caseId||''}`).join('\n');}
    if(info.manager){const data=await serverApi('settings');options('reviewerRole',data.roles,data.settings?.reviewerRole);options('verifiedRole',data.roles.filter(r=>r.canVerify),data.settings?.verifiedRole);$('enabled').checked=!!data.settings?.enabled;$('vSettings').hidden=false;}
  }
  $('settingsForm').onsubmit=NO.action(async()=>{await serverApi('settings',{reviewerRole:$('reviewerRole').value,verifiedRole:$('verifiedRole').value,enabled:$('enabled').checked,betaAcknowledged:$('betaAcknowledged').checked});await load(guild);NO.message('Settings saved.');});
  $('submission').onsubmit=NO.action(async()=>{await serverApi('submit',{fixture:$('fixture').value,consent:$('consent').checked});await load(guild);NO.message('Submitted for review.');});
  for(const[id,decision]of[['approve','approved'],['deny','denied']])$(id).onclick=NO.action(async()=>{const result=await serverApi('decision',{id:selected,decision});await load(guild);NO.message(`Decision saved: ${result.status}. Role: ${result.roleState}. DM: ${result.dmState}. If delivery is uncertain, check Discord; do not repeat the decision.`);});
  $('delete').onclick=NO.action(async()=>{const data=await serverApi('privacy',{kind:'delete'});NO.message(`Deletion request ${data.id.slice(0,8)} sent to the server owner.`);});
  $('export').onclick=NO.action(async()=>{await serverApi('privacy',{kind:'export'});const data=await serverApi('privacy/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='number-one-'+guild+'-privacy.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);NO.message('Download started.');});
  $('copyLink').onclick=NO.action(async()=>{await navigator.clipboard.writeText($('share').value);NO.message('Link copied.');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearEvidence();});
  return {load,clearEvidence};
})();
