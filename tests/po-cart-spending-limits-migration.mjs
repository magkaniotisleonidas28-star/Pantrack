import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {unstable_splitSqlQuery} from 'wrangler';
import {build} from 'esbuild';
import {entries,LocalD1} from './helpers/supplier-simulation.mjs';
import {cartCore,configure,supplier,command} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-po-cart-spending-limits.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/po-cart-spending-limits-migration-tests.mjs'});
const {D1PoCartSpendingLimits}=await import('../.sites-runtime/po-cart-spending-limits-migration-tests.mjs');
const m=entries.find(e=>e.tag==='0035_owner_spending_limits');assert.ok(m,'Missing owner spending limit migration');
const statements=unstable_splitSqlQuery(readFileSync(`drizzle/${m.tag}.sql`,'utf8'));
for(const s of statements){
  assert.ok((s.match(/CREATE TRIGGER/g)??[]).length<=1,'Each trigger must be a separate Wrangler statement');
  if(/CREATE TRIGGER/.test(s))assert.match(s.trim(),/END;?$/,'Wrangler kept each trigger body whole');
}
for(const populated of [false,true]){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  try{
    for(const e of entries.filter(e=>e.idx<m.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
    const db=new LocalD1(sql),options={identity:async()=>'manager',clock:{now:()=>new Date('2026-10-10T12:00:00.000Z')}};
    const drafts=new cartCore.D1PurchaseOrderDrafts(db,options),auth=new cartCore.D1PoCartAuthorizations(db,options);
    const reviewed=async cap=>{let po=await drafts.create({action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,capMinor:String(cap),
      notes:'Retained record',lines:[{kind:'non_stock',sku:'OLD',description:'Old item',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}]});
      return drafts.review({...command(po),action:'review',acknowledgeWarnings:true});};
    let retained;
    if(populated){
      sql.exec("INSERT INTO companies VALUES('a','Populated limits upgrade','2026-10-10');INSERT INTO memberships VALUES('manager','a','manager');INSERT INTO memberships VALUES('owner','a','owner')");
      configure(sql);retained=(await auth.authorize(command(await reviewed(15_000)))).current;
    }
    const tables=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
    const snapshot=()=>JSON.stringify(tables.filter(t=>t!=='po_cart_budget_policies').map(t=>[t,sql.prepare(`SELECT * FROM "${t}"`).all()]));
    const before=snapshot(),policies=sql.prepare('SELECT * FROM po_cart_budget_policies').all();
    for(const s of statements)sql.exec(s);
    assert.equal(snapshot(),before,'Every other table is unchanged');
    assert.deepEqual(sql.prepare('SELECT * FROM po_cart_budget_policies').all().map(r=>({...r})),
      policies.map(r=>({...r,per_day_minor:null,per_month_minor:null,actor:null,created_at:null,operation_id:null,fingerprint:null})),'Test policies keep their meaning');
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,tables.length+1);
    if(populated){
      const status=await auth.get({companyId:'a',orderId:retained.authorization.orderId});
      assert.equal(status.valid,true,'A retained authorization stays valid');assert.deepEqual(status.authorization,retained.authorization);
      const later=(await auth.authorize(command(await reviewed(20_000)))).current.authorization;
      assert.deepEqual(later.inputs.policy,{version:1,perOrderMinor:50000,outstandingMinor:100000});assert.equal(later.inputs.window,undefined);
      // The owner's first limits supersede the test policy and immediately count retained exposure.
      const limits=new D1PoCartSpendingLimits(db,
        {clock:options.clock,identity:async()=>({userId:'owner',reauthenticatedAt:Date.parse('2026-10-10T11:59:00.000Z')})});
      await limits.setTimeZone({action:'set_time_zone',companyId:'a',operationId:randomUUID(),expectedVersion:0,timeZone:'America/New_York'});
      await limits.setLimits({action:'set_limits',companyId:'a',operationId:randomUUID(),expectedVersion:1,perOrderMinor:20_000,perDayMinor:40_000,perMonthMinor:null,outstandingMinor:100_000});
      assert.equal((await auth.get({companyId:'a',orderId:retained.authorization.orderId})).valid,false,'A newer policy makes pending permission stale, as before');
      await assert.rejects(auth.authorize(command(await reviewed(5_001))),e=>e.code==='limit_exceeded'&&e.message.includes('daily'));
      assert.throws(()=>sql.exec("INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor) VALUES('a',3,50000,100000)"),/Invalid/);
    }
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{sql.close();}
}
console.log('PASS: Wrangler-split 0035 fresh/populated upgrades keep every table and test policy, retained permission, legacy-shaped new authorizations, then owner limits count retained exposure.');
