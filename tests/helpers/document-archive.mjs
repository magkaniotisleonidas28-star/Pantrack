import {build} from 'esbuild';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {open,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {exportFixture} from './purchase-order-export.mjs';
import {LocalD1} from './supplier-simulation.mjs';
await build({stdin:{contents:['purchase-order-document-archive','purchase-order-document-archive-contract','purchase-order-document-archive-sources',
  'd1-purchase-order-drafts','d1-purchase-order-history-exports','purchase-order-history-export-contract',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/document-archive-test-core.mjs'});
export const core=await import('../../.sites-runtime/document-archive-test-core.mjs');
const json=value=>JSON.stringify(value),clone=value=>JSON.parse(json(value));

// Conformance adapter only: these tables are NOT an application migration or production D1 journal.
export class LocalArchiveJournal{
  constructor(sql,{sources,now}){
    this.sql=sql;this.sources=sources;this.now=now;this.tail=Promise.resolve();this.hooks={};
    sql.exec(`CREATE TABLE IF NOT EXISTS archive_contract_intents (
      id TEXT PRIMARY KEY,company_id TEXT NOT NULL,operation_id TEXT NOT NULL,actor_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
      command TEXT NOT NULL,template TEXT NOT NULL,requested_at TEXT NOT NULL,state TEXT NOT NULL,token TEXT,lease_until TEXT,
      manifest TEXT,artifact TEXT,reason TEXT,UNIQUE(company_id,operation_id));
      CREATE TABLE IF NOT EXISTS archive_contract_leases (token TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES archive_contract_intents(id));
      CREATE TABLE IF NOT EXISTS archive_contract_observations (id INTEGER PRIMARY KEY AUTOINCREMENT,document_id TEXT NOT NULL REFERENCES archive_contract_intents(id),
        actor_id TEXT NOT NULL,token TEXT,payload TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS archive_contract_no_delete BEFORE DELETE ON archive_contract_intents BEGIN SELECT RAISE(ABORT,'retain archive intent'); END;
      CREATE TRIGGER IF NOT EXISTS archive_contract_identity BEFORE UPDATE ON archive_contract_intents
        WHEN NEW.company_id IS NOT OLD.company_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.actor_id IS NOT OLD.actor_id OR
          NEW.fingerprint IS NOT OLD.fingerprint OR NEW.command IS NOT OLD.command OR NEW.template IS NOT OLD.template OR NEW.requested_at IS NOT OLD.requested_at OR
          (OLD.manifest IS NOT NULL AND NEW.manifest IS NOT OLD.manifest) OR (OLD.artifact IS NOT NULL AND NEW.artifact IS NOT OLD.artifact)
        BEGIN SELECT RAISE(ABORT,'immutable archive identity'); END;
      CREATE TRIGGER IF NOT EXISTS archive_contract_obs_update BEFORE UPDATE ON archive_contract_observations BEGIN SELECT RAISE(ABORT,'immutable observation'); END;
      CREATE TRIGGER IF NOT EXISTS archive_contract_obs_delete BEFORE DELETE ON archive_contract_observations BEGIN SELECT RAISE(ABORT,'retain observation'); END;`);
  }
  async hook(name,...args){const fn=this.hooks[name];delete this.hooks[name];if(fn)await fn(...args);}
  transaction(fn){const work=this.tail.then(async()=>{this.sql.exec('BEGIN IMMEDIATE');try{const result=await fn();this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}});this.tail=work.catch(()=>{});return work;}
  authorize(companyId,actorId){const row=this.sql.prepare("SELECT role FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager')").get(companyId,actorId);if(!row)core.archiveFail('forbidden');}
  row(id){return this.sql.prepare('SELECT * FROM archive_contract_intents WHERE id=?').get(id);}
  owned(claim){const row=this.row(claim.id);if(!row||row.company_id!==claim.request.companyId||row.actor_id!==claim.actorId)core.archiveFail('fenced');return row;}
  active(claim){const row=this.owned(claim);if(row.artifact||row.token!==claim.token||!row.lease_until||Date.parse(row.lease_until)<=Date.parse(this.now()))core.archiveFail('fenced');return row;}
  async current(claim,manifest){
    let current;try{current=await core.captureArchiveSource(claim.request,await this.sources.load(claim.request,claim.actorId));}catch{core.archiveFail('source_changed');}
    if(json(current.proof)!==json(manifest.source))core.archiveFail('source_changed');
  }
  claim(row){return {id:row.id,request:JSON.parse(row.command),actorId:row.actor_id,requestFingerprint:row.fingerprint,template:row.template,
    requestedAt:row.requested_at,token:row.token,leaseUntil:row.lease_until,...(row.manifest?{manifest:JSON.parse(row.manifest)}:{})};}
  async begin(input){await this.hook('begin',input);return this.transaction(async()=>{
    const {request,actorId}=input;this.authorize(request.companyId,actorId);
    let row=this.sql.prepare('SELECT * FROM archive_contract_intents WHERE company_id=? AND operation_id=?').get(request.companyId,request.operationId);
    if(row&&(row.fingerprint!==input.requestFingerprint||row.actor_id!==actorId))core.archiveFail('conflict');
    if(row?.artifact)return {kind:'ready',artifact:JSON.parse(row.artifact)};
    if(row?.lease_until&&Date.parse(row.lease_until)>Date.parse(this.now())&&row.state!=='held')return {kind:'busy'};
    const token=crypto.randomUUID(),until=new Date(Date.parse(this.now())+input.leaseMs).toISOString();
    if(!row){const id=crypto.randomUUID();this.sql.prepare('INSERT INTO archive_contract_intents(id,company_id,operation_id,actor_id,fingerprint,command,template,requested_at,state,token,lease_until) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,request.companyId,request.operationId,actorId,input.requestFingerprint,json(request),input.template,input.requestedAt,'reserved',token,until);row=this.row(id);
    }else{this.sql.prepare("UPDATE archive_contract_intents SET state=CASE WHEN manifest IS NULL THEN 'reserved' ELSE 'prepared' END,token=?,lease_until=? WHERE id=?").run(token,until,row.id);row=this.row(row.id);}
    this.sql.prepare('INSERT INTO archive_contract_leases(token,document_id) VALUES(?,?)').run(token,row.id);return {kind:'claim',claim:clone(this.claim(row))};
  });}
  async prepare(claim,value){await this.hook('prepare',claim,value);return this.transaction(async()=>{
    const row=this.active(claim),manifest=core.captureArchiveManifest(value);this.authorize(row.company_id,claim.actorId);await this.current(claim,manifest);
    if(row.manifest&&row.manifest!==json(manifest))core.archiveFail('integrity');
    this.sql.prepare("UPDATE archive_contract_intents SET manifest=?,state='prepared' WHERE id=? AND token=?").run(json(manifest),row.id,claim.token);
  });}
  async observe(claim,observation){await this.hook('observe',claim,observation);return this.transaction(async()=>{
    const row=this.owned(claim);if(!this.sql.prepare('SELECT 1 FROM archive_contract_leases WHERE token=? AND document_id=?').get(claim.token,row.id))core.archiveFail('fenced');
    const result=this.sql.prepare('INSERT INTO archive_contract_observations(document_id,actor_id,token,payload,at) VALUES(?,?,?,?,?)').run(row.id,claim.actorId,claim.token,json(observation),this.now());return String(result.lastInsertRowid);
  });}
  async publish(claim,observationId){await this.hook('publish',claim,observationId);return this.transaction(async()=>{
    const row=this.active(claim);this.authorize(row.company_id,claim.actorId);if(!row.manifest)core.archiveFail('integrity');
    const manifest=core.captureArchiveManifest(JSON.parse(row.manifest));await this.current(claim,manifest);
    const observed=this.sql.prepare('SELECT payload FROM archive_contract_observations WHERE id=? AND document_id=? AND token=?').get(observationId,row.id,claim.token);
    const o=observed?JSON.parse(observed.payload):null;
    if(!o||o.kind!=='object'||!o.present||o.sha256!==manifest.sha256||o.reportedSize!==manifest.size||o.byteLength!==manifest.size)core.archiveFail('integrity');
    const artifact=core.captureArchiveArtifact({...manifest,issuedAt:this.now()});this.sql.prepare("UPDATE archive_contract_intents SET artifact=?,state='ready',lease_until=NULL WHERE id=? AND token=?").run(json(artifact),row.id,claim.token);return clone(artifact);
  });}
  async hold(claim,reason){return this.transaction(async()=>{const row=this.owned(claim);if(row.artifact||row.token!==claim.token)return;
    this.sql.prepare("UPDATE archive_contract_intents SET state='held',reason=?,lease_until=NULL WHERE id=? AND token=?").run(reason,row.id,claim.token);});}
  async open(companyId,id,actorId){return this.transaction(async()=>{this.authorize(companyId,actorId);const row=this.sql.prepare('SELECT artifact FROM archive_contract_intents WHERE company_id=? AND id=?').get(companyId,id);if(!row?.artifact)core.archiveFail('missing');return clone(JSON.parse(row.artifact));});}
  async observeRead(artifact,actorId,observation){await this.hook('observeRead',artifact,observation);return this.transaction(async()=>{
    const row=this.row(artifact.id);if(!row||row.company_id!==artifact.companyId||row.artifact!==json(artifact))core.archiveFail('integrity');
    this.sql.prepare('INSERT INTO archive_contract_observations(document_id,actor_id,payload,at) VALUES(?,?,?,?)').run(row.id,actorId,json(observation),this.now());
  });}
  async recheck(artifact,actorId){await this.hook('recheck',artifact,actorId);return this.transaction(async()=>{this.authorize(artifact.companyId,actorId);const row=this.row(artifact.id);if(row?.artifact!==json(artifact))core.archiveFail('integrity');});}
}

export class LocalPrivateObjects{
  constructor(root){this.root=resolve(root);this.puts=0;this.reads=0;this.hooks={};mkdirSync(this.root,{recursive:true});}
  path(key){if(!/^pantrack-documents\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(pdf|xlsx)$/.test(key))throw Error('Unsafe test object key');
    const path=resolve(this.root,...key.split('/'));if(!path.startsWith(this.root+sep))throw Error('Outside owned object root');return path;}
  async putIfAbsent(key,bytes){this.puts++;if(this.hooks.beforePut){const hook=this.hooks.beforePut;delete this.hooks.beforePut;await hook(key,bytes);}const path=this.path(key);await mkdir(dirname(path),{recursive:true});
    let handle;try{handle=await open(path,'wx',0o600);}catch(error){if(error.code==='EEXIST')return 'exists';throw error;}
    try{await handle.writeFile(bytes);}finally{await handle.close();}if(this.hooks.afterPut){const hook=this.hooks.afterPut;delete this.hooks.afterPut;await hook(key,bytes);}return 'created';}
  async read(key,maxBytes){this.reads++;if(this.hooks.beforeRead){const hook=this.hooks.beforeRead;delete this.hooks.beforeRead;await hook(key);}const path=this.path(key);
    let handle;try{handle=await open(path,'r');}catch(error){if(error.code==='ENOENT')return null;throw error;}let result;
    try{const {size}=await handle.stat();if(size>maxBytes)result={size,bytes:null};else{
      // One extra byte detects growth after stat, without ever loading an unbounded body.
      const buffer=new Uint8Array(Math.min(size+1,maxBytes+1));let length=0;
      while(length<buffer.byteLength){const {bytesRead}=await handle.read(buffer,length,buffer.byteLength-length,null);if(!bytesRead)break;length+=bytesRead;}
      result={size:Math.max(size,length),bytes:length>maxBytes?null:buffer.slice(0,length)};
    }}finally{await handle.close();}
    if(this.hooks.afterRead){const hook=this.hooks.afterRead;delete this.hooks.afterRead;await hook(key,result);}return result;}
}
export function openArchiveContext(databasePath,objectRoot,state={user:'manager',at:'2026-10-02T12:00:00.000Z'}){
  const sql=new DatabaseSync(databasePath);sql.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');const db=new LocalD1(sql),sources=new core.D1DocumentArchiveSources(db);
  const journal=new LocalArchiveJournal(sql,{sources,now:()=>state.at}),objects=new LocalPrivateObjects(objectRoot),clock={now:()=>new Date(state.at)},identity=async()=>state.user;
  const drafts=new core.D1PurchaseOrderDrafts(db,{identity,clock,salesPolicy:{syncEnabled:false,maxLagMs:600000}}),stats={renders:0,sourceReads:0};
  const dependencies={identity,clock,journal,objects,sources:{load:async(...args)=>{stats.sourceReads++;return sources.load(...args);}},render:async(...args)=>{stats.renders++;return core.renderDocumentArchive(...args,async()=>new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf')));}};
  const service=overrides=>new core.PurchaseOrderDocumentArchive({...dependencies,...overrides});
  const business=()=>json(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'archive_contract_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name}"`).all()]));
  return {sql,db,state,sources,journal,objects,clock,drafts,stats,dependencies,service,business,close:()=>sql.close()};
}
export async function archiveFixture(){
  mkdirSync('.sites-runtime/document-archive-tests',{recursive:true});const folder=mkdtempSync(resolve('.sites-runtime/document-archive-tests/run-'));
  const f=await exportFixture(),order=await f.drafts.create(f.create({lines:[{...f.nonStock,estimatedUnitMinor:'125'},{...f.nonStock,sku:'UNKNOWN'}]}));
  const second=await f.drafts.create(f.create()),canceled=await f.drafts.cancel({action:'cancel',companyId:'a',orderId:second.snapshot.id,expectedRevision:1,operationId:crypto.randomUUID(),reason:'Archive history fixture'});
  const databasePath=join(folder,'contract.sqlite'),objectRoot=join(folder,'private-objects');await backup(f.sql,databasePath);f.sql.close();
  return {...openArchiveContext(databasePath,objectRoot),folder,databasePath,objectRoot,order,canceled,create:f.create,edit:f.edit,select:f.select};
}
