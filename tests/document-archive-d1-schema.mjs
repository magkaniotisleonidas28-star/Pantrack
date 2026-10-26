import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {unstable_splitSqlQuery} from 'wrangler';
import {exportFixture} from './helpers/purchase-order-export.mjs';
const source=readFileSync('tests/fixtures/document-archive-journal.sql','utf8'),split=unstable_splitSqlQuery(source);
const triggers=split.filter(sql=>/CREATE TRIGGER/.test(sql));assert.equal(triggers.length,11);assert.ok(triggers.every(sql=>/END;?\s*$/.test(sql)));
const f=await exportFixture();
try{
  const order=await f.drafts.create(f.create()),tables=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const snapshot=()=>JSON.stringify(tables.map(name=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()])),before=snapshot();
  for(const statement of split)f.sql.exec(statement);assert.equal(snapshot(),before);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'document_archive_%'").get().n,11);
  assert.equal((await f.exports.get(f.select(order))).revision,order.revision);
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  // Empty and populated upgrades preserve every legacy application row.
  const fresh=new DatabaseSync(':memory:');try{fresh.exec('PRAGMA foreign_keys=ON');
    const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
    for(const e of entries)for(const statement of unstable_splitSqlQuery(readFileSync(`drizzle/${e.tag}.sql`,'utf8')))fresh.exec(statement);
    for(const statement of split)fresh.exec(statement);assert.deepEqual(fresh.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{fresh.close();}
}finally{f.sql.close();}
console.log('PASS: draft archive schema splits all 11 triggers correctly in Wrangler, applies fresh and populated, retains every existing application row and preserves draft export compatibility. Final application migration remains queued.');
