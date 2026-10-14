import {browserSessionSummary} from './po-cart-browser-session-contract';
import {reconciliationSummary} from './po-cart-reconciliation-contract';
import {z} from 'zod';
import {managerCartView} from './po-cart-manager-contract';
import {checkBrowserCart,type BrowserEvidence} from './po-cart-browser-contract';
import {D1PoCartAuthorizations,type CartAuthorizationGuard as Guard} from './d1-po-cart-authorizations';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import {PoCartAuthorizationError,type CartAuthorizationStatus} from './po-cart-authorization-contract';
import {CartPreparationError} from './po-cart-preparation-contract';
import {PurchaseOrderError} from './purchase-order-contract';
import {SupplierRegistryError} from './purchasing-supplier-contract';
import {enqueueCartJobSchema,cartJobQuerySchema,managerCartQuerySchema,cancelCartJobSchema,workerCartJobSchema,fencedCartJobSchema,
  beginCartAttemptSchema,cartResultSchema,browserCartEvidenceSchema,browserCartHoldSchema,CART_LEASE_MS,cartJobFail as fail,PoCartJobError,
  type CartJob,type CartJobOwner,type CartJobStatus,type CartJobReceipt,type CartJobMutation,type CartResult,type CartAttemptGrant} from './po-cart-job-contract';

type JobRow={browser_config_json?:string|null;company_id:string;id:string;authorization_id:string;authorization_revision:number;inputs_json:string;
  supplier_id:string;account_id:string;requested_by:string;revision:number;state:CartJob['state'];created_at:string;updated_at:string};
type OwnerRow={job_id:string|null;fence:number;worker_id:string|null;lease_until:string|null};
export type CartWorkerAccess={consumerKind:'fake'|'local_browser';id:string;companyId:string;supplierId:string;accountId:string;credentialId?:string;identityVersion?:number;
  assertCurrent:()=>Promise<void>;guard:()=>Guard};
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
const known=(e:unknown)=>e instanceof PoCartAuthorizationError||e instanceof CartPreparationError||e instanceof PurchaseOrderError||e instanceof SupplierRegistryError;

