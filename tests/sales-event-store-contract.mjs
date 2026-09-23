import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/sales-ingestion.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/sales-store-memory.mjs'});
await build({entryPoints:['src/lib/d1-sales-event-store.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/sales-store-d1.mjs'});
const {InMemorySalesEventStore}=await import('../.sites-runtime/sales-store-memory.mjs');
const {D1SalesEventStore}=await import('../.sites-runtime/sales-store-d1.mjs');

class Statement {
 constructor(database,query,values=[]){this.database=database;this.query=query;this.values=values;}
 bind(...values){return new Statement(this.database,this.query,values);}
 async first(){return this.database.prepare(this.query).get(...this.values)??null;}
 async all(){return {success:true,results:this.database.prepare(this.query).all(...this.values),meta:{changes:0}};}
 runSync(){const statement=this.database.prepare(this.query);if(/^\s*SELECT\b/i.test(this.query))return {success:true,results:statement.all(...this.values),meta:{changes:0}};const result=statement.run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
 async run(){return this.runSync();}
}
class Database {
 constructor(sql){this.sql=sql;this.omitBatchChanges=false;}
 prepare(query){return new Statement(this.sql,query);}
 async batch(statements){
  this.sql.exec('BEGIN IMMEDIATE');
  try{const results=statements.map(statement=>statement.runSync());this.sql.exec('COMMIT');return this.omitBatchChanges?results.map(result=>({...result,meta:{rows_written:result.meta.changes}})):results;}
  catch(error){this.sql.exec('ROLLBACK');throw error;}
 }
}

function migratedDatabase(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys = ON');
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 for(const entry of journal.entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
 sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run('company-a','A','2026-01-01T00:00:00.000Z');
 sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run('company-b','B','2026-01-01T00:00:00.000Z');
 return sql;
}

let sequence=0;
const idFactory=()=>`id-${++sequence}`;
const appliedInventoryResult={
 contract:'pantrack.inventory-consumption.v1',companyId:'company-a',idempotencyKey:'application-event-2',replayed:false,status:'applied',occurredAt:'2025-12-31T23:00:00.000Z',
 selectedVersions:[{lineId:'line-1',recipeId:'latte',recipeVersionId:'latte-v1',quantity:'1',modifiers:[{modifierId:'shot',modifierVersionId:'shot-v1',quantity:'1'}]}],
 changes:[{productId:'milk',consumed:{dimension:'volume',minor:'1000'},balanceBefore:{dimension:'volume',minor:'5000'},balanceAfter:{dimension:'volume',minor:'4000'},versionBefore:1,versionAfter:2}],
};
function record({companyId='company-a',eventKey='event-1',lineageKey='lineage-1',revision=1,hash=`hash-${eventKey}`,kind='native',provider='test-pos',externalEventId=eventKey,externalOrderId='order-1'}={}){
 const receivedAt='2026-01-01T00:00:00.000Z';
 const event={
  schemaVersion:'pantrack.sales.v1',companyId,
  source:{kind,provider,environment:'internal',connectionId:`connection-${kind}`,merchantId:companyId,locationId:'default'},
  external:{externalEventId,externalOrderId,revision,eventIdempotencyKey:eventKey},
  eventType:'sale',orderStatus:'completed',preparationStatus:'prepared',
  occurredAt:'2025-12-31T23:00:00.000Z',receivedAt,timeQuality:'confirmed',
  lines:[{externalLineId:'line-1',externalItemId:'item-1',quantity:'1',modifiers:[]}],
  integrity:{sourcePayloadSha256:hash,payloadExpiresAt:'2026-01-31T00:00:00.000Z',normalizedContractVersion:'pantrack.sales.v1'},
 };
 return {event,auditFragment:{source:event.source,external:event.external,lines:event.lines},lineageKey,applicationKey:`application-${eventKey}`};
}

async function exercise(name,store){
 const actor='user:owner-a';
 const at='2026-01-01T00:00:00.000Z';
 const first=record();
 first.event.untrustedCustomerEmail='customer@example.invalid';
 first.auditFragment={authorization:'must-not-persist'};
 const [created,duplicate]=await Promise.all([store.receive('company-a',first,actor,at),store.receive('company-a',structuredClone(first),actor,at)]);
 assert.deepEqual(new Set([created.kind,duplicate.kind]),new Set(['created','duplicate']),`${name}: concurrent duplicate`);
 assert.equal(await store.state('company-a','event-1'),'received',`${name}: received state`);
 assert.equal(await store.state('company-b','event-1'),null,`${name}: state isolation`);
 assert.equal(await store.event('company-b','event-1'),null,`${name}: event isolation`);
 assert.ok(!JSON.stringify(await store.event('company-a','event-1')).includes('must-not-persist'),`${name}: fragment allowlist`);
 assert.ok(!JSON.stringify(await store.event('company-a','event-1')).includes('customer@example.invalid'),`${name}: normalized document allowlist`);
 await assert.rejects(()=>store.receive('company-b',first,actor,at),`${name}: receipt company mismatch`);

 const conflict=await store.receive('company-a',record({hash:'changed'}),actor,at);
 const conflictAgain=await store.receive('company-a',record({hash:'changed'}),actor,at);
 assert.equal(conflict.kind,'conflict',`${name}: identity conflict`);
 assert.equal(conflictAgain.conflictId,conflict.conflictId,`${name}: conflict deduplication`);
 assert.equal(await store.conflict('company-b',conflict.conflictId),null,`${name}: conflict isolation`);
 const resolution={resolutionId:`resolution-${name}`,conflictId:conflict.conflictId,canonicalEventKey:'event-1',kind:'dismiss',actor,reason:'Reviewed',at};
 const conflictAudit={auditId:`conflict-audit-${name}`,eventKey:'event-1',conflictId:conflict.conflictId,action:'conflict_dismissed',actor,at,reason:'Reviewed'};
 await assert.rejects(()=>store.dismissConflict('company-b',resolution,conflictAudit),`${name}: conflict mutation isolation`);
 await store.dismissConflict('company-a',resolution,conflictAudit);
 await assert.rejects(()=>store.dismissConflict('company-a',{...resolution,resolutionId:`again-${name}`},{...conflictAudit,auditId:`again-audit-${name}`}),error=>error.code==='invalid_state',`${name}: conflict result immutable`);

 const sameRevision=await store.receive('company-a',record({eventKey:'other-event',hash:'other',externalEventId:'other-event'}),actor,at);
 assert.equal(sameRevision.kind,'conflict',`${name}: lineage revision conflict`);
 const newer=await store.receive('company-a',record({eventKey:'event-2',revision:2,hash:'hash-2',externalEventId:'event-2'}),actor,at);
 assert.equal(newer.kind,'created',`${name}: newer revision created`);
 assert.equal(await store.state('company-a','event-1'),'superseded',`${name}: older revision superseded`);
 const stale=await store.receive('company-a',record({eventKey:'event-stale',revision:1,lineageKey:'lineage-stale',hash:'stale',externalEventId:'stale',externalOrderId:'stale-order'}),actor,at);
 assert.equal(stale.state,'received',`${name}: independent lineage`);

 const attempt={attemptId:`attempt-${name}`,eventKey:'event-2',startedAt:at,leaseExpiresAt:'2026-01-01T00:05:00.000Z'};
 const claims=await Promise.all([
  store.claim('company-a','event-2',attempt,at),
  store.claim('company-a','event-2',{...attempt,attemptId:`second-${name}`},at),
 ]);
 assert.deepEqual(claims.sort(),[false,true],`${name}: exactly one concurrent claim`);
 assert.equal(await store.claim('company-b','event-2',{...attempt,attemptId:`wrong-${name}`},at),false,`${name}: wrong-company claim`);
 const completed={...attempt,completedAt:'2026-01-01T00:01:00.000Z',outcome:'applied',inventoryResult:appliedInventoryResult};
 await assert.rejects(()=>store.completeAttempt('company-b',completed,'applied',completed.completedAt),`${name}: completion isolation`);
 await assert.rejects(()=>store.completeAttempt('company-a',{...completed,outcome:'held'},'applied',completed.completedAt),error=>error.code==='invalid_attempt',`${name}: outcome/state mismatch`);
 await store.completeAttempt('company-a',completed,'applied',completed.completedAt,'inventory_applied');
 await assert.rejects(()=>store.completeAttempt('company-a',completed,'applied',completed.completedAt),error=>error.code==='invalid_state'||error.code==='invalid_attempt',`${name}: attempt result immutable`);
 assert.equal((await store.latestAppliedConsumption('company-a','lineage-1',3)).event.external.revision,2,`${name}: consumed snapshot`);

 const noop=await store.receive('company-a',record({eventKey:'event-3',revision:3,hash:'hash-3',externalEventId:'event-3'}),actor,at);
 const noopAttempt={attemptId:`noop-${name}`,eventKey:noop.eventKey,startedAt:at,leaseExpiresAt:'2026-01-01T00:05:00.000Z'};
 assert.equal(await store.claim('company-a',noop.eventKey,noopAttempt,at),true,`${name}: no-op claim`);
 await store.completeAttempt('company-a',{...noopAttempt,completedAt:'2026-01-01T00:01:00.000Z',outcome:'noop'},'applied','2026-01-01T00:01:00.000Z','policy_noop');
 assert.equal((await store.latestAppliedConsumption('company-a','lineage-1',4)).event.external.revision,2,`${name}: no-op does not replace consumption snapshot`);
 assert.equal(await store.latestAppliedConsumption('company-b','lineage-1',4),null,`${name}: consumption history isolation`);
 assert.equal(await store.processingInLineage('company-b','lineage-1'),false,`${name}: lineage state isolation`);
 await assert.rejects(()=>store.appendResolution('company-b',{resolutionId:`wrong-resolution-${name}`,eventKey:'event-3',kind:'retry',actor,reason:'wrong',at}),`${name}: resolution isolation`);
 await assert.rejects(()=>store.appendAudit('company-b',{auditId:`wrong-audit-${name}`,eventKey:'event-3',action:'retry',actor,reason:'wrong',at}),`${name}: audit isolation`);
 await assert.rejects(()=>store.appendCorrection('company-b',{correctionId:`wrong-correction-${name}`,eventKey:'event-3',companyId:'company-b',status:'pending',actor,reason:'wrong',requestedAt:at},{auditId:`wrong-correction-audit-${name}`,eventKey:'event-3',action:'correction_requested',actor,reason:'wrong',at}),`${name}: correction isolation`);
 await store.appendCorrection('company-a',{correctionId:`correction-${name}`,eventKey:'event-3',companyId:'company-a',status:'pending',actor,reason:'Reviewed stock adjustment',requestedAt:at},{auditId:`correction-audit-${name}`,eventKey:'event-3',action:'correction_requested',actor,reason:'Reviewed stock adjustment',at});

 const held=await store.receive('company-a',record({eventKey:'held',lineageKey:'held-lineage',hash:'held',externalEventId:'held',externalOrderId:'held-order'}),actor,at);
 const heldAttempt={attemptId:`held-${name}`,eventKey:held.eventKey,startedAt:at,leaseExpiresAt:'2026-01-01T00:05:00.000Z'};
 assert.equal(await store.claim('company-a',held.eventKey,heldAttempt,at),true,`${name}: held claim`);
 const heldIssue={code:'recipe_version_not_found',message:'Recipe version missing',lineId:'line-1',recipeId:'latte'};
 const heldInventoryResult={contract:'pantrack.inventory-consumption.v1',companyId:'company-a',idempotencyKey:'application-held',replayed:false,status:'held',issues:[heldIssue]};
 await store.completeAttempt('company-a',{...heldAttempt,completedAt:'2026-01-01T00:01:00.000Z',outcome:'held',heldReasons:['recipe_version_not_found'],issues:[heldIssue],inventoryResult:heldInventoryResult},'held','2026-01-01T00:01:00.000Z','recipe_version_not_found');
 await store.resolve('company-a',held.eventKey,'held','received',
  {resolutionId:`replay-${name}`,eventKey:held.eventKey,kind:'replay',actor,reason:'Mapping repaired',at:'2026-01-01T00:02:00.000Z'},
  {auditId:`replay-audit-${name}`,eventKey:held.eventKey,action:'replay',actor,reason:'Mapping repaired',at:'2026-01-01T00:02:00.000Z'});
 const replayAttempt={attemptId:`held-replay-${name}`,eventKey:held.eventKey,startedAt:'2026-01-01T00:03:00.000Z',leaseExpiresAt:'2026-01-01T00:08:00.000Z'};
 assert.equal(await store.claim('company-a',held.eventKey,replayAttempt,replayAttempt.startedAt),true,`${name}: replay claim`);
 await store.completeAttempt('company-a',{...replayAttempt,completedAt:'2026-01-01T00:04:00.000Z',outcome:'held',heldReasons:['recipe_version_not_found'],issues:[heldIssue],inventoryResult:heldInventoryResult},'held','2026-01-01T00:04:00.000Z','recipe_version_not_found');
 await store.resolve('company-a',held.eventKey,'held','dismissed',
  {resolutionId:`dismiss-${name}`,eventKey:held.eventKey,kind:'dismiss',actor,reason:'Cannot map item',at:'2026-01-01T00:05:00.000Z'},
  {auditId:`dismiss-audit-${name}`,eventKey:held.eventKey,action:'dismiss',actor,reason:'Cannot map item',at:'2026-01-01T00:05:00.000Z'});
 assert.equal(await store.state('company-a',held.eventKey),'dismissed',`${name}: held replay and dismissal history`);

 const lease=await store.receive('company-a',record({eventKey:'lease',lineageKey:'lease-lineage',hash:'lease',externalEventId:'lease',externalOrderId:'lease-order'}),actor,at);
 const leaseAttempt={attemptId:`lease-${name}`,eventKey:lease.eventKey,startedAt:at,leaseExpiresAt:'2026-01-01T00:05:00.000Z'};
 assert.equal(await store.claim('company-a',lease.eventKey,leaseAttempt,at),true,`${name}: lease claim`);
 assert.deepEqual(await store.recoverExpired('company-b','2026-01-01T00:06:00.000Z'),[],`${name}: recovery isolation`);
 const recoveries=await Promise.all([
  store.recoverExpired('company-a','2026-01-01T00:06:00.000Z'),
  store.recoverExpired('company-a','2026-01-01T00:06:00.000Z'),
 ]);
 assert.deepEqual(recoveries.flat(),[lease.eventKey],`${name}: expired lease recovery is idempotent`);
 assert.equal(await store.state('company-a',lease.eventKey),'failed',`${name}: interrupted state`);
 const retryAt='2026-01-01T00:07:00.000Z';
 await assert.rejects(()=>store.resolve('company-a',lease.eventKey,'failed','dismissed',
  {resolutionId:`invalid-retry-${name}`,eventKey:lease.eventKey,kind:'dismiss',actor,reason:'Invalid transition',at:retryAt},
  {auditId:`invalid-retry-audit-${name}`,eventKey:lease.eventKey,action:'dismiss',actor,reason:'Invalid transition',at:retryAt}),error=>error.code==='invalid_state',`${name}: invalid resolution transition`);
 await assert.rejects(()=>store.resolve('company-b',lease.eventKey,'failed','received',
  {resolutionId:`wrong-retry-${name}`,eventKey:lease.eventKey,kind:'retry',actor,reason:'Wrong company',at:retryAt},
  {auditId:`wrong-retry-audit-${name}`,eventKey:lease.eventKey,action:'retry',actor,reason:'Wrong company',at:retryAt}),`${name}: retry isolation`);
 await store.resolve('company-a',lease.eventKey,'failed','received',
  {resolutionId:`retry-${name}`,eventKey:lease.eventKey,kind:'retry',actor,reason:'Worker restarted',at:retryAt},
  {auditId:`retry-audit-${name}`,eventKey:lease.eventKey,action:'retry',actor,reason:'Worker restarted',at:retryAt});
 assert.equal(await store.state('company-a',lease.eventKey),'received',`${name}: atomic retry resolution`);

 assert.equal(await store.purgeExpiredPayloadFragments('company-b','2026-02-01T00:00:00.000Z',100),0,`${name}: cleanup isolation`);
 assert.equal(await store.purgeExpiredPayloadFragments('company-a','2026-02-01T00:00:00.000Z',1),1,`${name}: bounded cleanup`);
 const purged=await store.event('company-a','event-1');
 assert.equal(purged.auditFragment,null,`${name}: fragment deleted`);
 assert.equal(purged.event.integrity.payloadExpiresAt,null,`${name}: expiry cleared on read`);
 assert.equal(purged.event.integrity.sourcePayloadSha256,'hash-event-1',`${name}: hash retained`);

 for(const [kind,provider,key] of [['manual','pantrack','legacy-manual'],['csv','pantrack-register-import','legacy-csv'],['bridge','pantrack-register-bridge','legacy-bridge']]){
  const receipt=await store.receive('company-a',record({eventKey:key,lineageKey:key,kind,provider,externalEventId:'same-reference',externalOrderId:'same-reference',hash:key}),actor,at);
  assert.equal(receipt.kind,'created',`${name}: ${kind} namespace`);
 }
}

sequence=0;
await exercise('memory',new InMemorySalesEventStore(undefined,idFactory));

sequence=0;
const sql=migratedDatabase();
const database=new Database(sql);
await exercise('d1',new D1SalesEventStore(database,idFactory));
const restarted=new D1SalesEventStore(database,idFactory);
assert.equal(await restarted.state('company-a','event-3'),'applied','D1 restart keeps state');
assert.equal((await restarted.event('company-a','event-3')).event.external.revision,3,'D1 restart keeps immutable facts');
assert.ok(sql.prepare('SELECT count(*) AS count FROM sales_event_transitions').get().count>8,'D1 transition history retained');
assert.ok(sql.prepare('SELECT count(*) AS count FROM sales_event_attempt_results').get().count>=3,'D1 attempt results retained');
const appliedResultRow=sql.prepare("SELECT inventory_result_json FROM sales_event_attempt_results WHERE company_id='company-a' AND attempt_id='attempt-d1'").get();
assert.deepEqual(JSON.parse(appliedResultRow.inventory_result_json),appliedInventoryResult,'D1 preserves selected versions, changes, and replay flag');
const heldResultRow=sql.prepare("SELECT issues_json,inventory_result_json FROM sales_event_attempt_results WHERE company_id='company-a' AND attempt_id='held-d1'").get();
assert.equal(JSON.parse(heldResultRow.issues_json)[0].code,'recipe_version_not_found','D1 preserves A2 issue details');
assert.equal(JSON.parse(heldResultRow.inventory_result_json).status,'held','D1 preserves held A2 result');
database.omitBatchChanges=true;
const metadataIndependent=record({eventKey:'metadata-independent',lineageKey:'metadata-independent',hash:'metadata-independent',externalEventId:'metadata-independent',externalOrderId:'metadata-independent-order'});
await restarted.receive('company-a',metadataIndependent,'user:owner-a','2026-01-01T00:00:00.000Z');
const metadataIndependentAttempt={attemptId:'metadata-independent-attempt',eventKey:'metadata-independent',startedAt:'2026-01-01T00:00:00.000Z',leaseExpiresAt:'2026-01-01T00:05:00.000Z'};
assert.equal(await restarted.claim('company-a','metadata-independent',metadataIndependentAttempt,metadataIndependentAttempt.startedAt),true,'D1 verifies a claim from its persisted lease when batch metadata omits changes');
await restarted.completeAttempt('company-a',{...metadataIndependentAttempt,completedAt:'2026-01-01T00:01:00.000Z',outcome:'noop'},'applied','2026-01-01T00:01:00.000Z','policy_noop');
assert.equal(await restarted.state('company-a','metadata-independent'),'applied','D1 verifies completion with transactional SELECT changes when batch metadata omits changes');
database.omitBatchChanges=false;
assert.equal(sql.prepare("SELECT count(*) AS count FROM sales_event_audits WHERE action='lease_expired'").get().count,1,'D1 lease recovery audit is unique');
assert.equal(sql.prepare("SELECT count(*) AS count FROM sales_event_corrections WHERE status='pending'").get().count,1,'D1 correction and audit linkage retained');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[],'D1 foreign keys valid');
sql.prepare("UPDATE sales_events SET normalized_json='{}' WHERE company_id='company-a' AND event_key='event-3'").run();
await assert.rejects(()=>restarted.event('company-a','event-3'),error=>error.code==='corrupt_store','D1 fails closed on corrupt persisted facts');
sql.close();

console.log('PASS: in-memory and D1 sales event stores share company-scoped identity, conflict, revision, lease, history, retention, namespace, and restart behavior.');
