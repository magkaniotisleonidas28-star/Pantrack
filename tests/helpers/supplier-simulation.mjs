import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:[
  'd1-supplier-simulation','fake-supplier-connector','supplier-simulation-contract',
  'd1-replenishment-settings','d1-replenishment-proposal-origins','d1-replenishment-lifecycle',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/supplier-simulation-test.mjs'});
export const core=await import('../../.sites-runtime/supplier-simulation-test.mjs');
export const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
export const simulationMigration=entries.find(e=>e.tag.endsWith('_supplier_simulation'));
if(!simulationMigration)throw Error('Missing supplier simulation migration');
class Statement {
  constructor(db,query,values=[]){this.db=db;this.query=query;this.values=values;}
  bind(...values){if(values.length>100)throw Error('D1 maximum bound parameters exceeded');return new Statement(this.db,this.query,values);}
  async first(){return this.db.sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {success:true,results:this.db.sql.prepare(this.query).all(...this.values),meta:{changes:0}};}
  runSync(){const stmt=this.db.sql.prepare(this.query);if(/^\s*SELECT\b/i.test(this.query))return {success:true,results:stmt.all(...this.values),meta:{changes:0}};const result=stmt.run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
  async run(){return this.runSync();}
}
export class LocalD1 {
  constructor(sql){this.sql=sql;this.beforeBatch=null;this.loseAcknowledgment=false;}
  prepare(query){return new Statement(this,query);}
  async batch(statements){
    if(this.beforeBatch){const action=this.beforeBatch;this.beforeBatch=null;action();}
    this.sql.exec('BEGIN IMMEDIATE');
    let results;
    try{results=statements.map(s=>s.runSync());this.sql.exec('COMMIT');}
    catch(error){this.sql.exec('ROLLBACK');throw error;}
    if(this.loseAcknowledgment){this.loseAcknowledgment=false;throw Error('lost acknowledgment');}
    return results.map(result=>({...result,meta:{changes:0}}));
  }
}
export async function fixture({scenario='accepted',limits={perOrderMinor:10_000,perUtcDayMinor:20_000},beforeNewMigration=false}={}){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const entry of entries.filter(e=>!beforeNewMigration||e.idx<simulationMigration.idx))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
  let at='2026-10-01T12:00:00.000Z',user='manager';
  const clock={now:()=>new Date(at)},db=new LocalD1(sql);
  for(const company of ['a','b']){
    sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(company,`Fictional ${company}`,at);
    for(const [id,role] of [['manager','manager'],['owner','owner'],['employee','employee']])sql.prepare('INSERT INTO memberships(user_id,company_id,role) VALUES(?,?,?)').run(company==='b'?`b-${id}`:id,company,role);
  }
  const connector=core.createFakeSupplierConnector({scenario,unitPriceMinor:1000,feeMinor:250,quoteTtlMs:60_000});
  const options={identity:async()=>user,connector,fixtureLimits:()=>limits,clock,salesPolicy:{syncEnabled:true,maxLagMs:600_000}};
  const engine=()=>new core.D1SupplierSimulation(db,options);
  let serial=0;
  async function source({companyId='a',productId=`item-${++serial}`,clover=false,accountId='fake-account',locationId='fake-location'}={}){
    const actor={companyId,userId:companyId==='a'?'manager':'b-manager',role:'manager'};
    sql.prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)').run(companyId,productId,JSON.stringify({name:productId}));
    sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at) VALUES(?,?,'each',1,'curated','count','each','1','1','manager',?,NULL)`).run(companyId,productId,at);
    sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES(?,?,?,1,'active','each',1,'case','30',NULL,?,NULL,'manager',?)`).run(companyId,productId,`config-${productId}`,at,at);
    sql.prepare(`INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at) VALUES(?,?,?,'count','20','10','0',1,?,?)`).run(companyId,productId,`config-${productId}`,at,at);
    const q=minor=>({dimension:'count',minor:String(minor)});
    await new core.D1ReplenishmentSettingsStore(db,{clock}).save({companyId,productId,changeId:`settings-${productId}`,expectedVersion:0,expectedConfigId:`config-${productId}`,expectedConfigVersion:1,actor,reason:'Fictional target',
      settings:{target:q(100),capacity:q(120),dailyUse:q(10),shelfDays:null,countEveryDays:7,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'4'}});
    const request={companyId,productId,id:`proposal-${productId}`,createId:`create-${productId}`,actor,
      supplier:{companyId,source:'fictional_fixture',mappingId:`mapping-${productId}`,mappingVersion:1,supplierId:'fake-supplier',accountId,locationId,sku:`SKU-${productId}`},
      priceEstimate:{companyId,source:'fictional_fixture',currency:'USD',perPackMinor:'900'}};
    const origins=new core.D1ReplenishmentProposalOrigins(db,{clock});
    if(clover){
      const millis=Date.parse(at),previous=new Date(millis-60_000).toISOString();
      sql.prepare('INSERT OR IGNORE INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES(?,?,?,?,?,?,0)').run(companyId,`merchant-${companyId}`,'sandbox','fictional-placeholder',at,at);
      sql.prepare('INSERT OR IGNORE INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until) VALUES(?,?,?,?,?,?,?,?,0)').run(companyId,'sandbox',`merchant-${companyId}`,millis-120_000,millis-60_000,at,previous,null);
      await origins.createWithClover(request,options.salesPolicy);
    }else await origins.create({...request,sales:{companyId,source:'fictional_fixture',status:'current',heldEventCount:0}});
    return (await new core.D1ReplenishmentLifecycle(db,{clock,salesPolicy:options.salesPolicy}).get(companyId,request.id,actor)).handoff;
  }
  function command(order,operationId){return {companyId:order.companyId,orderId:order.id,operationId,expectedRevision:order.revision};}
  async function approved(id,handoffs){
    const e=engine();
    let order=await e.create({companyId:handoffs[0].companyId,orderId:id,operationId:`${id}-create`,handoffs});
    order=await e.quote(command(order,`${id}-quote`));
    return e.approve({...command(order,`${id}-approve`),quoteFingerprint:core.canonicalJson(order.quote)});
  }
  return {sql,db,options,engine,connector,source,command,approved,
    setUser:value=>{user=value;},setTime:value=>{at=value;},setLimits:value=>{limits=value;},
    applyNewMigration:()=>sql.exec(readFileSync(`drizzle/${simulationMigration.tag}.sql`,'utf8'))};
}
