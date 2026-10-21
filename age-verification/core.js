import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class Fault extends Error { constructor(status, message) { super(message); this.status = status; } }
export function assert(ok, status, message) { if (!ok) throw new Fault(status, message); }
const PORTRAIT = '/portrait.svg';
// No caller-supplied DOB, image, OCR, crop, URL or provider attestation is accepted.
// These are invented test people, not redactions of uploaded documents.
export function processSynthetic(fixture) {
  const fixtures = { adult: '1995-04-12', minor: '2015-09-23' };
  assert(Object.hasOwn(fixtures, fixture), 422, 'Extraction/redaction unverified. No review evidence released.');
  return { dob: fixtures[fixture], portrait: PORTRAIT, synthetic: true, verified: true };
}
export function adult(dob, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const d = new Date(dob + 'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== dob || d > now) return false;
  return now.getUTCFullYear() - d.getUTCFullYear() - (now.toISOString().slice(5, 10) < dob.slice(5) ? 1 : 0) >= 18;
}
export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, member TEXT UNIQUE, status TEXT, dob TEXT, portrait TEXT, evidenceUntil INTEGER, claimant TEXT, claimUntil INTEGER, roleState TEXT, dmState TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, caseId TEXT, actor TEXT, action TEXT, at INTEGER);
      CREATE TABLE IF NOT EXISTS privacy(id TEXT PRIMARY KEY, member TEXT, kind TEXT, state TEXT, created INTEGER);`);
  }
  audit(id, actor, action) { this.db.prepare('INSERT INTO audit(caseId,actor,action,at) VALUES(?,?,?,?)').run(id, actor, action, Date.now()); }
  get(id) { return this.db.prepare('SELECT * FROM cases WHERE id=?').get(id); }
  mine(member) { return this.db.prepare('SELECT * FROM cases WHERE member=?').get(member); }
  purge() {
    this.db.prepare('UPDATE cases SET dob=NULL,portrait=NULL WHERE evidenceUntil < ?').run(Date.now());
    this.db.prepare('DELETE FROM audit WHERE at < ?').run(Date.now() - 30 * 86400000);
    this.db.prepare("DELETE FROM privacy WHERE state='completed' AND created < ?").run(Date.now() - 30 * 86400000);
  }
  submit(member, fixture, consent) {
    assert(consent === true, 400, 'Confirm the synthetic-data privacy notice.');
    const evidence = processSynthetic(fixture);
    assert(!this.mine(member), 409, 'You already have a case. Request deletion before submitting again.');
    const id = randomUUID();
    this.db.prepare("INSERT INTO cases VALUES(?,?,'pending',?,?,?,NULL,0,'not_requested','not_requested',?)").run(id, member, evidence.dob, evidence.portrait, Date.now() + 86400000, Date.now());
    this.audit(id, member, 'synthetic_submitted'); return id;
  }
  list() { this.purge(); return this.db.prepare('SELECT id,status,claimant,claimUntil,roleState,dmState,created FROM cases ORDER BY created').all(); }
  claim(id, actor) {
    const r = this.db.prepare("UPDATE cases SET claimant=?,claimUntil=? WHERE id=? AND status='pending' AND (claimant IS NULL OR claimant=? OR claimUntil<=?)").run(actor, Date.now() + 600000, id, actor, Date.now());
    assert(r.changes === 1, 409, 'Case unavailable or claimed by another reviewer.'); this.audit(id, actor, 'claimed');
  }
  evidence(id, actor) {
    this.purge(); const c = this.get(id);
    assert(c && c.status === 'pending' && c.claimant === actor && c.claimUntil > Date.now(), 409, 'Claim this pending case first.');
    assert(c.dob && c.portrait === PORTRAIT, 422, 'Evidence expired or unverified. Review is blocked.');
    this.audit(id, actor, 'evidence_viewed');
    return { dob: c.dob, portrait: c.portrait, synthetic: true };
  }
  decide(id, actor, decision) {
    assert(['approved', 'denied'].includes(decision), 400, 'Choose approve or deny.');
    const e = this.evidence(id, actor);
    assert(decision !== 'approved' || adult(e.dob), 422, 'Under 18: approval blocked. An authorized reviewer must manually deny.');
    this.db.prepare("UPDATE cases SET status=?,dob=NULL,portrait=NULL,roleState=?,dmState='pending',claimant=NULL,claimUntil=0 WHERE id=?").run(decision, decision === 'approved' ? 'pending' : 'not_requested', id);
    this.audit(id, actor, decision);
  }
  delivery(id, column, value) {
    assert(['roleState','dmState'].includes(column), 500, 'Invalid delivery field.');
    this.db.prepare(`UPDATE cases SET ${column}=? WHERE id=?`).run(value, id);
    this.audit(id, 'system', column + ':' + value);
  }
  request(member, kind) {
    assert(['export', 'delete'].includes(kind), 400, 'Unknown privacy request.');
    const existing = this.db.prepare("SELECT id FROM privacy WHERE member=? AND kind=? AND state='open'").get(member, kind);
    if (existing) return existing.id;
    const id = randomUUID(); this.db.prepare("INSERT INTO privacy VALUES(?,?,?,'open',?)").run(id, member, kind, Date.now());
    this.audit(null, member, 'privacy_' + kind); return id;
  }
  export(member) {
    this.purge(); const c = this.mine(member);
    const result = { case: c ? { id:c.id,status:c.status,created:c.created,roleState:c.roleState,dmState:c.dmState } : null,
      requests: this.db.prepare('SELECT id,kind,state,created FROM privacy WHERE member=?').all(member),
      audit: this.db.prepare('SELECT action,at FROM audit WHERE actor=? OR caseId=?').all(member,c?.id ?? '') };
    this.db.prepare("UPDATE privacy SET state='completed' WHERE member=? AND kind='export'").run(member); return result;
  }
  erase(member) {
    const c = this.mine(member);
    this.db.prepare('DELETE FROM audit WHERE actor=? OR caseId=?').run(member, c?.id ?? '');
    this.db.prepare('DELETE FROM cases WHERE member=?').run(member);
    this.db.prepare('DELETE FROM privacy WHERE member=?').run(member);
    // Anonymous event only: no member ID, case ID, DOB, reviewer or document details.
    this.audit(null, null, 'privacy_deletion_completed');
  }
}
