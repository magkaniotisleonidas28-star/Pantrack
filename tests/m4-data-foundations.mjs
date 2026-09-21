import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
assert.ok(journal.entries.length>=11,'B3 compatibility harness expects generated migration 0010 or later.');
assert.match(journal.entries[10].tag,/^0010_/,'B3 must use the generated 0010 tag.');
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
for(const entry of journal.entries.slice(0,10))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));

const company=sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)');
company.run('company-a','A','2026-01-01T00:00:00.000Z');
company.run('company-b','B','2026-01-01T00:00:00.000Z');
sql.prepare('INSERT INTO sales_imports(company_id,reference,data,created) VALUES (?,?,?,?)').run('company-a','same-reference','{"items":[{"recipeId":"latte","quantity":2}]}','2026-01-02T00:00:00.000Z');
sql.prepare('INSERT INTO sales_imports(company_id,reference,data,created) VALUES (?,?,?,?)').run('company-b','same-reference','{"items":[{"recipeId":"tea","quantity":3}]}','2026-01-02T00:00:00.000Z');
sql.prepare('INSERT INTO register_mappings(company_id,external_key,data) VALUES (?,?,?)').run('company-a','provider\u001flocation\u001fitem','{"recipeId":"latte"}');

const legacyTables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const before=new Map(legacyTables.map(table=>[table,sql.prepare(`SELECT * FROM '${table}'`).all()]));
sql.exec(readFileSync(`drizzle/${journal.entries[10].tag}.sql`,'utf8'));
for(const table of legacyTables)assert.deepEqual(sql.prepare(`SELECT * FROM '${table}'`).all(),before.get(table),`${table} changed during additive B3 migration.`);

const newTables=[
 'sales_events','sales_event_fragments','sales_event_states','sales_event_transitions',
 'sales_event_attempts','sales_event_attempt_results','sales_event_conflicts',
 'sales_event_resolutions','sales_event_conflict_resolutions','sales_event_audits','sales_event_corrections',
];
for(const table of newTables)assert.equal(sql.prepare(`SELECT count(*) AS count FROM '${table}'`).get().count,0,`${table} must not invent events.`);

const indexes=new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row=>row.name));
for(const name of ['sales_event_identity','sales_event_lineage_revision','sales_event_application_key','sales_event_claimable','sales_event_one_processing_lineage','sales_event_transition_history','sales_event_fragment_expiry'])assert.ok(indexes.has(name),`Missing ${name}.`);
const triggers=sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'sales_event_%' ORDER BY name").all();
assert.deepEqual(triggers.map(trigger=>trigger.name),['sales_event_state_received','sales_event_state_transitioned']);
assert.ok(triggers.every(trigger=>trigger.sql.includes('sales_event_transitions')),'Every state trigger must retain transition history.');

const event=sql.prepare(`INSERT INTO sales_events(
 company_id,event_key,lineage_key,application_key,provider,environment,merchant_id,
 external_event_id,external_order_id,revision,occurred_at,received_at,source_payload_sha256,normalized_json
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const state=sql.prepare(`INSERT INTO sales_event_states(
 company_id,event_key,lineage_key,revision,state,lease_attempt_id,lease_expires_at,last_reason,linked_event_key,transition_actor,updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
for(const companyId of ['company-a','company-b']){
 event.run(companyId,'shared-key','lineage','application','pantrack','internal',companyId,'event','order',1,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z','hash','{}');
 state.run(companyId,'shared-key','lineage',1,'received',null,null,null,null,'fixture','2026-01-02T00:00:00.000Z');
}
event.run('company-a','revision-2','lineage','application-2','pantrack','internal','company-a','event-2','order',2,'2026-01-01T01:00:00.000Z','2026-01-02T01:00:00.000Z','hash-2','{}');
state.run('company-a','revision-2','lineage',2,'received',null,null,null,null,'fixture','2026-01-02T01:00:00.000Z');
assert.equal(sql.prepare("SELECT state FROM sales_event_states WHERE company_id='company-a' AND event_key='shared-key'").get().state,'superseded','Newer revision must atomically supersede an unapplied older revision.');
assert.equal(sql.prepare("SELECT state FROM sales_event_states WHERE company_id='company-b' AND event_key='shared-key'").get().state,'received','Revision trigger must remain company scoped.');
assert.equal(sql.prepare("SELECT count(*) AS count FROM sales_event_transitions WHERE company_id='company-a' AND event_key='shared-key'").get().count,2,'Receipt and supersession transitions must both be retained.');

sql.prepare("UPDATE sales_event_states SET state='processing' WHERE company_id='company-a' AND event_key='revision-2'").run();
event.run('company-a','other-lineage-event','other-lineage','other-application','pantrack','internal','company-a','other-event','other-order',1,'2026-01-01T01:00:00.000Z','2026-01-02T01:00:00.000Z','other-hash','{}');
state.run('company-a','other-lineage-event','other-lineage',1,'received',null,null,null,null,'fixture','2026-01-02T01:00:00.000Z');
sql.prepare("UPDATE sales_event_states SET state='processing' WHERE company_id='company-a' AND event_key='other-lineage-event'").run();
assert.throws(()=>{
 event.run('company-a','same-lineage-processing','lineage','processing-application','pantrack','internal','company-a','event-3','order',3,'2026-01-01T02:00:00.000Z','2026-01-02T02:00:00.000Z','hash-3','{}');
 state.run('company-a','same-lineage-processing','lineage',3,'processing',null,null,null,null,'fixture','2026-01-02T02:00:00.000Z');
},/UNIQUE constraint failed/,'Only one processing state may exist per company/order lineage.');

assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
sql.close();
console.log('PASS: B3 migration preserves all legacy rows, invents no events, installs company-scoped constraints/indexes/triggers, and atomically records revision state history.');
