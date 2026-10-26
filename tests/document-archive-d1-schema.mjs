import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {unstable_splitSqlQuery} from 'wrangler';
import {core} from './helpers/purchase-order-export.mjs';
import {LocalD1} from './helpers/supplier-simulation.mjs';
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries,migration=entries.find(e=>e.tag.endsWith('_document_archive_journal'));
assert.ok(migration);const source=readFileSync(`drizzle/${migration.tag}.sql`,'utf8'),split=unstable_splitSqlQuery(source);
const previous=JSON.parse(readFileSync(`drizzle/meta/${String(migration.idx-1).padStart(4,'0')}_snapshot.json`,'utf8'));
const current=JSON.parse(readFileSync(`drizzle/meta/${String(migration.idx).padStart(4,'0')}_snapshot.json`,'utf8'));
assert.equal(current.prevId,previous.id);
assert.deepEqual(Object.keys(current.tables).filter(name=>!previous.tables[name]).sort(),['document_archive_intents','document_archive_leases','document_archive_observations']);
for(const [name,table] of Object.entries(previous.tables))assert.deepEqual(current.tables[name],table,`Preserve existing schema ${name}`);
const triggers=split.filter(sql=>/CREATE TRIGGER/.test(sql));assert.equal(triggers.length,11);assert.ok(triggers.every(sql=>/END;?\s*$/.test(sql)));
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
try{
  for(const e of entries.filter(e=>e.idx<migration.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
  sql.exec("INSERT INTO companies VALUES('a','Fictional populated archive upgrade','2026-10-01'); INSERT INTO memberships VALUES('manager','a','manager'); INSERT INTO inventory VALUES('a','legacy','{\"onHand\":42}',1)");
  const db=new LocalD1(sql),identity=async()=>'manager',clock={now:()=>new Date('2026-10-01T12:00:00.000Z')};
  const drafts=new core.D1PurchaseOrderDrafts(db,{identity,clock,salesPolicy:{syncEnabled:false,maxLagMs:600000}});
  const order=await drafts.create({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'manual',capMinor:'10000',notes:'Preserve this existing draft',
    supplier:{id:'fixture',name:'Fictional supply',email:'orders@example.invalid',accountId:'fixture',locationId:'fixture',deliveryAddress:'Fictional address'},
    lines:[{kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:'125'}]});
  const tables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const snapshot=()=>JSON.stringify(tables.map(name=>[name,sql.prepare(`SELECT * FROM "${name}"`).all()])),before=snapshot();
  for(const statement of split)sql.exec(statement);assert.equal(snapshot(),before);
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'document_archive_%'").get().n,11);
  assert.equal((await new core.D1PurchaseOrderExports(db,{identity}).get({companyId:'a',orderId:order.snapshot.id,revision:order.revision})).revision,order.revision);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
  // Empty and populated upgrades preserve every legacy application row.
  const fresh=new DatabaseSync(':memory:');try{fresh.exec('PRAGMA foreign_keys=ON');
    for(const e of entries)for(const statement of unstable_splitSqlQuery(readFileSync(`drizzle/${e.tag}.sql`,'utf8')))fresh.exec(statement);
    assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(fresh.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'document_archive_%'").get().n,3);
  }finally{fresh.close();}
}finally{sql.close();}
console.log('PASS: application archive migration splits all 11 triggers correctly in Wrangler, applies fresh and populated, retains every existing application row and preserves draft export compatibility.');
