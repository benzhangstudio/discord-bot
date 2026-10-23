// Dashboard shell: sign-in, server picker, History API routing and plugin pages.
const TITLES={overview:'Overview',moderation:'Moderation',automod:'Automod',embeds:'Embeds',scheduler:'Scheduler',instagram:'Instagram',reactionroles:'Reaction Roles',verification:'Verification',access:'Access',settings:'Settings'};
const LEADS={overview:'Server status and plugins.',moderation:'Cases, actions and appeals.',automod:'Automatic message filtering.',embeds:'Saved embed messages.',scheduler:'Upcoming events, meetings and rotations.',instagram:'Instagram roundup sources.',reactionroles:'Members pick roles by reacting to a message.',access:'Members granted command access by the server owner.',settings:'General server settings.'};
let config,guilds=[];
const el=(tag,props={},...children)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else n.setAttribute(k,v);}n.append(...children.filter(Boolean));return n;};
const fmt=ms=>ms?new Date(ms).toLocaleString():'—';
function show(view){for(const v of document.querySelectorAll('.view'))v.hidden=v.id!=='view-'+view;}
function navigate(path){history.pushState(null,'',path);route();}
document.addEventListener('click',e=>{const a=e.target.closest('a[data-link]');if(a&&!e.ctrlKey&&!e.metaKey&&e.button===0){e.preventDefault();navigate(a.getAttribute('href'));}});
window.addEventListener('popstate',()=>route());
function parse(){
  const url=new URL(location.href);
  if(url.pathname.startsWith('/verify')){const g=url.searchParams.get('guild');if(g&&/^\d{17,20}$/.test(g)){history.replaceState(null,'','/dashboard/'+g+'/verification');return {guild:g,plugin:'verification'};}history.replaceState(null,'','/dashboard');}
  const m=location.pathname.match(/^\/dashboard\/(\d{17,20})(?:\/([a-z]+))?\/?$/);return m?{guild:m[1],plugin:m[2]||null}:{};
}
function sidebar(guild,plugin){
  const g=guilds.find(x=>x.id===guild);$('sidebar').hidden=false;$('menuToggle').hidden=false;$('sidebarServer').textContent=g?.name||'';
  for(const a of $('sidebar').querySelectorAll('a')){a.href=`/dashboard/${guild}/${a.dataset.plugin}`;a.setAttribute('data-link','');a.hidden=a.hasAttribute('data-manager')&&!g?.manageable;if(a.dataset.plugin===plugin)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  const sel=$('serverSelect');sel.hidden=false;sel.replaceChildren(new Option('All servers',''),...guilds.map(x=>new Option(x.name,x.id)));sel.value=guild;
  document.body.classList.remove('nav-open');$('menuToggle').setAttribute('aria-expanded','false');
}
async function route(){
  NO.message('');$('installMessage').hidden=true;
  if(!NO.session){show('login');$('sidebar').hidden=true;return;}
  const {guild,plugin}=parse();
  if(!guild){$('sidebar').hidden=true;$('menuToggle').hidden=true;$('serverSelect').value='';return servers();}
  const g=guilds.find(x=>x.id===guild);if(!g){NO.message('This server is not in your Discord server list. Join it and sign in again.');return servers();}
  const name=plugin&&TITLES[plugin]?plugin:(g.manageable?'overview':'verification');
  if(name!==plugin)history.replaceState(null,'',`/dashboard/${guild}/${name}`);
  sidebar(guild,name);document.title=`${TITLES[name]} · ${g.name} · Number One`;
  try{
    if(name==='verification'){show('verification');await Verification.load(guild);}
    else{show('plugin');await renderPlugin(guild,name);}
  }catch(error){NO.message(error.message);}
  $('main').focus({preventScroll:true});
}
function servers(){
  show('servers');document.title='Your servers · Number One';const list=$('serverList');list.replaceChildren();$('noServers').hidden=guilds.length>0;
  for(const g of guilds){
    const icon=g.icon?el('img',{src:g.icon,alt:'',width:48,height:48,class:'server-icon'}):el('div',{class:'server-icon',text:g.name.slice(0,1).toUpperCase(),'aria-hidden':'true'});
    const badges=el('div',{class:'badges'},g.manageable?el('span',{class:'tag',text:'Manager'}):null,g.botPresent===true?el('span',{class:'tag ok',text:'Bot installed'}):g.botPresent===false?el('span',{class:'tag muted-tag',text:'Bot not installed'}):null);
    const actions=el('div',{class:'actions'});
    if(g.manageable&&g.botPresent===false&&g.inviteUrl)actions.append(el('a',{class:'button primary',href:g.inviteUrl,target:'_blank',rel:'noopener',text:'Add bot'}));
    actions.append(el('a',{class:'button'+(g.botPresent===false&&g.manageable?'':' primary'),href:`/dashboard/${g.id}`,'data-link':'',text:g.manageable?'Manage':'Verification'}));
    list.append(el('div',{class:'card server'},icon,el('div',{class:'server-info'},el('h2',{text:g.name}),badges),actions));
  }
}
function table(headers,rows,empty){
  if(!rows.length)return el('p',{class:'muted',text:empty});
  const t=el('table',{},el('thead',{},el('tr',{},...headers.map(h=>el('th',{scope:'col',text:h})))));const tb=el('tbody');
  for(const r of rows)tb.append(el('tr',{},...r.map(c=>c instanceof Node?el('td',{},c):el('td',{text:c??'—'}))));t.append(tb);return el('div',{class:'table-wrap'},t);
}
const ref=x=>x?(x.name?(x.name+' ('+x.id+')'):x.id):'Not set';
const commands=list=>list?.length?el('div',{class:'card'},el('h2',{text:'Slash commands'}),el('p',{class:'muted',text:'Make other changes in Discord with:'}),el('div',{class:'chips'},...list.map(c=>el('code',{text:c})))):null;
async function renderPlugin(guild,name){
  $('pluginTitle').textContent=TITLES[name];$('pluginLead').textContent=LEADS[name]||'';const body=$('pluginBody');body.replaceChildren(el('p',{class:'muted',text:'Loading…'}));
  const proofCell=list=>{if(!list?.length)return '—';const span=el('span',{});let n=0,l=0;list.forEach((p,k)=>{if(k)span.append(' · ');span.append(el('a',{href:p.logMessage||p.url,target:'_blank',rel:'noopener noreferrer',text:p.type==='image'?'Screenshot '+(++n):'Link '+(++l)}));});return span;};
  const base='/api/guilds/'+guild;$('pluginSwitch').hidden=true;
  if(name==='overview'){
    const o=await NO.api(base+'/overview');const s=o.stats;
    const stat=(label,value,link)=>el('a',{class:'card stat',href:`/dashboard/${guild}/${link}`,'data-link':''},el('span',{class:'label',text:label}),el('strong',{text:String(value)}));
    const pluginCards=el('div',{class:'grid'},...o.toggleable.map(p=>{const box=el('input',{type:'checkbox',role:'switch',id:'t-'+p,'aria-label':'Enable '+TITLES[p]});box.checked=o.plugins[p];box.onchange=NO.action(async()=>{const r=await NO.api(`${base}/plugins/${p}`,{enabled:box.checked},'PUT');box.checked=r.enabled;NO.message(`${TITLES[p]} ${r.enabled?'enabled':'disabled'}.`);});
      return el('div',{class:'card plugin-card'},el('div',{},el('h3',{},el('a',{href:`/dashboard/${guild}/${p}`,'data-link':'',text:TITLES[p]})),el('p',{class:'muted',text:LEADS[p]})),el('label',{class:'switch'},box,el('span',{'aria-hidden':'true'})));}));
    body.replaceChildren(...[
      o.botPresent===false?el('div',{class:'notice',text:'Number One is not in this server. Add it from the server list to use slash commands.'}):null,
      el('div',{class:'grid stats'},stat('Moderation cases',s.moderationCases,'moderation'),stat('Cases needing review',s.casesNeedingReview,'moderation'),stat('Open appeals',s.openAppeals,'moderation'),stat('Automod',s.automod?'On':'Off','automod'),stat('Saved embeds',s.embeds,'embeds'),stat('Upcoming events',s.upcomingEvents,'scheduler'),stat('Instagram sources',s.instagramSources,'instagram'),stat('Access grants',s.accessGrants,'access'),stat('Verification',o.verification?.enabled?'Open':o.verification?.configured?'Paused':'Not set up','verification')),
      el('h2',{text:'Plugins'}),el('p',{class:'muted',text:'Disabled plugins stop responding to their slash commands in this server.'}),pluginCards,
      el('p',{class:'muted',text:`Timezone: ${o.timezone}${s.deliveryProblems?` · ${s.deliveryProblems} recent delivery problem(s); run /settings status in Discord.`:''}`})].filter(Boolean));
    return;
  }
  const d=await NO.api(`${base}/plugins/${name}`);
  if(d.toggleable){$('pluginSwitch').hidden=false;const box=$('pluginEnabled');box.checked=d.enabled;box.onchange=NO.action(async()=>{const r=await NO.api(`${base}/plugins/${name}`,{enabled:box.checked},'PUT');box.checked=r.enabled;NO.message(`${TITLES[name]} ${r.enabled?'enabled':'disabled'}.`);});}
  const parts=[];
  if(name==='moderation'){
    const c=d.config,f=el('form',{class:'card'});
    const pick=(id,list,value,blank)=>{const s=el('select',{id});s.append(new Option(blank,''));for(const x of list)s.append(new Option(x.name,x.id));if(value&&!list.some(x=>x.id===value.id))s.append(new Option(value.id,value.id));s.value=value?.id||'';return s;};
    const lab=(t,n)=>el('label',{},t,n);
    const dm=el('input',{type:'checkbox',id:'modDm'}),dmm=el('input',{type:'checkbox',id:'modDmMembers'});dm.checked=c.dmAppeals;dmm.checked=c.dmMembers;
    f.append(el('h2',{text:'Settings'}),lab('Moderator role',pick('modRole',d.roles,c.modRole,'Not set')),lab('Protected role (members with it cannot be moderated)',pick('modPrivacy',d.roles,c.privacyRole,'Not set')),lab('Staff log channel (hidden from @everyone)',pick('modLog',d.channels,c.logChannel,'Not set')),
      lab('Case retention in days (30–3650)',Object.assign(el('input',{type:'number',id:'modRetention',min:30,max:3650,required:''}),{value:c.retentionDays})),
      el('h3',{text:'Member DMs'}),el('label',{class:'check'},dmm,'DM members about moderation actions by default (the dm option on each command overrides this)'),el('h3',{text:'Appeals'}),el('label',{class:'check'},dm,'Include an Appeal button in ban, kick, timeout and warning DMs'),lab('Appeal contact for banned or kicked members (link or email)',Object.assign(el('input',{id:'modContact',maxlength:200}),{value:c.appealContact||''})),
      el('p',{class:'muted',text:`Locked channels: ${d.locks}. Only the server owner can save changes. Each change is recorded as a moderation case.`}),el('button',{class:'primary',text:'Save'}));
    f.onsubmit=NO.action(async()=>{await NO.api(`${base}/plugins/moderation`,{modRole:$('modRole').value||null,privacyRole:$('modPrivacy').value||null,logChannel:$('modLog').value||null,retentionDays:Number($('modRetention').value),dmAppeals:dm.checked,dmMembers:dmm.checked,appealContact:$('modContact').value.trim()||null},'PUT');NO.message('Moderation settings saved.');});
    parts.push(f);
    parts.push(el('div',{class:'card'},el('h2',{text:'Recent cases'}),table(['Case','Action','Target','Moderator','State','Created','Proof'],d.recentCases.map(c=>[c.number?'#'+c.number:c.id.slice(0,12),c.action,c.target,c.actor,c.state,fmt(c.created),proofCell(c.proof)]),'No cases yet.')));
  }
  if(name==='automod'){
    const c=d.config;const f=el('form',{class:'card'});
    const check=(id,label,val)=>{const i=el('input',{type:'checkbox',id});i.checked=val;return el('label',{class:'check'},i,label);};
    const num=(id,label,val,min,max)=>[el('label',{for:id,text:label}),Object.assign(el('input',{type:'number',id,min,max,required:''}),{value:val})];
    f.append(el('h2',{text:'Filters'}),check('amOn','Enable automod',c.automod),!d.messageContentAvailable?el('p',{class:'muted',text:'Automod cannot be turned on until the bot operator enables Message Content Intent.'}):null,check('amInv','Delete server invite links',c.blockInvites),...num('amMention','Maximum mentions per message (1–50)',c.mentionLimit,1,50),...num('amSpam','Messages per member per 10 seconds (3–30)',c.spamLimit,3,30),el('label',{for:'amWords',text:'Blocked words (comma separated)'}),Object.assign(el('textarea',{id:'amWords',maxlength:1000,rows:3}),{value:c.blockedWords.join(', ')}),el('p',{class:'muted',text:'Only the server owner can save changes. Each change is recorded as a moderation case.'}),el('button',{class:'primary',text:'Save'}));
    f.onsubmit=NO.action(async()=>{await NO.api(`${base}/plugins/automod`,{automod:$('amOn').checked,blockInvites:$('amInv').checked,mentionLimit:Number($('amMention').value),spamLimit:Number($('amSpam').value),blockedWords:$('amWords').value},'PUT');NO.message('Automod settings saved.');});
    parts.push(f);
  }
  if(name==='embeds')parts.push(el('div',{class:'card'},el('h2',{text:'Saved embeds'}),table(['Name','Title','Updated'],d.items.map(e=>[e.name,e.title||'—',fmt(e.updatedAt)]),'No saved embeds. Create one with /embed create.')));
  if(name==='scheduler')parts.push(el('div',{class:'card'},el('h2',{text:'Upcoming'}),el('p',{class:'muted',text:'Server timezone: '+d.timezone}),table(['Title','Starts','Type','Repeats','Channel','Status'],d.items.map(e=>[e.title,fmt(e.start),e.kind,e.repeat,ref(e.channel),e.needsAttention?'Needs attention':'OK']),'Nothing scheduled. Add an event with /schedule add.')));
  if(name==='instagram')parts.push(el('div',{class:'card'},el('h2',{text:'Sources'}),table(['Name','Channel','Delivery','Waiting','Status'],d.items.map(f=>[f.name,ref(f.channel),f.schedule,String(f.waiting),f.needsAttention?'Needs attention':f.paused?'Paused':'Active']),'No sources. Add one with /instagram setup.')));
  if(name==='reactionroles')parts.push(...reactionRoles(d,base,guild));
  if(name==='access')parts.push(el('div',{class:'card'},el('h2',{text:'Granted members'}),el('p',{class:'muted',text:'Administrators and members with Manage Server always have access. Only the server owner can grant or revoke access, using /access.'}),table(['User ID','Granted by','Granted'],d.items.map(a=>[a.user,a.grantedBy,fmt(a.grantedAt)]),'No grants.')));
  if(name==='settings'){
    const f=el('form',{class:'card'},el('h2',{text:'Timezone'}),el('label',{for:'tz',text:'Timezone for new events (IANA name)'}),Object.assign(el('input',{id:'tz',required:'',maxlength:64,list:'tzList',autocomplete:'off'}),{value:d.timezone}),el('datalist',{id:'tzList'},...(Intl.supportedValuesOf?Intl.supportedValuesOf('timeZone'):[]).map(z=>el('option',{value:z}))),el('button',{class:'primary',text:'Save'}));
    f.onsubmit=NO.action(async()=>{await NO.api(`${base}/plugins/settings`,{timezone:$('tz').value.trim()},'PUT');NO.message('Timezone saved. Existing events keep their timezone.');});
    parts.push(f,el('div',{class:'card'},el('h2',{text:'Staff log channel'}),el('p',{text:ref(d.logChannel)})));
  }
  parts.push(commands(d.commands));body.replaceChildren(...parts.filter(Boolean));
}
function reactionRoles(d,base,guild){
  const opt=(list,value,blank)=>{const s=el('select');if(blank)s.append(new Option(blank,''));for(const x of list)s.append(new Option(x.name+(x.assignable===false?' (above bot role)':''),x.id));s.value=value||'';return s;};
  const list=el('div',{class:'card'},el('h2',{text:'Reaction-role messages'}),table(['Title','Channel','Roles','Mode','Status'],d.items.map(x=>[x.title,ref(x.channel),x.entries.map(e=>e.emoji+' '+(e.role.name||e.role.id)).join(', ')||'None',(x.mode==='unique'?'Unique':'Normal')+(x.maxRoles?` · max ${x.maxRoles}`:'')+(x.duration?` · ${x.duration} min`:'')+(x.removeOnUnreact?'':' · add-only'),x.broken?'Needs attention: '+x.broken:'OK']),'No reaction-role messages yet.'));
  const actions=el('div',{class:'actions'});
  for(const x of d.items){
    const editBtn=el('button',{type:'button',text:'Edit '+x.title});editBtn.onclick=()=>fill(x);
    const del=el('button',{type:'button',class:'danger',text:'Delete '+x.title});del.onclick=NO.action(async()=>{if(!confirm('Delete this reaction-role setup? Members keep their roles.'))return;await NO.api(`${base}/plugins/reactionroles`,{delete:x.id},'PUT');NO.message('Reaction roles deleted.');await renderPlugin(guild,'reactionroles');});
    actions.append(editBtn,del);
  }
  if(d.items.length)list.append(actions);
  const f=el('form',{class:'card'}),heading=el('h2',{text:'Create reaction roles'});let editing=null;
  const channel=opt(d.channels,'','Choose a channel'),link=el('input',{maxlength:200,placeholder:'Optional: existing message link or ID'}),title=el('input',{maxlength:256,placeholder:'Reaction roles'}),desc=el('textarea',{maxlength:2000,rows:2});
  const mode=el('select');mode.append(new Option('Normal: pick any roles','normal'),new Option('Unique: pick one role','unique'));
  const max=Object.assign(el('input',{type:'number',min:0,max:20}),{value:0}),dur=el('input',{maxlength:10,placeholder:'off, 30m, 12h, 7d'}),unreact=el('input',{type:'checkbox'});unreact.checked=true;
  const required=opt(d.roles,'','No required role'),rows=el('div',{class:'rows'}),preview=el('div',{class:'card preview'});
  const row=(emoji='',role='')=>{const r=el('div',{class:'row'}),e=el('input',{maxlength:64,placeholder:'Emoji, e.g. 🎮 or <:name:id>','aria-label':'Emoji'}),s=opt(d.roles,role,'Choose a role'),x=el('button',{type:'button',text:'Remove'});e.value=emoji;x.onclick=()=>{r.remove();draw();};e.oninput=s.onchange=draw;r.append(e,s,x);rows.append(r);};
  const entries=()=>[...rows.children].map(r=>({emoji:r.children[0].value.trim(),role:r.children[1].value})).filter(e=>e.emoji||e.role);
  function draw(){const name=id=>d.roles.find(r=>r.id===id)?.name||'role';preview.replaceChildren(el('h3',{text:'Preview: '+(title.value||'Reaction roles')}),desc.value?el('p',{text:desc.value}):null,...entries().map(e=>el('p',{text:`${e.emoji} – @${name(e.role)}`})));}
  for(const i of [title,desc])i.oninput=draw;
  const add=el('button',{type:'button',text:'Add emoji and role'});add.onclick=()=>{if(rows.children.length<d.limits.entries)row();};
  const label=(t,n)=>el('label',{},t,n);
  function fill(x){editing=x.id;heading.textContent='Edit '+x.title;channel.value=x.channel?.id||'';channel.disabled=true;link.disabled=true;title.value=x.title;desc.value=x.description||'';mode.value=x.mode;max.value=x.maxRoles;dur.value=x.duration?x.duration+'m':'off';unreact.checked=x.removeOnUnreact;required.value=x.requiredRole?.id||'';rows.replaceChildren();for(const e of x.entries)row(e.emoji,e.role.id);draw();f.scrollIntoView();}
  row();
  f.append(heading,label('Channel',channel),label('Existing message (optional)',link),label('Title',title),label('Description',desc),label('Mode',mode),label('Max roles per member (0 = no limit)',max),label('Temporary role duration',dur),el('label',{class:'check'},unreact,'Remove the role when the reaction is removed'),label('Required role',required),el('h3',{text:'Emoji and roles'}),rows,add,preview,el('p',{class:'muted',text:'The bot needs Manage Roles, and its role must be above every role listed here.'}),el('button',{class:'primary',text:'Save'}));
  f.onsubmit=NO.action(async()=>{
    const o={title:title.value.trim()||null,description:desc.value.trim()||null,mode:mode.value,maxRoles:Number(max.value)||0,duration:dur.value.trim()||'off',removeOnUnreact:unreact.checked,requiredRole:required.value||null,entries:entries()};
    if(editing)await NO.api(`${base}/plugins/reactionroles`,{update:{id:editing,...o}},'PUT');
    else await NO.api(`${base}/plugins/reactionroles`,{create:{channel:channel.value,message:link.value.trim()||null,...o}},'PUT');
    NO.message('Reaction roles saved.');await renderPlugin(guild,'reactionroles');
  });
  draw();
  return [!d.botReady?el('div',{class:'notice',text:'The bot must be online in this server to change reaction roles.'}):null,list,f];
}
$('serverSelect').onchange=()=>navigate($('serverSelect').value?'/dashboard/'+$('serverSelect').value:'/dashboard');
$('menuToggle').onclick=()=>{const open=document.body.classList.toggle('nav-open');$('menuToggle').setAttribute('aria-expanded',String(open));};
$('userButton').onclick=()=>{const open=$('userDropdown').hidden;$('userDropdown').hidden=!open;$('userButton').setAttribute('aria-expanded',String(open));};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('userDropdown').hidden=true;$('userButton').setAttribute('aria-expanded','false');}});
$('logout').onclick=NO.action(async()=>{await NO.api('/api/logout',{});location.href='/dashboard';});
$('demoLogin').onclick=NO.action(async()=>{await NO.api('/api/demo-login',{identity:$('identity').value});await boot();NO.message('Local demo. Discord actions are simulated.');});
async function boot(){
  NO.session=await NO.api('/api/session');const list=await NO.api('/api/guilds');guilds=list.guilds;
  $('userMenu').hidden=false;$('userName').textContent=NO.session.name||NO.session.id;if(NO.session.avatar){$('avatar').src=NO.session.avatar;$('avatar').hidden=false;}
  if(list.inviteUrl)$('addBot').href=list.inviteUrl;else $('addBot').hidden=true;
  await route();
}
NO.action(async()=>{
  config=await NO.api('/api/config');NO.message('');
  if(config.mode==='setup'){show('login');$('mode').textContent='Sign-in is temporarily unavailable. Please try again later.';return;}
  const pending=parse();const g=pending.guild;
  $(config.mode==='demo'?'demo':'discord').hidden=false;$('discord').href='/auth/login'+(g?'?guild='+encodeURIComponent(g):'');if(config.mode==='demo')$('mode').textContent='Local demo only.';
  try{await boot();}catch(error){NO.session=null;show('login');if(error.status!==401)NO.message(error.message);}
})();
