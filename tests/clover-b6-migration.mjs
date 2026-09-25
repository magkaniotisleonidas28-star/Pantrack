import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
for(const entry of entries.filter(entry=>entry.idx<13))db.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
db.prepare('INSERT INTO companies VALUES (?,?,?)').run('a','Fixture café','before');
db.prepare('INSERT INTO companies VALUES (?,?,?)').run('b','Other café','before');
db.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)').run('a','merchant','sandbox','fictional-encrypted-value','before',null);
db.exec(readFileSync(`drizzle/${entries.find(entry=>entry.idx===13).tag}.sql`,'utf8'));
assert.equal(db.prepare('SELECT secret FROM clover_connections WHERE company_id=?').get('a').secret,'fictional-encrypted-value');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clover_sync_state').get().n,0,'Migration invents no sync checkpoint.');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clover_item_mappings').get().n,0,'Old CSV mappings are not silently trusted for native sales.');
assert.throws(()=>db.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)').run('b','merchant','sandbox','fixture','after',null),/UNIQUE/,'One merchant cannot belong to two companies.');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
db.close();console.log('PASS: B6 additive migration preserves a connection, invents no native mappings or checkpoints, and enforces one company per merchant.');
