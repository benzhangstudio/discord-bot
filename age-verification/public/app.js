// Shared helpers and the Verification plugin. dashboard.js owns sign-in and routing.
const $=id=>document.getElementById(id);
const NO={session:null,busy:false};
NO.message=(text,tone='success')=>{
  const node=$('message');node.textContent=text||'';node.className='message'+(text?' '+tone:'');
  node.setAttribute('role',tone==='error'?'alert':'status');
};
NO.api=async(path,data,method)=>{
  method=method||(data?'POST':'GET');
  let response,result;
  try{
    response=await fetch(path,{method,headers:data?{'Content-Type':'application/json','X-CSRF-Token':NO.session?.csrf||''}:{},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(60000)});
    result=await response.json();
  }catch(error){
    if(error.name==='TimeoutError'||error.name==='AbortError')throw new Error('The request timed out. Refresh to check the saved result before trying again.');
    throw new Error('Could not connect to Number One. Check your connection, then refresh to check the saved result.');
  }
  if(!result||typeof result!=='object')throw new Error('Number One returned an unreadable response. Refresh the page to check the saved result.');
  if(!response.ok){
    if(result.inviteUrl){$('install').href=result.inviteUrl;$('installMessage').hidden=false;}
    const error=new Error(typeof result.error==='string'?result.error:'Unable to complete this request. Refresh the page and try again.');error.status=response.status;throw error;
  }
  return result;
};
NO.action=fn=>async event=>{
  event?.preventDefault();if(NO.busy)return;NO.busy=true;
  const actionRoute=typeof routeVersion==='number'?routeVersion:null;
  const controls=[...document.querySelectorAll('main button,main select,main input,main textarea')].map(node=>({node,disabled:node.disabled}));
  controls.forEach(({node})=>node.disabled=true);NO.message('Working…','pending');$('installMessage').hidden=true;
  try{await fn(event);}catch(error){if(actionRoute===null||actionRoute===routeVersion){Verification.clearEvidence(false);NO.message(error instanceof TypeError?'This action could not be completed. Refresh the page to check your saved changes.':error?.message||'Unable to complete this request. Refresh the page and try again.','error');}}
  finally{
    NO.busy=false;controls.forEach(({node,disabled})=>node.disabled=disabled);if($('share'))$('share').readOnly=true;
    if($('message').textContent==='Working…')NO.message('');
    if(NO.pendingNavigation){NO.pendingNavigation=false;await route();}
  }
};
NO.row=(parent,text)=>{const node=document.createElement('div');node.className='row';const p=document.createElement('p');p.textContent=text;node.append(p);parent.append(node);return node;};
NO.button=(parent,label,fn,cls)=>{const b=document.createElement('button');b.type='button';b.textContent=label;if(cls)b.className=cls;b.onclick=NO.action(fn);parent.append(b);return b;};

