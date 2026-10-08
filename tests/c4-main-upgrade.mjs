import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {entries,fixture,simulationMigration} from './helpers/supplier-simulation.mjs';

// Upgrade the fenced main schema with populated fictional business/auth data.
// A fresh apply alone cannot catch clearing sessions or rewriting existing history.
const f=await fixture({beforeNewMigration:true});
try {
  await f.source({productId:'upgrade-stock'});
  f.sql.exec(`
    INSERT INTO auth_users(id,email,verified_at,session_epoch,recovery_id,recovery_until)
      VALUES('manager','manager@example.invalid',1,4,'fictional-recovery',10);
    INSERT INTO auth_sessions(hash,user_id,token,expires,reauthenticated_at,recovery,epoch)
      VALUES('fictional-hash','manager','fictional-encrypted-placeholder',99,1,0,4);
    UPDATE auth_fence SET epoch=7 WHERE id=1;
    INSERT INTO orders VALUES('a','legacy-order','{"status":"Prepared"}','2026-10-01');
    INSERT INTO recipes VALUES('a','legacy-recipe','{"name":"Fictional recipe"}');
    INSERT INTO security_audit VALUES('upgrade-audit','a','manager','fixture','upgrade',1);
  `);
  const tables=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const snapshot=()=>tables.map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
  const before=snapshot();
  const schema=f.sql.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all();
  const pending=entries.filter(e=>e.idx>=simulationMigration.idx);
  assert.deepEqual(pending.slice(0,3).map(e=>e.tag),['0024_supplier_simulation','0025_purchase_order_drafts','0026_purchasing_supplier_registry'],
    'Preserve the original C4 integration baseline and exercise later additive migrations too');
  for(const entry of pending){
    f.sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
    assert.deepEqual(snapshot(),before,`${entry.tag} rewrote existing main data`);
    for(const object of schema){
      assert.deepEqual(f.sql.prepare('SELECT type,name,sql FROM sqlite_master WHERE type=? AND name=?').get(object.type,object.name),object,
        `${entry.tag} changed existing main schema object ${object.name}`);
    }
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(f.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }
  for(const table of ['supplier_simulation_orders','purchase_order_drafts','purchasing_suppliers']){
    assert.equal(f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,'Upgrade must not infer purchasing records');
  }
  console.log(`PASS: ${pending.length} C4 migrations preserve all ${tables.length} existing main tables and schema objects, including fenced sessions, recovery state, stock, recipes and proposal history.`);
} finally {f.sql.close();}
