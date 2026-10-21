import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
export class Fault extends Error {constructor(status,message){super(message);this.status=status;}}
export function assert(ok,status,message){if(!ok)throw new Fault(status,message);}
export const DEMO_GUILDS=[{id:'111111111111111111',name:'Demo community'},{id:'222222222222222222',name:'Second demo community'}];
const PORTRAIT='/portrait.svg';
export function processSynthetic(fixture){
  const fixtures={adult:'1995-04-12',minor:'2015-09-23'};
  assert(typeof fixture==='string' && Object.hasOwn(fixtures,fixture),422,'Extraction/redaction unverified. No review evidence released.');
  return {dob:fixtures[fixture],portrait:PORTRAIT,synthetic:true,verified:true};
}
export function adult(dob,now=new Date()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dob))return false;
  const d=new Date(dob+'T00:00:00Z');
  if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==dob||d>now)return false;
  return now.getUTCFullYear()-d.getUTCFullYear()-(now.toISOString().slice(5,10)<dob.slice(5)?1:0)>=18;
}
// Every tenant operation includes a bound guild. Legacy unscoped tables are never exposed.
export class Store {
  constructor(path=':memory:',guild=null,db=null){
    this.guild=guild;this.db=db || new DatabaseSync(path);if(db)return;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS age_settings(guild TEXT PRIMARY KEY,reviewerRole TEXT,verifiedRole TEXT,enabled INTEGER,updatedBy TEXT,updated INTEGER);
      CREATE TABLE IF NOT EXISTS age_cases(id TEXT PRIMARY KEY,guild TEXT NOT NULL,member TEXT,status TEXT,dob TEXT,portrait TEXT,evidenceUntil INTEGER,claimant TEXT,claimUntil INTEGER,roleState TEXT,dmState TEXT,roleId TEXT,created INTEGER,UNIQUE(guild,member));
      CREATE TABLE IF NOT EXISTS age_audit(id INTEGER PRIMARY KEY,guild TEXT NOT NULL,caseId TEXT,actor TEXT,action TEXT,at INTEGER);
      CREATE TABLE IF NOT EXISTS age_privacy(id TEXT PRIMARY KEY,guild TEXT NOT NULL,member TEXT,kind TEXT,state TEXT,created INTEGER);
      CREATE INDEX IF NOT EXISTS age_audit_guild ON age_audit(guild,at);
      CREATE INDEX IF NOT EXISTS age_cases_guild ON age_cases(guild,created);`);
    this.recover();
  }
  forGuild(guild){assert(typeof guild==='string'&&guild.length>0,500,'A server scope is required.');return new Store(null,guild,this.db);}
  scope(){assert(this.guild,500,'A server scope is required.');return this.guild;}
  recover(){this.db.exec("UPDATE age_cases SET roleState='uncertain' WHERE roleState='pending'; UPDATE age_cases SET dmState='uncertain' WHERE dmState='pending';");}
  settings(){return this.db.prepare('SELECT reviewerRole,verifiedRole,enabled FROM age_settings WHERE guild=?').get(this.scope()) || null;}
  configure(actor,reviewerRole,verifiedRole,enabled){
    this.db.prepare('INSERT INTO age_settings VALUES(?,?,?,?,?,?) ON CONFLICT(guild) DO UPDATE SET reviewerRole=excluded.reviewerRole,verifiedRole=excluded.verifiedRole,enabled=excluded.enabled,updatedBy=excluded.updatedBy,updated=excluded.updated').run(this.scope(),reviewerRole,verifiedRole,Number(enabled),actor,Date.now());
    this.audit(null,actor,enabled?'settings_enabled':'settings_paused');
  }
  audit(id,actor,action){this.db.prepare('INSERT INTO age_audit(guild,caseId,actor,action,at) VALUES(?,?,?,?,?)').run(this.scope(),id,actor,action,Date.now());}
  get(id){return this.db.prepare('SELECT * FROM age_cases WHERE guild=? AND id=?').get(this.scope(),id);}
  mine(member){return this.db.prepare('SELECT * FROM age_cases WHERE guild=? AND member=?').get(this.scope(),member);}
  purge(){
    this.db.prepare('UPDATE age_cases SET dob=NULL,portrait=NULL WHERE evidenceUntil<?').run(Date.now());
    this.db.prepare('DELETE FROM age_audit WHERE at<?').run(Date.now()-30*86400000);
    this.db.prepare("DELETE FROM age_privacy WHERE state='completed' AND created<?").run(Date.now()-30*86400000);
    // Old synthetic evidence has no trustworthy tenant attribution. Clear evidence and retain
    // operational records for offline maintenance; never assign legacy cases to another guild.
    if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'").get())this.db.exec('UPDATE cases SET dob=NULL,portrait=NULL');
    if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit'").get())this.db.prepare('DELETE FROM audit WHERE at<?').run(Date.now()-30*86400000);
  }
  submit(member,fixture,consent){
    const settings=this.settings();assert(settings?.enabled,409,'This server has not opened verification. Ask its owner or a server manager to finish setup on this website.');
    assert(consent===true,400,'Confirm the synthetic-data privacy notice.');const evidence=processSynthetic(fixture);
    assert(!this.mine(member),409,'You already have a case in this server. Request deletion before submitting again.');
    const id=randomUUID();this.db.prepare("INSERT INTO age_cases VALUES(?,?,?,'pending',?,?,?,NULL,0,'not_requested','not_requested',?,?)").run(id,this.scope(),member,evidence.dob,evidence.portrait,Date.now()+86400000,settings.verifiedRole,Date.now());
    this.audit(id,member,'synthetic_submitted');return id;
  }
  list(){this.purge();return this.db.prepare('SELECT id,status,claimant,claimUntil,roleState,dmState,created FROM age_cases WHERE guild=? ORDER BY created').all(this.scope());}
  claim(id,actor){
    const r=this.db.prepare("UPDATE age_cases SET claimant=?,claimUntil=? WHERE guild=? AND id=? AND status='pending' AND member<>? AND (claimant IS NULL OR claimant=? OR claimUntil<=?)").run(actor,Date.now()+600000,this.scope(),id,actor,actor,Date.now());
    assert(r.changes===1,409,'Case unavailable, your own submission, or claimed by another reviewer.');this.audit(id,actor,'claimed');
  }
  evidence(id,actor){
    this.purge();const c=this.get(id);assert(c&&c.status==='pending'&&c.member!==actor&&c.claimant===actor&&c.claimUntil>Date.now(),409,'Claim this pending case first.');
    assert(c.dob&&c.portrait===PORTRAIT,422,'Evidence expired or unverified. Review is blocked.');this.audit(id,actor,'evidence_viewed');return {dob:c.dob,portrait:c.portrait,synthetic:true};
  }
  decide(id,actor,decision){
    assert(['approved','denied'].includes(decision),400,'Choose approve or deny.');const e=this.evidence(id,actor);
    assert(decision!=='approved'||adult(e.dob),422,'Under 18: approval blocked. An authorized reviewer must manually deny.');
    this.db.prepare("UPDATE age_cases SET status=?,dob=NULL,portrait=NULL,roleState=?,dmState='pending',claimant=NULL,claimUntil=0 WHERE guild=? AND id=?").run(decision,decision==='approved'?'pending':'not_requested',this.scope(),id);this.audit(id,actor,decision);
  }
  delivery(id,column,value){
    assert(['roleState','dmState'].includes(column),500,'Invalid delivery field.');assert(this.get(id),404,'Case not found in this server.');
    this.db.prepare(`UPDATE age_cases SET ${column}=? WHERE guild=? AND id=?`).run(value,this.scope(),id);this.audit(id,'system',column+':'+value);
  }
  request(member,kind){
    assert(['export','delete'].includes(kind),400,'Unknown privacy request.');const existing=this.db.prepare("SELECT id FROM age_privacy WHERE guild=? AND member=? AND kind=? AND state='open'").get(this.scope(),member,kind);if(existing)return existing.id;
    const id=randomUUID();this.db.prepare("INSERT INTO age_privacy VALUES(?,?,?,?,'open',?)").run(id,this.scope(),member,kind,Date.now());this.audit(null,member,'privacy_'+kind);return id;
  }
  requests(){return this.db.prepare('SELECT id,member,kind,state,created FROM age_privacy WHERE guild=? ORDER BY created DESC').all(this.scope());}
  deletion(id){return this.db.prepare("SELECT * FROM age_privacy WHERE guild=? AND id=? AND kind='delete' AND state='open'").get(this.scope(),id);}
  audits(){this.purge();return this.db.prepare('SELECT caseId,actor,action,at FROM age_audit WHERE guild=? ORDER BY id DESC LIMIT 100').all(this.scope());}
  export(member){
    this.purge();const c=this.mine(member);
    this.db.prepare("UPDATE age_privacy SET state='completed' WHERE guild=? AND member=? AND kind='export'").run(this.scope(),member);
    return {guild:this.scope(),case:c?{id:c.id,status:c.status,created:c.created,roleState:c.roleState,dmState:c.dmState}:null,
      requests:this.db.prepare('SELECT id,kind,state,created FROM age_privacy WHERE guild=? AND member=?').all(this.scope(),member),
      audit:this.db.prepare('SELECT action,at FROM age_audit WHERE guild=? AND (actor=? OR caseId=?)').all(this.scope(),member,c?.id ?? '')};
  }
  erase(member){
    const c=this.mine(member);this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM age_audit WHERE guild=? AND (actor=? OR caseId=?)').run(this.scope(),member,c?.id ?? '');
      this.db.prepare('DELETE FROM age_cases WHERE guild=? AND member=?').run(this.scope(),member);
      this.db.prepare('DELETE FROM age_privacy WHERE guild=? AND member=?').run(this.scope(),member);
      this.audit(null,null,'privacy_deletion_completed');this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
