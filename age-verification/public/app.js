const $=id=>document.getElementById(id);
let session,context,guild=new URL(location.href).searchParams.get('guild')||'',selected,evidenceTimer,busy=false;
function message(text){$('message').textContent=text;}
function clearEvidence(){clearTimeout(evidenceTimer);selected=null;$('evidence').hidden=true;$('dob').textContent='';}
function hideServer(){clearEvidence();context=null;$('portal').hidden=true;$('settings').hidden=true;$('review').hidden=true;$('admin').hidden=true;$('queue').replaceChildren();$('requests').replaceChildren();$('audit').textContent='';$('settingsForm').reset();}
async function api(path,data){
  const response=await fetch(path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-CSRF-Token':session?.csrf||''}:{},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok){if(result.inviteUrl){$('install').href=result.inviteUrl;$('installMessage').hidden=false;}throw new Error(result.error);}return result;
}
function serverApi(path,data){return api('/api/guilds/'+encodeURIComponent(guild)+'/'+path,data);}
function action(fn){return async event=>{event?.preventDefault();if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,select')];controls.forEach(el=>el.disabled=true);message('Working…');$('installMessage').hidden=true;
  try{await fn();}catch(error){clearEvidence();message(error.name==='TimeoutError'?'Request timed out. Refresh to inspect the saved result before trying again.':error.message);}finally{busy=false;controls.forEach(el=>el.disabled=false);}};}
function row(parent,text){const el=document.createElement('div');el.className='row';const p=document.createElement('p');p.textContent=text;el.append(p);parent.append(el);return el;}
function button(parent,label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=action(fn);parent.append(b);return b;}
function options(id,roles,chosen){const select=$(id);select.replaceChildren(new Option('Choose a role',''));for(const role of roles)select.add(new Option(role.name,role.id));select.value=chosen||'';}
async function loadServer(){
  hideServer();if(!guild)return;assertGuild();const info=await serverApi('context');context=info;$('portal').hidden=false;$('serverName').textContent=info.name;$('share').value=info.shareUrl;
  $('availability').textContent=info.enabled?'Synthetic Beta is open for this server.':info.manager?'Finish server setup below to open the synthetic Beta.':'Verification is not open for this server yet. Its owner or a server manager can configure it here.';
  $('case').textContent=info.case?`Status: ${info.case.status} · Role: ${info.case.roleState} · DM: ${info.case.dmState}`:'No submission in this server yet.';$('submission').hidden=!!info.case||!info.enabled;
  if(info.reviewer){$('review').hidden=false;const queue=await serverApi('queue');if(!queue.length)$('queue').textContent='No cases waiting in this server.';
    for(const item of queue){const el=row($('queue'),`${item.id} · ${item.status} · ${item.claimant&&item.claimUntil>Date.now()?'claimed by '+item.claimant:'unclaimed'} · Role: ${item.roleState} · DM: ${item.dmState}`);
      if(item.status==='pending'&&info.enabled)button(el,'Claim & view',async()=>{clearEvidence();await serverApi('claim',{id:item.id});const evidence=await serverApi('evidence?id='+encodeURIComponent(item.id));selected=item.id;$('dob').textContent=evidence.dob;$('portrait').src=evidence.portrait;$('evidence').hidden=false;evidenceTimer=setTimeout(clearEvidence,590000);message('Claimed for 10 minutes. Only portrait and full date of birth are released.');});
      if(info.owner&&item.roleState==='uncertain')button(el,'Check Discord role status',async()=>{await serverApi('admin/reconcile',{id:item.id});await loadServer();message('Role status checked. No grant or DM was resent.');});
    }
  }
  if(info.owner){$('admin').hidden=false;const data=await serverApi('admin');for(const request of data.requests){const el=row($('requests'),`${request.id} · ${request.member} · ${request.kind} · ${request.state}`);if(request.kind==='delete'&&request.state==='open')button(el,'Fulfill deletion & remove test role',async()=>{await serverApi('admin/delete',{requestId:request.id});await loadServer();message('Deleted this server’s records. Other servers are unaffected.');});}$('audit').textContent=data.audit.map(e=>`${new Date(e.at).toISOString()} ${e.action} · ${e.actor||'anonymous'} · ${e.caseId||''}`).join('\n');}
  if(info.manager){const data=await serverApi('settings');options('reviewerRole',data.roles,data.settings?.reviewerRole);options('verifiedRole',data.roles.filter(r=>r.canVerify),data.settings?.verifiedRole);$('enabled').checked=!!data.settings?.enabled;$('settings').hidden=false;}
}
function assertGuild(){if(!session.guilds.some(g=>g.id===guild))throw new Error('This server is not in your Discord account’s server list. Join it and sign in again, or choose another server.');}
async function refresh(){
  hideServer();session=await api('/api/session');$('login').hidden=true;$('signedIn').hidden=false;$('who').textContent='Signed in with Discord: '+session.id;
  options('guild',session.guilds.map(g=>({id:g.id,name:g.name+(g.manageable?' · manage server':'')})),guild);$('noServers').hidden=session.guilds.length>0;
  await loadServer();
}
$('guild').onchange=action(async()=>{guild=$('guild').value;history.replaceState(null,'','/verify'+(guild?'?guild='+encodeURIComponent(guild):''));await loadServer();message(guild?'Server selected.':'Choose a server to continue.');});
$('refresh').onclick=action(async()=>{await refresh();message('Updated.');});
$('demoLogin').onclick=action(async()=>{await api('/api/demo-login',{identity:$('identity').value});await refresh();message('Local demo. All Discord actions are simulated.');});
$('logout').onclick=action(async()=>{await api('/api/logout',{});location.reload();});
$('settingsForm').onsubmit=action(async()=>{await serverApi('settings',{reviewerRole:$('reviewerRole').value,verifiedRole:$('verifiedRole').value,enabled:$('enabled').checked,betaAcknowledged:$('betaAcknowledged').checked});await loadServer();message('Settings saved for this server. Share its member link above.');});
$('submission').onsubmit=action(async()=>{await serverApi('submit',{fixture:$('fixture').value,consent:$('consent').checked});await loadServer();message('Test case submitted to this server’s reviewers.');});
for(const[id,decision]of[['approve','approved'],['deny','denied']])$(id).onclick=action(async()=>{const result=await serverApi('decision',{id:selected,decision});await loadServer();message(`Decision saved: ${result.status}. Role: ${result.roleState}. DM: ${result.dmState}. Inspect Discord if delivery is uncertain; do not repeat the decision.`);});
$('delete').onclick=action(async()=>{const data=await serverApi('privacy',{kind:'delete'});message(`Deletion request ${data.id} is open for this server’s owner.`);});
$('export').onclick=action(async()=>{await serverApi('privacy',{kind:'export'});const data=await serverApi('privacy/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='number-one-'+guild+'-privacy.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Downloaded your data for this server.');});
$('copyLink').onclick=action(async()=>{await navigator.clipboard.writeText($('share').value);message('Member link copied.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearEvidence();});
action(async()=>{try{
  const config=await api('/api/config');message('');$('login').hidden=false;
  if(config.mode==='setup'){$('mode').textContent='Discord sign-in is temporarily unavailable while the bot operator completes the connection. Members and server owners never need hosting or developer access.';return;}
  $('mode').textContent=config.mode==='demo'?'Local synthetic demo only.':'Members, reviewers and server managers all sign in here. Choose a server after signing in.';
  $(config.mode==='demo'?'demo':'discord').hidden=false;$('discord').href='/auth/login'+(guild?'?guild='+encodeURIComponent(guild):'');$('addBot').href=config.inviteUrl||'#';
  try{await refresh();}catch(error){hideServer();if(!session){$('signedIn').hidden=true;$('login').hidden=false;}if(!error.message.startsWith('Sign in'))message(error.message);}
}catch(error){message(error.message);}})();
