import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/exact-stock-movement-service.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/exact-stock-movement.mjs'});
const {ExactStockMovementService}=await import('../.sites-runtime/exact-stock-movement.mjs');
class Statement {
  constructor(sql,query,values=[]){Object.assign(this,{sql,query,values});}
  bind(...values){return new Statement(this.sql,this.query,values);}
  async first(){return this.sql.prepare(this.query).get(...this.values)??null;}
  run(){return this.sql.prepare(this.query).run(...this.values);}
}
class Database {
  constructor(sql){this.sql=sql;this.beforeBatch=null;}
  prepare(query){return new Statement(this.sql,query);}
  async batch(statements){await this.beforeBatch?.();this.sql.exec('BEGIN IMMEDIATE');
    try{const result=statements.map(statement=>statement.run());this.sql.exec('COMMIT');return result;}
    catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
const cutoff='2026-01-01T00:00:00.000Z';
let now='2026-02-01T00:00:00.000Z';
for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company,company,cutoff);
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(`owner-${company}`,company,'owner');
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company,'milk','{}');
  sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
    VALUES (?,'milk','g',1,'curated','mass','g','1','1','owner',?)`).run(company,cutoff);
  sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
    VALUES (?,'milk','config',1,'active','g',1,'bag',?,'owner',?)`).run(company,cutoff,cutoff);
  sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,'milk','config','mass','10000000','0','0',1,?,?)").run(company,cutoff,cutoff);
}
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('employee','a','employee');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('manager','a','manager');
const db=new Database(sql),service=new ExactStockMovementService(db,'a','owner-a',()=>now);
const token=async(target=service)=>(await target.inspect('milk')).token;
const input=(id,action,amount,extra={})=>({id,action,unitId:'g',unitVersion:1,amount,...extra});
const rejected=(fn,code)=>assert.rejects(fn,error=>error.code===code);
const balance=()=>sql.prepare("SELECT * FROM inventory_balances_exact WHERE company_id='a' AND product_id='milk'").get();
const auditCount=()=>sql.prepare('SELECT count(*) AS n FROM security_audit').get().n;
for(const [user,code] of [[null,'unauthenticated'],['owner-b','forbidden'],['employee','forbidden']]){
  const denied=new ExactStockMovementService(db,'a',user,()=>now);
  await rejected(()=>denied.inspect('milk'),code);
  await rejected(()=>denied.record('milk',input('denied','use','1'),'{}'),code);
}
await rejected(()=>service.inspect('missing'),'not_found');
const incoming=input('incoming','incoming','5');
const initialToken=await token();
await service.record('milk',incoming,initialToken);
assert.equal(balance().incoming_minor,'5000000');
assert.deepEqual(await service.record('milk',incoming,initialToken),{id:'incoming',replayed:true});
await rejected(async()=>service.record('milk',input('incoming','incoming','6'),await token()),'duplicate_key');
await service.record('milk',input('delivery','receive','3',{fromIncoming:true,note:'Received'}),await token());
assert.equal(balance().on_hand_minor,'13000000');
assert.equal(balance().incoming_minor,'2000000');
await service.record('milk',input('use','use','2'),await token());
await service.record('milk',input('waste','waste','1'),await token());
assert.equal(balance().on_hand_minor,'10000000');
await rejected(async()=>service.record('milk',input('too-much','use','11'),await token()),'invalid_input');
await rejected(async()=>service.record('milk',input('zero','receive','0'),await token()),'invalid_input');
await rejected(async()=>service.record('milk',input('negative','incoming','-1'),await token()),'invalid_quantity');
const stale=await token();
await service.record('milk',input('new','incoming','4'),stale);
await rejected(()=>service.record('milk',input('stale','waste','1'),stale),'conflict');
const manager=new ExactStockMovementService(db,'a','manager',()=>now);
const managerToken=await token(manager),auditBefore=auditCount();
db.beforeBatch=()=>{db.beforeBatch=null;sql.exec("UPDATE memberships SET role='employee' WHERE user_id='manager'");};
await rejected(()=>manager.record('milk',input('lost-role','use','1'),managerToken),'conflict');
assert.equal(auditCount(),auditBefore);
sql.exec("UPDATE memberships SET role='manager' WHERE user_id='manager'");
const beforeFailure=await token(),auditBeforeFailure=auditCount();
sql.exec("CREATE TRIGGER fail_movement BEFORE INSERT ON inventory_events_exact BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
await assert.rejects(()=>service.record('milk',input('failure','use','1'),beforeFailure),/injected failure/);
assert.equal(await token(),beforeFailure);assert.equal(auditCount(),auditBeforeFailure);
sql.exec('DROP TRIGGER fail_movement');
const other=new ExactStockMovementService(db,'b','owner-b',()=>now);
await other.record('milk',input('other','use','1'),(await other.inspect('milk')).token);
assert.equal(balance().on_hand_minor,'10000000');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='b'").get().on_hand_minor,'9000000');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: exact stock movements, incoming/delivery, replay, tenant roles, stale writes and rollback (SQLite D1 harness).');
sql.close();