const Verification=(()=>{
  let guild='',generation=0,evidenceVersion=0,selected=null,evidenceTimer;
  const snapshot=()=>({guild,generation});
  const current=scope=>scope.guild===guild&&scope.generation===generation;
  const serverApi=(scope,path,data)=>NO.api('/api/guilds/'+encodeURIComponent(scope.guild)+'/'+path,data);
  const date=value=>value?new Date(value).toLocaleString():'Unknown date';
  const status=value=>({pending:'Awaiting review',approved:'Approved',denied:'Denied'}[value]||'Status unavailable');
  const roleStatus=value=>({delivered:'Test role assigned',simulated:'Test role simulated',pending:'Assigning test role',uncertain:'Check the test role in Discord',failed:'Test role could not be assigned',not_delivered:'Test role is not assigned',not_requested:'No test role assigned'}[value]||'Role status unavailable');
  const notificationStatus=value=>({delivered:'Decision notification sent',simulated:'Decision notification simulated',pending:'Sending decision notification',uncertain:'Notification delivery not confirmed',failed:'Decision notification could not be sent',not_requested:'No notification sent'}[value]||'Notification status unavailable');
  function summary(item){return [status(item.status),...(item.status==='pending'?[]:[roleStatus(item.roleState),notificationStatus(item.dmState)])].join(' · ');}
  function hideEvidence(){clearTimeout(evidenceTimer);evidenceVersion++;selected=null;$('evidence').hidden=true;$('dob').textContent='';$('portrait').src='/portrait.svg';}
  // Routing calls this before leaving a server, invalidating every outstanding load.
  function clearEvidence(invalidate=true){if(invalidate)generation++;hideEvidence();}
  function reset(){
    hideEvidence();for(const id of ['vSettings','review','admin','submission'])$(id).hidden=true;
    for(const id of ['queue','requests','audit'])$(id).replaceChildren();
    $('serverName').textContent='Loading verification…';$('availability').textContent='';$('share').value='';$('case').textContent='Loading your status…';
    for(const id of ['settingsForm','submission']){$(id).reset();$(id).dataset.dirty='false';}
  }
  function options(id,roles,chosen){const select=$(id);select.replaceChildren(new Option('Choose a role',''));for(const role of roles)select.add(new Option(role.name,role.id));select.value=chosen||'';}
  async function reload(scope,message){if(!current(scope))return;if(await load(scope.guild))NO.message(message);}
  function auditLabel(action){
    const labels={settings_enabled:'Verification enabled',settings_paused:'Verification paused',synthetic_submitted:'Test submission created',claimed:'Case claimed',evidence_viewed:'Test evidence viewed',approved:'Case approved',denied:'Case denied',privacy_export:'Data export requested',privacy_delete:'Deletion requested',privacy_deletion_completed:'Records deleted'};
    if(labels[action])return labels[action];if(action.startsWith('roleState:'))return roleStatus(action.slice(10));if(action.startsWith('dmState:'))return notificationStatus(action.slice(8));return 'Verification record updated';
  }
  async function load(id){
    guild=id;const scope={guild:id,generation:++generation};reset();
    try{
      const info=await serverApi(scope,'context');if(!current(scope))return false;
      const [queue,admin,settings]=await Promise.all([info.reviewer?serverApi(scope,'queue'):null,info.securityAdmin?serverApi(scope,'admin'):null,info.securityAdmin?serverApi(scope,'settings'):null]);
      if(!current(scope))return false;
      $('serverName').textContent=info.name;$('share').value=info.shareUrl;
      $('availability').textContent=info.enabled?'Verification is open in this server.':info.securityAdmin?'Complete setup below to open verification.':'Verification is not open in this server yet.';
      $('case').textContent=info.case?summary(info.case):'You have not submitted a test case in this server.';$('submission').hidden=!!info.case||!info.enabled;
      if(info.reviewer){
        $('review').hidden=false;if(!queue.length)$('queue').textContent='No submissions to review.';
        for(const item of queue){
          const claimed=item.claimant&&item.claimUntil>Date.now();
          const claim=claimed?(item.claimant===NO.session?.id?'Claimed by you':'Claimed by another reviewer'):'Not claimed';
          const row=NO.row($('queue'),`${item.memberName||'Case '+item.id.slice(0,8)} · ${summary(item)} · ${date(item.created)}${item.status==='pending'?' · '+claim:''}`);
          if(item.status==='pending'&&info.enabled){
            const view=NO.button(row,claimed&&item.claimant===NO.session?.id?'View test evidence':'Claim and review',async()=>{
              if(!current(scope))return;hideEvidence();const version=evidenceVersion;
              await serverApi(scope,'claim',{id:item.id});if(!current(scope)||version!==evidenceVersion)return;
              const evidence=await serverApi(scope,'evidence?id='+encodeURIComponent(item.id));if(!current(scope)||version!==evidenceVersion)return;
              selected={...scope,id:item.id};$('dob').textContent=new Date(evidence.dob+'T00:00:00Z').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});$('portrait').src=evidence.portrait;$('evidence').hidden=false;evidenceTimer=setTimeout(hideEvidence,590000);NO.message('Case claimed for 10 minutes. Review the test evidence below.');
            });
            view.disabled=!!claimed&&item.claimant!==NO.session?.id;
          }
          if(info.securityAdmin&&item.roleState==='uncertain')NO.button(row,'Check role in Discord',async()=>{if(!current(scope))return;await serverApi(scope,'admin/reconcile',{id:item.id});await reload(scope,'Role status checked.');});
        }
      }
      if(info.securityAdmin){
        $('admin').hidden=false;if(!admin.requests.length)$('requests').textContent='No privacy requests.';
        for(const request of admin.requests){
          const row=NO.row($('requests'),`${request.kind==='delete'?'Delete records':'Data export'} · ${request.memberName||'User '+request.member} · ${request.state==='open'?'Awaiting action':'Completed'} · ${date(request.created)}`);
          if(request.kind==='delete'&&request.state==='open')NO.button(row,'Delete records and remove role',async()=>{
            if(!current(scope)||!confirm('Delete this member’s verification records and remove their test role?'))return;
            await serverApi(scope,'admin/delete',{requestId:request.id});await reload(scope,'Verification records deleted for this server.');
          },'danger');
        }
        if(!admin.audit.length)$('audit').textContent='No recent verification activity.';
        for(const entry of admin.audit){const actor=entry.actor==='system'?'Number One':entry.actorName||(!entry.actor?'Anonymous':'User '+entry.actor);NO.row($('audit'),`${date(entry.at)} · ${auditLabel(entry.action)} · ${actor}${entry.caseId?' · Case '+entry.caseId.slice(0,8):''}`);}
      }
      if(info.securityAdmin){options('reviewerRole',settings.roles,settings.settings?.reviewerRole);options('verifiedRole',settings.roles.filter(r=>r.canVerify),settings.settings?.verifiedRole);$('enabled').checked=!!settings.settings?.enabled;$('vSettings').hidden=false;}
      return true;
    }catch(error){if(!current(scope))return false;throw error;}
  }
  for(const id of ['settingsForm','submission'])for(const event of ['input','change'])$(id).addEventListener(event,()=>$(id).dataset.dirty='true');
  $('settingsForm').onsubmit=NO.action(async()=>{
    const scope=snapshot();await serverApi(scope,'settings',{reviewerRole:$('reviewerRole').value,verifiedRole:$('verifiedRole').value,enabled:$('enabled').checked,betaAcknowledged:$('betaAcknowledged').checked});await reload(scope,'Verification settings saved.');
  });
  $('submission').onsubmit=NO.action(async()=>{const scope=snapshot();await serverApi(scope,'submit',{fixture:$('fixture').value,consent:$('consent').checked});await reload(scope,'Test case submitted for review.');});
  for(const[id,decision]of[['approve','approved'],['deny','denied']])$(id).onclick=NO.action(async()=>{
    const scope=snapshot(),item=selected;if(!item||!current(item))throw new Error('Claim a case and open its test evidence before making a decision.');
    const result=await serverApi(scope,'decision',{id:item.id,decision});const uncertain=result.roleState==='uncertain'||result.dmState==='uncertain';await reload(scope,`Decision saved: ${summary(result)}.${uncertain?' Check Discord before repeating a delivery.':''}`);
  });
  $('delete').onclick=NO.action(async()=>{const scope=snapshot();await serverApi(scope,'privacy',{kind:'delete'});if(current(scope))NO.message('Deletion requested. The server owner can now remove your verification records.');});
  $('export').onclick=NO.action(async()=>{
    const scope=snapshot();await serverApi(scope,'privacy',{kind:'export'});if(!current(scope))return;const data=await serverApi(scope,'privacy/export');if(!current(scope))return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='number-one-'+scope.guild+'-privacy.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);NO.message('Your data download has started.');
  });
  $('copyLink').onclick=NO.action(async()=>{const scope=snapshot();await navigator.clipboard.writeText($('share').value);if(current(scope))NO.message('Member verification link copied.');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hideEvidence();});
  return {load,clearEvidence};
})();
