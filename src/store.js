import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export class Store {
  transaction(work) {
    // Savepoints compose with other synchronous store operations and nested transactions.
    this.transactionSequence=(this.transactionSequence||0)+1;
    const name='number_one_'+this.transactionSequence;
    this.db.exec(`SAVEPOINT ${name}`);
    try {const result=work();this.db.exec(`RELEASE ${name}`);return result;}
    catch(error){this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);throw error;}
  }
  constructor(path = new URL('../data/rose.sqlite', import.meta.url)) {
    if (path instanceof URL) mkdirSync(new URL('.', path), {recursive: true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (guild TEXT, kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(guild,kind,id));
      CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, state TEXT NOT NULL, detail TEXT, created INTEGER NOT NULL);`);
  }
  list(guild, kind) { return this.db.prepare('SELECT value FROM records WHERE guild=? AND kind=? ORDER BY rowid').all(guild, kind).map(r => JSON.parse(r.value)); }
  all(kind) {return this.db.prepare('SELECT guild,value FROM records WHERE kind=?').all(kind).map(r => ({guild: r.guild, ...JSON.parse(r.value)}));}
  get(guild, kind, id) {const r = this.db.prepare('SELECT value FROM records WHERE guild=? AND kind=? AND id=?').get(guild, kind, id); return r && JSON.parse(r.value);}
  put(guild, kind, value) {value.id ||= randomUUID().slice(0, 8); this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(guild,kind,id) DO UPDATE SET value=excluded.value').run(guild, kind, value.id, JSON.stringify(value)); return value;}
  remove(guild, kind, id) {return this.db.prepare('DELETE FROM records WHERE guild=? AND kind=? AND id=?').run(guild, kind, id).changes;}
  claim(key) {return this.db.prepare("INSERT OR IGNORE INTO deliveries VALUES(?,'sending',NULL,?)").run(key, Date.now()).changes === 1;}
  delivered(key, state, detail = '') {this.db.prepare('UPDATE deliveries SET state=?,detail=? WHERE key=?').run(state, String(detail).slice(0, 300), key);}
  delivery(key) {return this.db.prepare('SELECT state FROM deliveries WHERE key=?').get(key);}
  problems(guild) {
    if(guild)return this.db.prepare("SELECT key,state,created FROM deliveries WHERE state!='sent' AND (key LIKE 'event:'||?||':%' OR key LIKE 'digest:'||?||':%' OR key LIKE 'feed:'||?||':%') ORDER BY created DESC LIMIT 10").all(guild,guild,guild);
    return this.db.prepare("SELECT key,state,created FROM deliveries WHERE state!='sent' ORDER BY created DESC LIMIT 10").all();
  }
  close() {this.db.close();}
}