/** Fictional protocol only. HTTP resolves trusted worker access; request bodies never provide identity. */
export class D1PoCartJobs {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;
    workerId?:string;workerAccess?:CartWorkerAccess;clock?:{now():Date};salesPolicy?:CloverReviewPolicy}){}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  private auth(){return new D1PoCartAuthorizations(this.db,this.options);}
  private parse<T>(schema:z.ZodType<T>,value:unknown):T{
    const parsed=schema.safeParse(value);if(!parsed.success)fail('invalid_request','Invalid job intent, revision or UUID operation identity.');return parsed.data;
  }
  private async actor(companyId:string){
    const actor=await this.options.identity();
    if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(companyId,actor).first())fail('forbidden','Current owner or manager membership is required.');
    return actor;
  }
  private worker(){const id=this.options.workerAccess?.id??this.options.workerId;if(!id||!z.string().trim().min(1).max(200).safeParse(id).success)fail('forbidden','Internal worker identity is required.');return id;}
  private async workerScope(companyId:string,id:string){
    const access=this.options.workerAccess;if(!access)return;
    await access.assertCurrent();
    if(companyId!==access.companyId||!await this.db.prepare('SELECT 1 FROM po_cart_jobs WHERE company_id=? AND id=? AND supplier_id=? AND account_id=? AND (browser_config_json IS NOT NULL)=?')
      .bind(access.companyId,id,access.supplierId,access.accountId,Number(access.consumerKind==='local_browser')).first())fail('missing','Preparation job not found.');
  }
  async getWorker(jobId?:string){
    const access=this.options.workerAccess;if(!access)fail('forbidden','Authenticated worker required.');
    await access.assertCurrent();
    if(!jobId){
      const candidate=await this.db.prepare(`SELECT j.id FROM po_cart_jobs j JOIN po_cart_owners o ON o.company_id=j.company_id AND o.job_id=j.id
        WHERE j.company_id=? AND j.supplier_id=? AND j.account_id=? AND (j.browser_config_json IS NOT NULL)=? AND (j.state='queued' OR (j.state='preparing' AND o.lease_until<=?))
        AND NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions h WHERE h.company_id=j.company_id AND h.supplier_id=j.supplier_id AND h.account_id=j.account_id AND h.state IN ('requested','opening','open','closing')) ORDER BY j.created_at,j.id LIMIT 1`).bind(access.companyId,access.supplierId,access.accountId,Number(access.consumerKind==='local_browser'),this.now()).first<{id:string}>();
      jobId=candidate?.id;
    }
    if(!jobId){await access.assertCurrent();return null;}
    await this.workerScope(access.companyId,jobId);
    const current=await this.status(access.companyId,jobId);await access.assertCurrent();return current;
  }
  private async row(companyId:string,id:string){
    const row=await this.db.prepare('SELECT * FROM po_cart_jobs WHERE company_id=? AND id=?').bind(companyId,id).first<JobRow>();
    if(!row)fail('missing','Preparation job not found.');return row;
  }
  private decode(r:JobRow):CartJob{return {browser:r.browser_config_json?JSON.parse(r.browser_config_json):null,companyId:r.company_id,id:r.id,authorizationId:r.authorization_id,
    authorizationRevision:r.authorization_revision,inputs:JSON.parse(r.inputs_json),supplierId:r.supplier_id,accountId:r.account_id,
    requestedBy:r.requested_by,revision:r.revision,state:r.state,purchaseState:'not_confirmed',deliveryState:'outstanding',createdAt:r.created_at,updatedAt:r.updated_at};}
  private async owner(j:CartJob){return this.db.prepare('SELECT * FROM po_cart_owners WHERE company_id=? AND supplier_id=? AND account_id=?')
    .bind(j.companyId,j.supplierId,j.accountId).first<OwnerRow>();}
  private state(j:CartJob):Guard{return {sql:'EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=? AND id=? AND revision=? AND state=?)',args:[j.companyId,j.id,j.revision,j.state]};}
  private ownership(j:CartJob,o:OwnerRow):Guard{return {sql:`EXISTS (SELECT 1 FROM po_cart_owners WHERE company_id=? AND supplier_id=? AND account_id=?
    AND job_id=? AND fence=? AND worker_id IS ? AND lease_until IS ?)`,args:[j.companyId,j.supplierId,j.accountId,j.id,o.fence,o.worker_id,o.lease_until]};}
  private async use(j:CartJob){
    const use=await this.auth().guardedUse(j.companyId,j.authorizationId,j.requestedBy);
    if(canonicalJson(use.authorization.inputs)!==canonicalJson(j.inputs))fail('source_changed','Job permission inputs changed.');
    return use;
  }
  private async status(companyId:string,id:string):Promise<CartJobStatus>{
    const initial=this.decode(await this.row(companyId,id));
    const previousAuthorization=await this.auth().consumerStatus(companyId,initial.authorizationId,initial.requestedBy);
    const a=previousAuthorization.authorization!;
    let guards:Guard[]=[];
    try{guards=(await this.use(initial)).guards;}catch(e){if(!known(e))throw e;}
    const reads=await this.db.batch([
      this.db.prepare('SELECT * FROM po_cart_jobs WHERE company_id=? AND id=?').bind(companyId,id),
      this.db.prepare('SELECT * FROM po_cart_owners WHERE company_id=? AND supplier_id=? AND account_id=?').bind(companyId,initial.supplierId,initial.accountId),
      this.db.prepare('SELECT * FROM po_cart_attempts WHERE company_id=? AND job_id=? ORDER BY at,id').bind(companyId,id),
      this.db.prepare('SELECT * FROM po_cart_results WHERE company_id=? AND job_id=? ORDER BY at,attempt_id').bind(companyId,id),
      this.db.prepare('SELECT revision,kind,actor,reason,at FROM po_cart_job_events WHERE company_id=? AND job_id=? ORDER BY revision').bind(companyId,id),
      this.db.prepare('SELECT revision,status,started_at,released_at FROM po_cart_authorizations WHERE company_id=? AND id=?').bind(companyId,a.id),
      this.db.prepare('SELECT total_minor AS totalMinor,state FROM po_cart_reservations WHERE company_id=? AND authorization_id=?').bind(companyId,a.id),
      this.db.prepare('SELECT product_id,proposal_id,quantity_json,active FROM po_cart_commitments WHERE company_id=? AND authorization_id=? ORDER BY product_id').bind(companyId,a.id),
      this.db.prepare('SELECT revision,kind,actor,reason,at FROM po_cart_events WHERE company_id=? AND authorization_id=? ORDER BY revision').bind(companyId,a.id),
      ...guards.map(g=>this.db.prepare(`SELECT 1 WHERE ${g.sql}`).bind(...g.args)),
    ]);
    const j=this.decode(reads[0].results[0] as JobRow),o=reads[1].results[0] as OwnerRow|undefined;
    const ownership:CartJobOwner|null=o?{jobId:o.job_id,fence:o.fence,workerId:o.worker_id,leaseUntil:o.lease_until}:null;
    const head=reads[5].results[0] as {revision:number;status:typeof a.status;started_at:string|null;released_at:string|null};
    const sourceValid=previousAuthorization.valid&&head.revision===a.revision&&head.status==='authorized'&&head.released_at===null
      &&guards.length>0&&reads.slice(9).every(r=>r.results.length===1);
    const commitments=reads[7].results as {product_id:string;proposal_id:string|null;quantity_json:string;active:number}[];
    const authorization:CartAuthorizationStatus={authorization:{...a,revision:head.revision,status:head.status,startedAt:head.started_at,releasedAt:head.released_at},
      valid:sourceValid,reason:sourceValid?null:previousAuthorization.reason??'Preparation permission or inputs changed; reload or safely cancel.',
      reservation:(reads[6].results[0] as CartAuthorizationStatus['reservation'])??null,
      commitments:commitments.map(c=>({productId:c.product_id,proposalId:c.proposal_id,quantity:JSON.parse(c.quantity_json),active:c.active===1})),
      events:reads[8].results as CartAuthorizationStatus['events']};
    const valid=sourceValid&&['queued','preparing','ready'].includes(j.state)&&o?.job_id===j.id
      &&(j.state!=='preparing'||!!o.lease_until&&o.lease_until>this.now());
    const attempts=(reads[2].results as {id:string;line_id:string;worker_id:string;fence:number;intent_json:string;at:string}[])
      .map(r=>({id:r.id,lineId:r.line_id,workerId:r.worker_id,fence:r.fence,intent:JSON.parse(r.intent_json),at:r.at}));
    const results=(reads[3].results as {attempt_id:string;outcome:CartResult['outcome'];observation_json:string;at:string}[])
      .map(r=>({attemptId:r.attempt_id,outcome:r.outcome,observation:JSON.parse(r.observation_json),at:r.at}));
    const browserEvidence:BrowserEvidence[]=j.browser?(await this.db.prepare('SELECT kind,observation_json,verified,reason,at FROM po_cart_browser_evidence WHERE company_id=? AND job_id=? ORDER BY kind').bind(companyId,id).all<{kind:BrowserEvidence['kind'];observation_json:string;verified:number;reason:string;at:string}>()).results.map(e=>({kind:e.kind,observation:JSON.parse(e.observation_json),verified:e.verified===1,reason:e.reason,at:e.at})):[];
    return frozenCopy({browserEvidence,job:j,valid,reason:valid?null:authorization.reason??'Job is stopped, held or its lease expired; reload or safely cancel.',
      ownership,authorization,attempts,results,events:reads[4].results as CartJobStatus['events']});
  }
  async get(value:unknown){const input=this.parse(cartJobQuerySchema,value),actor=await this.actor(input.companyId);
    const status=await this.status(input.companyId,input.jobId);if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during job read.');return status;}
  async getManager(value:unknown){
    const input=this.parse(managerCartQuerySchema,value),actor=await this.actor(input.companyId);
    let authorization=await this.auth().get({companyId:input.companyId,orderId:input.orderId});
    const row=authorization.authorization?await this.db.prepare('SELECT id FROM po_cart_jobs WHERE company_id=? AND authorization_id=?')
      .bind(input.companyId,authorization.authorization.id).first<{id:string}>():null;
    const status=row?await this.status(input.companyId,row.id):null;
    if(status)authorization=status.authorization;
    if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during manager read.');
    const session=status?await browserSessionSummary(this.db,input.companyId,status.job.id):null;
    const reconciliation=status?await reconciliationSummary(this.db,input.companyId,status.job.id,this.now()):null;
    if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during manager read.');
    return managerCartView(actor,authorization,status,session,this.now(),reconciliation);
  }
  private async replay(companyId:string,operationId:string,fingerprint:string){
    const row=await this.db.prepare('SELECT fingerprint,receipt_json FROM po_cart_job_operations WHERE company_id=? AND operation_id=?')
      .bind(companyId,operationId).first<{fingerprint:string;receipt_json:string}>();
    if(!row)return null;if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another input or actor.');
    return JSON.parse(row.receipt_json) as CartJobReceipt;
  }
  private async result(companyId:string,receipt:CartJobReceipt,manager?:string):Promise<CartJobMutation>{
    await this.workerScope(companyId,receipt.jobId);
    const current=await this.status(companyId,receipt.jobId);
    if(manager&&await this.actor(companyId)!==manager)fail('forbidden','Session changed during job read.');
    await this.options.workerAccess?.assertCurrent();
    return frozenCopy({receipt,current});
  }
  private async commit(companyId:string,fingerprint:string,receipt:CartJobReceipt,guards:Guard[],statements:D1PreparedStatement[],manager?:string,attempt=false){
    if(this.options.workerAccess){
      await this.workerScope(companyId,receipt.jobId);
      const access=this.options.workerAccess;
      guards=[{sql:"NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions h JOIN po_cart_jobs j ON j.company_id=h.company_id AND j.supplier_id=h.supplier_id AND j.account_id=h.account_id WHERE j.company_id=? AND j.id=? AND h.state IN ('requested','opening','open','closing'))",args:[companyId,receipt.jobId]},access.guard(),{sql:'EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=? AND id=? AND supplier_id=? AND account_id=? AND (browser_config_json IS NOT NULL)=?)',
        args:[access.companyId,receipt.jobId,access.supplierId,access.accountId,Number(access.consumerKind==='local_browser')]},...guards];
    }
    if(manager){if(await this.actor(companyId)!==manager)fail('forbidden','Session changed before job commit.');guards=[{sql:MEMBER,args:[companyId,manager]},...guards];}
    if(['heartbeat','beginAttempt','recordResult','recordBaseline','verifyBaseline','finalizeCart','hold'].includes(receipt.action)){
      // Production clock is evaluated by SQLite inside the transaction, after any queueing delay.
      // Tests inject a deterministic server clock; neither clock is supplied by a caller.
      const time=this.options.clock?'?':"strftime('%Y-%m-%dT%H:%M:%fZ','now')";
      guards.push({sql:`EXISTS (SELECT 1 FROM po_cart_owners WHERE company_id=? AND job_id=? AND worker_id=? AND fence=? AND lease_until>${time})`,
        args:[companyId,receipt.jobId,this.worker(),receipt.fence!,...(this.options.clock?[this.now()]:[])]});
    }
    const checks=guards.map(g=>this.db.prepare(`INSERT INTO po_cart_job_operations SELECT ?,?,?,?,'{}',0 WHERE NOT (${g.sql})`)
      .bind(companyId,receipt.operationId,receipt.jobId,fingerprint,...g.args));
    const save=this.db.prepare('INSERT INTO po_cart_job_operations VALUES(?,?,?,?,?,1)').bind(companyId,receipt.operationId,receipt.jobId,fingerprint,JSON.stringify(receipt));
    try{await this.db.batch([...checks,...statements,save]);}
    catch(error){
      await this.options.workerAccess?.assertCurrent();
      if(manager&&await this.actor(companyId)!==manager)fail('forbidden','Session changed during job commit.');
      const replay=await this.replay(companyId,receipt.operationId,fingerprint);
      if(replay){const result=await this.result(companyId,replay,manager);return attempt?{...result,providerCallAllowed:false}:result;}
      if(error instanceof PoCartJobError)throw error;
      fail('conflict','Job ownership, permission, source or lease changed; no job transition committed.');
    }
    const saved=await this.replay(companyId,receipt.operationId,fingerprint);if(!saved)fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.');
    const result=await this.result(companyId,saved,manager);
    if(!attempt)return result;
    // A receipt is history, not a reusable capability. A lost acknowledgement or retry never permits a call.
    const o=result.current.ownership;
    return {...result,providerCallAllowed:result.current.valid&&result.current.job.state==='preparing'
      &&!!o&&o.workerId===this.worker()&&o.fence===receipt.fence};
  }
  private update(j:CartJob,state:CartJob['state'],kind:string,actor:string,reason:string,at:string){return this.db.prepare(`UPDATE po_cart_jobs SET revision=revision+1,state=?,kind=?,actor=?,reason=?,updated_at=? WHERE company_id=? AND id=? AND revision=?`)
    .bind(state,kind,actor,reason,at,j.companyId,j.id,j.revision);}
  async enqueue(value:unknown):Promise<CartJobMutation>{
    const input=this.parse(enqueueCartJobSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return this.result(input.companyId,prior,actor);
    const {authorization:a,guards}=await this.auth().guardedUse(input.companyId,input.authorizationId,actor);
    if(a.revision!==input.expectedRevision||a.startedAt!==null)fail('conflict','Permission revision changed or preparation already started.');
    const id=crypto.randomUUID(),at=this.now(),c=a.inputs.preflight.connection;
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:id,revision:1,action:'enqueue',actor,at};
    return this.commit(input.companyId,fingerprint,receipt,guards,[
      this.db.prepare(`INSERT INTO po_cart_jobs (company_id,id,authorization_id,authorization_revision,inputs_json,supplier_id,account_id,requested_by,revision,state,purchase_state,delivery_state,kind,actor,reason,created_at,updated_at${input.browser?',browser_config_json':''}) VALUES(?,?,?,?,?,?,?,?,1,'queued','not_confirmed','outstanding','enqueue',?,'Fictional preparation queued',?,?${input.browser?',?':''})`)
        .bind(input.companyId,id,a.id,a.revision,JSON.stringify(a.inputs),c.supplierId,c.accountId,actor,actor,at,at,...(input.browser?[JSON.stringify(input.browser)]:[])),
      this.db.prepare(`INSERT INTO po_cart_owners VALUES(?,?,?,?,0,NULL,NULL)
        ON CONFLICT(company_id,supplier_id,account_id) DO UPDATE SET job_id=excluded.job_id,fence=po_cart_owners.fence+1
        WHERE po_cart_owners.job_id IS NULL`).bind(input.companyId,c.supplierId,c.accountId,id),
      // An occupied cart makes the entire enqueue fail, including the inserted job and event.
      this.db.prepare(`INSERT INTO po_cart_job_operations SELECT ?,?,?,?,'{}',0 WHERE NOT EXISTS (
        SELECT 1 FROM po_cart_owners WHERE company_id=? AND supplier_id=? AND account_id=? AND job_id=?)`)
        .bind(input.companyId,input.operationId,id,fingerprint,input.companyId,c.supplierId,c.accountId,id),
    ],actor);
  }
  async cancel(value:unknown):Promise<CartJobMutation>{
    const input=this.parse(cancelCartJobSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return this.result(input.companyId,prior,actor);
    const j=this.decode(await this.row(input.companyId,input.jobId));
    if(j.revision!==input.expectedRevision||j.state==='canceled')fail('conflict','Job revision or status changed.');
    const at=this.now(),transition=await this.auth().guardedTransition(j.companyId,j.authorizationId,actor,'cancel',at,input.reason);
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'cancel',actor,at};
    // Permission-change triggers perform the job transition and safe lock release, including through the old API.
    return this.commit(j.companyId,fingerprint,receipt,[this.state(j),...transition.guards],transition.statements,actor);
  }
  private async context(value:unknown,schema:z.ZodType<{companyId:string;jobId:string;operationId:string;fence?:number}>,action:string){
    const input=this.parse(schema,value),worker=this.worker(),actor=`worker:${worker}`,fingerprint=canonicalJson({actor,action,input});
    await this.workerScope(input.companyId,input.jobId);
    const prior=await this.replay(input.companyId,input.operationId,fingerprint);
    const j=this.decode(await this.row(input.companyId,input.jobId)),o=await this.owner(j);
    if(j.browser&&!this.options.workerAccess)fail('forbidden','Authenticated browser consumer required.');
    return {input,worker,actor,fingerprint,prior,j,o};
  }
  private lease(j:CartJob,o:OwnerRow|null,worker:string,fence:number|undefined,at:string){
    if(j.state!=='preparing'||!o||o.job_id!==j.id||o.worker_id!==worker||o.fence!==fence||!o.lease_until||o.lease_until<=at)
      fail('conflict','Worker no longer owns an active job lease.');
    return [this.state(j),this.ownership(j,o),{sql:'? > ?',args:[o.lease_until,at]}] as Guard[];
  }
  async claim(value:unknown){
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(value,workerCartJobSchema,'claim');
    if(prior)return this.result(input.companyId,prior);
    if(j.state!=='queued'||!o||o.job_id!==j.id||o.worker_id!==null||o.lease_until!==null)fail('conflict','Job is not available to claim.');
    const use=await this.use(j),at=this.now(),fence=o.fence+1,lease=new Date(Date.parse(at)+CART_LEASE_MS).toISOString();
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'claim',actor,at,fence};
    return this.commit(j.companyId,fingerprint,receipt,[this.state(j),this.ownership(j,o),...use.guards],[
      this.db.prepare('UPDATE po_cart_owners SET worker_id=?,lease_until=?,fence=? WHERE company_id=? AND job_id=?').bind(worker,lease,fence,j.companyId,j.id),
      this.update(j,'preparing','claim',actor,'Worker claimed fictional preparation',at)]);
  }
  async heartbeat(value:unknown){
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(value,fencedCartJobSchema,'heartbeat');if(prior)return this.result(input.companyId,prior);
    const use=await this.use(j),at=this.now(),guards=this.lease(j,o,worker,input.fence,at),lease=new Date(Date.parse(at)+CART_LEASE_MS).toISOString();
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'heartbeat',actor,at,fence:o!.fence};
    return this.commit(j.companyId,fingerprint,receipt,[...guards,...use.guards],[
      this.db.prepare('UPDATE po_cart_owners SET lease_until=? WHERE company_id=? AND job_id=?').bind(lease,j.companyId,j.id),
      this.update(j,'preparing','heartbeat',actor,'Worker lease renewed',at)]);
  }
  async beginAttempt(value:unknown):Promise<CartAttemptGrant>{
    const parsed=this.parse(beginCartAttemptSchema,value);
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(parsed,beginCartAttemptSchema,'beginAttempt');
    if(prior)return {...await this.result(input.companyId,prior),providerCallAllowed:false};
    const line=j.inputs.preflight.lines.find(l=>l.lineId===parsed.lineId);if(!line)fail('invalid_request','Line is not in the authorized job.');
    if(j.browser&&!await this.db.prepare("SELECT 1 FROM po_cart_browser_evidence WHERE company_id=? AND job_id=? AND kind='baseline' AND verified=1").bind(j.companyId,j.id).first())fail('conflict','Verified baseline required before additions.');
    const at=this.now(),guards=this.lease(j,o,worker,input.fence,at);
    const transition=await this.auth().guardedTransition(j.companyId,j.authorizationId,j.requestedBy,'start',at,'First recorded cart attempt; exposure retained');
    const attemptId=crypto.randomUUID(),receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'beginAttempt',actor,at,fence:o!.fence,attemptId};
    const result=await this.commit(j.companyId,fingerprint,receipt,[...guards,...transition.guards],[...transition.statements,
      this.db.prepare('INSERT INTO po_cart_attempts VALUES(?,?,?,?,?,?,?,?)').bind(j.companyId,j.id,attemptId,line.lineId,worker,o!.fence,JSON.stringify(line),at),
      this.update(j,'preparing','beginAttempt',actor,'Attempt saved before provider call',at)],undefined,true);
    return {...result,providerCallAllowed:'providerCallAllowed' in result&&result.providerCallAllowed===true};
  }
  async recordResult(value:unknown){
    const parsed=this.parse(cartResultSchema,value);
    if(JSON.stringify(parsed.observation??null).length>10_000)fail('invalid_request','Observation is too large.');
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(parsed,cartResultSchema,'recordResult');if(prior)return this.result(input.companyId,prior);
    const use=await this.use(j),at=this.now(),guards=this.lease(j,o,worker,input.fence,at);
    const attempt=await this.db.prepare('SELECT intent_json FROM po_cart_attempts WHERE company_id=? AND job_id=? AND id=? AND worker_id=? AND fence=?')
      .bind(j.companyId,j.id,parsed.attemptId,worker,o!.fence).first<{intent_json:string}>();
    if(!attempt)fail('conflict','Matching attempt is required before a result.');
    const exact=canonicalJson(parsed.observation??null)===canonicalJson(JSON.parse(attempt.intent_json));
    const outcome=parsed.outcome==='verified'&&!exact?'rejected':parsed.outcome;
    const count=await this.db.prepare("SELECT COUNT(*) AS n FROM po_cart_results WHERE company_id=? AND job_id=? AND outcome='verified'")
      .bind(j.companyId,j.id).first<{n:number}>();
    const state=outcome!=='verified'?'review_needed':!j.browser&&count!.n+1===j.inputs.preflight.lines.length?'ready':'preparing';
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'recordResult',actor,at,fence:o!.fence,attemptId:parsed.attemptId};
    const statements=[this.db.prepare('INSERT INTO po_cart_results VALUES(?,?,?,?,?,?)').bind(j.companyId,j.id,parsed.attemptId,outcome,
      outcome==='verified'?attempt.intent_json:JSON.stringify(parsed.observation??null),at),
      this.update(j,state,'recordResult',actor,outcome==='verified'?'Exact fictional line verified':'Provider outcome needs review',at)];
    if(state!=='preparing')statements.push(this.db.prepare('UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1 WHERE company_id=? AND job_id=?').bind(j.companyId,j.id));
    return this.commit(j.companyId,fingerprint,receipt,[...guards,...use.guards],statements);
  }
  async recordBaseline(value:unknown){return this.browserEvidence(value,'baseline');}
  async finalizeCart(value:unknown){return this.browserEvidence(value,'final');}
  async verifyBaseline(value:unknown){
    const parsed=this.parse(browserCartEvidenceSchema,value);
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(parsed,browserCartEvidenceSchema,'verifyBaseline');
    if(prior)return this.result(input.companyId,prior);
    if(!j.browser)fail('conflict','Browser job required.');
    const use=await this.use(j),at=this.now(),guards=this.lease(j,o,worker,input.fence,at);
    const baseline=await this.db.prepare("SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=? AND job_id=? AND kind='baseline' AND verified=1").bind(j.companyId,j.id).first<{observation_json:string}>();
    const sorted=(cart:typeof parsed.cart)=>canonicalJson([...cart].sort((a,b)=>a.sku.localeCompare(b.sku)));
    const verified=!!baseline&&checkBrowserCart('baseline',parsed.cart,j.inputs.preflight)==='verified'&&sorted(JSON.parse(baseline.observation_json))===sorted(parsed.cart);
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'verifyBaseline',actor,at,fence:o!.fence};
    const statements=[this.update(j,verified?'preparing':'review_needed','verifyBaseline',actor,verified?'Immutable baseline reverified':'Baseline changed; review required',at)];
    if(!verified)statements.push(this.db.prepare('UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1 WHERE company_id=? AND job_id=?').bind(j.companyId,j.id));
    return this.commit(j.companyId,fingerprint,receipt,[...guards,...use.guards,{sql:'NOT EXISTS (SELECT 1 FROM po_cart_attempts WHERE company_id=? AND job_id=?)',args:[j.companyId,j.id]}],statements);
  }

  private async browserEvidence(value:unknown,kind:'baseline'|'final'){
    const parsed=this.parse(browserCartEvidenceSchema,value),action=kind==='baseline'?'recordBaseline':'finalizeCart';
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(parsed,browserCartEvidenceSchema,action);
    if(prior)return this.result(input.companyId,prior);
    if(!j.browser)fail('conflict','Browser job required.');
    const use=await this.use(j),at=this.now(),guards=this.lease(j,o,worker,input.fence,at);
    const baseline=await this.db.prepare("SELECT observation_json FROM po_cart_browser_evidence WHERE company_id=? AND job_id=? AND kind='baseline' AND verified=1")
      .bind(j.companyId,j.id).first<{observation_json:string}>();
    const reason=checkBrowserCart(kind,parsed.cart,j.inputs.preflight,baseline?JSON.parse(baseline.observation_json):[]),verified=reason==='verified';
    const state=!verified?'review_needed':kind==='final'?'ready':'preparing';
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action,actor,at,fence:o!.fence};
    const statements=[this.db.prepare('INSERT INTO po_cart_browser_evidence VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(j.companyId,j.id,kind,JSON.stringify(parsed.cart),Number(verified),reason,worker,o!.fence,at),
      this.update(j,state,action,actor,reason,at)];
    if(state!=='preparing')statements.push(this.db.prepare('UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1 WHERE company_id=? AND job_id=?').bind(j.companyId,j.id));
    return this.commit(j.companyId,fingerprint,receipt,[...guards,...use.guards],statements);
  }
  async hold(value:unknown){
    const parsed=this.parse(browserCartHoldSchema,value);
    const {input,worker,actor,fingerprint,prior,j,o}=await this.context(parsed,browserCartHoldSchema,'hold');
    if(prior)return this.result(input.companyId,prior);
    if(!j.browser)fail('conflict','Browser job required.');
    const use=await this.use(j),at=this.now(),guards=this.lease(j,o,worker,input.fence,at);
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'hold',actor,at,fence:o!.fence};
    return this.commit(j.companyId,fingerprint,receipt,[...guards,...use.guards],[this.update(j,'review_needed','hold',actor,parsed.reason,at),
      this.db.prepare('UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1 WHERE company_id=? AND job_id=?').bind(j.companyId,j.id)]);
  }
  async recoverExpired(value:unknown){
    const {input,actor,fingerprint,prior,j,o}=await this.context(value,workerCartJobSchema,'recoverExpired');if(prior)return this.result(input.companyId,prior);
    const at=this.now();if(j.state!=='preparing'||!o||o.job_id!==j.id||!o.lease_until||o.lease_until>at)fail('conflict','No expired job lease to recover.');
    const attempts=await this.db.prepare('SELECT COUNT(*) AS n FROM po_cart_attempts WHERE company_id=? AND job_id=?').bind(j.companyId,j.id).first<{n:number}>();
    let guards=[this.state(j),this.ownership(j,o)],state:CartJob['state']='review_needed';
    if(attempts!.n===0){
      try{const use=await this.use(j);guards.push(...use.guards);if(use.authorization.startedAt===null)state='queued';}catch(e){if(!known(e))throw e;}
    }
    const receipt:CartJobReceipt={operationId:input.operationId,jobId:j.id,revision:j.revision+1,action:'recoverExpired',actor,at,fence:o.fence+1};
    return this.commit(j.companyId,fingerprint,receipt,guards,[
      this.update(j,state,'recoverExpired',actor,state==='queued'?'Never-attempted job recovered':'Expired attempted or stale work requires review',at),
      this.db.prepare('UPDATE po_cart_owners SET worker_id=NULL,lease_until=NULL,fence=fence+1 WHERE company_id=? AND job_id=?').bind(j.companyId,j.id)]);
  }
}
