import {z} from 'zod';
import {D1PurchaseOrderDrafts} from './d1-purchase-order-drafts';
import {type CloverReviewPolicy} from './d1-replenishment-clover-source';
import {canonicalJson, frozenCopy} from './supplier-simulation-contract';
import {preparationPreflight, preparationConnectionSchema, type PreparationConnection} from './po-cart-preparation-contract';
import {PurchaseOrderError} from './purchase-order-contract';
import {CartPreparationError} from './po-cart-preparation-contract';
import {SupplierRegistryError} from './purchasing-supplier-contract';
import {authorizeCartSchema,cartAuthorizationQuerySchema,cancelCartAuthorizationSchema,startCartPreparationSchema,
  cartAuthorizationFail as fail,PoCartAuthorizationError,type CartAuthorization,type CartAuthorizationPayload,
  type CartAuthorizationStatus,type CartAuthorizationReceipt,type CartAuthorizationResult,type CartAuthorizationCommand,
  type CartBudgetPolicy} from './po-cart-authorization-contract';

export type CartAuthorizationGuard={sql:string;args:(string|number|null)[]};
type Guard=CartAuthorizationGuard;
type Row={company_id:string;id:string;order_id:string;generation:number;revision:number;status:CartAuthorization['status'];
  payload_json:string;created_at:string;started_at:string|null;released_at:string|null};
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";

/** Fictional-only durable permission. No network, jobs, checkout, stock or incoming writer. */
export class D1PoCartAuthorizations {
  constructor(private readonly db:D1Database,private readonly options:{
    identity:()=>Promise<string|null>;clock?:{now():Date};salesPolicy?:CloverReviewPolicy;
  }) {}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  private parse<T>(schema:z.ZodType<T>,value:unknown):T {
    const parsed=schema.safeParse(value);
    if(!parsed.success)fail('invalid_request','Choose a saved PO or authorization, expected revision and UUID operation identity.');
    return parsed.data;
  }
  private async actor(companyId:string):Promise<string> {
    const actor=await this.options.identity();
    if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(companyId,actor).first())
      fail('forbidden','Current owner or manager membership is required.');
    return actor;
  }
  private drafts(actor:string){return new D1PurchaseOrderDrafts(this.db,{...this.options,identity:async()=>actor});}
  private async row(companyId:string,id:string):Promise<Row> {
    const row=await this.db.prepare('SELECT * FROM po_cart_authorizations WHERE company_id=? AND id=?').bind(companyId,id).first<Row>();
    if(!row)fail('missing','Preparation authorization not found.');return row;
  }
  private decode(row:Row):CartAuthorization {
    return frozenCopy({companyId:row.company_id,id:row.id,orderId:row.order_id,generation:row.generation,revision:row.revision,status:row.status,
      inputs:JSON.parse(row.payload_json) as CartAuthorizationPayload,createdAt:row.created_at,startedAt:row.started_at,releasedAt:row.released_at});
  }
  private async connection(companyId:string):Promise<PreparationConnection> {
    // No default configuration: only one current matching fictional connection is usable.
    const rows=await this.db.prepare(`SELECT c.data_json FROM po_cart_connections c WHERE company_id=?
      AND version=(SELECT MAX(version) FROM po_cart_connections WHERE company_id=c.company_id AND id=c.id)
      AND json_extract(data_json,'$.supplierId')='cart-demo-supplier'
      AND json_extract(data_json,'$.accountId')='DEMO-CART' AND json_extract(data_json,'$.locationId')='DEMO-CAFE' LIMIT 2`)
      .bind(companyId).all<{data_json:string}>();
    if(rows.results.length!==1)fail('source_changed','A unique persisted fictional connection is required.');
    const connection=JSON.parse(rows.results[0].data_json) as PreparationConnection;
    if(!preparationConnectionSchema.safeParse(connection).success)fail('source_changed','Fictional connection needs review.');
    return connection;
  }
  private async policy(companyId:string):Promise<CartBudgetPolicy> {
    const policy=await this.db.prepare(`SELECT version,per_order_minor AS perOrderMinor,outstanding_minor AS outstandingMinor
      FROM po_cart_budget_policies WHERE company_id=? ORDER BY version DESC LIMIT 1`).bind(companyId).first<CartBudgetPolicy>();
    if(!policy)fail('policy_missing','An explicit fictional cart budget policy is required.');return policy;
  }
  private async inputGuards(inputs:CartAuthorizationPayload,actor:string):Promise<Guard[]> {
    const {preflight:p,snapshot:s,policy}=inputs,companyId=p.request.companyId;
    const guards:Guard[]=[{sql:MEMBER,args:[companyId,actor]},{sql:MEMBER,args:[companyId,p.actor]},
      {sql:`EXISTS (SELECT 1 FROM purchase_order_drafts WHERE company_id=? AND id=? AND status='reviewed' AND revision=? AND snapshot_json=?)`,
        args:[companyId,p.request.orderId,p.request.expectedRevision,JSON.stringify(s)]},
      {sql:`EXISTS (SELECT 1 FROM po_cart_connections c WHERE company_id=? AND id=? AND version=? AND json(data_json)=json(?)
        AND version=(SELECT MAX(version) FROM po_cart_connections WHERE company_id=c.company_id AND id=c.id))`,
        args:[companyId,p.connection.id,p.connection.version,JSON.stringify(p.connection)]},
      {sql:`1=(SELECT COUNT(*) FROM po_cart_connections c WHERE company_id=?
        AND version=(SELECT MAX(version) FROM po_cart_connections WHERE company_id=c.company_id AND id=c.id)
        AND json_extract(data_json,'$.supplierId')='cart-demo-supplier' AND json_extract(data_json,'$.accountId')='DEMO-CART'
        AND json_extract(data_json,'$.locationId')='DEMO-CAFE')`,args:[companyId]},
      {sql:`EXISTS (SELECT 1 FROM po_cart_budget_policies WHERE company_id=? AND version=? AND per_order_minor=? AND outstanding_minor=?
        AND version=(SELECT MAX(version) FROM po_cart_budget_policies WHERE company_id=?))`,
        args:[companyId,policy.version,policy.perOrderMinor,policy.outstandingMinor,companyId]}];
    const currentConnection=await this.connection(companyId);
    if(canonicalJson(currentConnection)!==canonicalJson(p.connection)||canonicalJson(await this.policy(companyId))!==canonicalJson(policy))
      fail('source_changed','Connection or budget policy changed.');
    const order=await this.drafts(actor).get(companyId,p.request.orderId);
    const fresh=preparationPreflight(p.request,p.actor,order,currentConnection);
    if(canonicalJson(fresh)!==canonicalJson(p))fail('source_changed','Reviewed preparation inputs changed.');
    guards.push(...await this.drafts(actor).sourceGuards(s,actor));
    for(const line of p.lines){
      if(line.kind!=='stock')continue;
      // Registry pack conversions can differ from the inventory default pack.
      guards.push({sql:`EXISTS (SELECT 1 FROM inventory_config_versions c JOIN product_unit_versions u
        ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
        WHERE c.company_id=? AND c.product_id=? AND c.id=? AND c.version=? AND c.status='active' AND u.dimension=?)`,
        args:[companyId,line.productId!,line.configId!,line.configVersion!,line.stockQuantity!.dimension]});
    }
    return guards;
  }
  private async assertGuards(guards:Guard[]):Promise<void> {
    for(const guard of guards){
      if(!await this.db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first())
        fail('source_changed','PO, source, membership or policy changed.');
    }
  }
  private async receipt(companyId:string,operationId:string,fingerprint:string):Promise<CartAuthorizationReceipt|null> {
    const row=await this.db.prepare('SELECT fingerprint,receipt_json FROM po_cart_operations WHERE company_id=? AND operation_id=?')
      .bind(companyId,operationId).first<{fingerprint:string;receipt_json:string}>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another request or actor.');
    return frozenCopy(JSON.parse(row.receipt_json) as CartAuthorizationReceipt);
  }
  private stateGuard(a:CartAuthorization):Guard {
    return {sql:'EXISTS (SELECT 1 FROM po_cart_authorizations WHERE company_id=? AND id=? AND revision=? AND status=?)',
      args:[a.companyId,a.id,a.revision,a.status]};
  }
  private async status(row:Row,actor:string,verifySession=true):Promise<CartAuthorizationStatus> {
    const initial=this.decode(row);let guards:Guard[]=[],reason:string|null=null;
    if(initial.status==='authorized'&&initial.releasedAt===null)
      try {guards=[this.stateGuard(initial),...await this.inputGuards(initial.inputs,actor)];}
    catch(error){
      if(!(error instanceof PoCartAuthorizationError||error instanceof PurchaseOrderError||error instanceof CartPreparationError||error instanceof SupplierRegistryError))throw error;
      reason='Preparation inputs or authorizing membership changed; review or safely cancel.';
    }
    // Read current head, claims, audit and validity predicates in one database snapshot.
    // A cancellation between source reads must not return old permission as current.
    const reads=await this.db.batch([
      this.db.prepare('SELECT * FROM po_cart_authorizations WHERE company_id=? AND id=?').bind(row.company_id,row.id),
      this.db.prepare('SELECT total_minor AS totalMinor,state FROM po_cart_reservations WHERE company_id=? AND authorization_id=?').bind(row.company_id,row.id),
      this.db.prepare('SELECT product_id,proposal_id,quantity_json,active FROM po_cart_commitments WHERE company_id=? AND authorization_id=? ORDER BY product_id').bind(row.company_id,row.id),
      this.db.prepare('SELECT revision,kind,actor,reason,at FROM po_cart_events WHERE company_id=? AND authorization_id=? ORDER BY revision').bind(row.company_id,row.id),
      ...guards.map(g=>this.db.prepare(`SELECT 1 WHERE ${g.sql}`).bind(...g.args)),
    ]);
    const latest=reads[0].results[0] as Row|undefined;
    if(!latest)fail('missing','Preparation authorization not found.');
    const authorization=this.decode(latest),reservation=reads[1].results[0] as CartAuthorizationStatus['reservation'];
    const commitments=reads[2].results as {product_id:string;proposal_id:string|null;quantity_json:string;active:number}[];
    const events=reads[3].results as CartAuthorizationStatus['events'][number][];
    const valid=authorization.status==='authorized'&&authorization.releasedAt===null&&guards.length>0&&reads.slice(4).every(r=>r.results.length===1);
    if(!valid)reason=authorization.status!=='authorized'||authorization.releasedAt!==null?'Preparation permission is no longer active.':
      reason??'Preparation inputs changed during the read; reload or safely cancel.';
    if(verifySession&&await this.actor(row.company_id)!==actor)fail('forbidden','Session changed during authorization read.');
    return frozenCopy({authorization,valid,reason,reservation:reservation??null,commitments:commitments.map(c=>({productId:c.product_id,
      proposalId:c.proposal_id,quantity:JSON.parse(c.quantity_json),active:c.active===1})),events});
  }
  async get(value:unknown):Promise<CartAuthorizationStatus> {
    const input=this.parse(cartAuthorizationQuerySchema,value),actor=await this.actor(input.companyId);
    await this.drafts(actor).get(input.companyId,input.orderId);
    const row=await this.db.prepare(`SELECT * FROM po_cart_authorizations WHERE company_id=? AND order_id=?
      ORDER BY (released_at IS NULL) DESC,generation DESC LIMIT 1`).bind(input.companyId,input.orderId).first<Row>();
    if(row)return this.status(row,actor);
    if(await this.actor(input.companyId)!==actor)fail('forbidden','Session changed during authorization read.');
    return frozenCopy({authorization:null,valid:false,reason:'Preparation authorization is required.',reservation:null,commitments:[],events:[]});
  }
  private async result(companyId:string,receipt:CartAuthorizationReceipt,actor:string):Promise<CartAuthorizationResult> {
    return frozenCopy({receipt,current:await this.status(await this.row(companyId,receipt.authorizationId),actor)});
  }
  private async commit(companyId:string,operationId:string,actor:string,fingerprint:string,
    receipt:CartAuthorizationReceipt,guards:Guard[],statements:D1PreparedStatement[],create=false):Promise<CartAuthorizationResult> {
    if(await this.actor(companyId)!==actor)fail('forbidden','Session changed before authorization commit.');
    const checks=[{sql:MEMBER,args:[companyId,actor]},...guards].map(g=>this.db.prepare(`INSERT INTO po_cart_operations
      (company_id,operation_id,authorization_id,fingerprint,receipt_json,write_guard) SELECT ?,?,?,?,'{}',0 WHERE NOT (${g.sql})`)
      .bind(companyId,operationId,receipt.authorizationId,fingerprint,...g.args));
    const saved=this.db.prepare(`INSERT INTO po_cart_operations(company_id,operation_id,authorization_id,fingerprint,receipt_json,write_guard)
      VALUES (?,?,?,?,?,1)`).bind(companyId,operationId,receipt.authorizationId,fingerprint,JSON.stringify(receipt));
    try {await this.db.batch(create?[...checks,...statements,saved]:[...checks,saved,...statements]);}
    catch {
      if(await this.actor(companyId)!==actor)fail('forbidden','Session changed during authorization commit.');
      const replay=await this.receipt(companyId,operationId,fingerprint);if(replay)return this.result(companyId,replay,actor);
      fail('conflict','Authorization, source, product commitment or budget changed; no authorization change committed.');
    }
    const replay=await this.receipt(companyId,operationId,fingerprint);
    if(!replay)fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.');
    return this.result(companyId,replay,actor);
  }
  async authorize(value:unknown):Promise<CartAuthorizationResult> {
    const input=this.parse(authorizeCartSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.receipt(input.companyId,input.operationId,fingerprint);if(prior)return this.result(input.companyId,prior,actor);
    const {action:_action,...request}=input;
    const order=await this.drafts(actor).get(input.companyId,input.orderId),connection=await this.connection(input.companyId),policy=await this.policy(input.companyId);
    const preflight=preparationPreflight(request,actor,order,connection);
    if(BigInt(preflight.capMinor)>BigInt(policy.perOrderMinor))fail('conflict','Proposed cap exceeds the fictional per-order policy.');
    const payload:CartAuthorizationPayload={preflight,snapshot:order.snapshot,policy},guards=await this.inputGuards(payload,actor);
    await this.assertGuards(guards);
    const at=this.now(),id=crypto.randomUUID();
    const receipt:CartAuthorizationReceipt={operationId:input.operationId,authorizationId:id,revision:1,action:'authorize',actor,at};
    return this.commit(input.companyId,input.operationId,actor,fingerprint,receipt,guards,[
      this.db.prepare(`INSERT INTO po_cart_authorizations(company_id,id,order_id,generation,revision,status,connection_id,connection_version,policy_version,payload_json,created_at)
        VALUES (?,?,?,(SELECT COALESCE(MAX(generation),0)+1 FROM po_cart_authorizations WHERE company_id=? AND order_id=?),1,'authorized',?,?,?,?,?)`)
        .bind(input.companyId,id,input.orderId,input.companyId,input.orderId,connection.id,connection.version,policy.version,JSON.stringify(payload),at),
      this.event(input.companyId,id,1,'authorize',actor,'Manager authorized fictional preparation; no order placed',at),
    ],true);
  }
  private event(companyId:string,id:string,revision:number,kind:string,actor:string,reason:string,at:string){
    return this.db.prepare('INSERT INTO po_cart_events(company_id,authorization_id,revision,kind,actor,reason,at) VALUES (?,?,?,?,?,?,?)')
      .bind(companyId,id,revision,kind,actor,reason,at);
  }
  async cancel(value:unknown):Promise<CartAuthorizationResult> {
    return this.transition(this.parse(cancelCartAuthorizationSchema,value));
  }
  /** Internal only, before a future consumer's first attempted mutation. Not a job/lease. */
  async markPreparationStarted(value:unknown):Promise<CartAuthorizationResult> {
    return this.transition(this.parse(startCartPreparationSchema,value));
  }
  private async transition(input:CartAuthorizationCommand):Promise<CartAuthorizationResult> {
    const actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.receipt(input.companyId,input.operationId,fingerprint);if(prior)return this.result(input.companyId,prior,actor);
    const a=this.decode(await this.row(input.companyId,input.authorizationId));
    if(a.revision!==input.expectedRevision||a.status==='canceled')fail('conflict','Authorization revision or status changed.');
    const guards=[this.stateGuard(a)],at=this.now(),revision=a.revision+1;
    if(input.action==='start'){
      if(a.status!=='authorized'||a.startedAt!==null||a.releasedAt!==null)fail('conflict','Preparation permission cannot start.');
      guards.push(...await this.inputGuards(a.inputs,actor));await this.assertGuards(guards);
    }
    const receipt:CartAuthorizationReceipt={operationId:input.operationId,authorizationId:a.id,revision,action:input.action,actor,at};
    const statement=input.action==='start'?this.db.prepare(`UPDATE po_cart_authorizations SET revision=revision+1,started_at=? WHERE company_id=? AND id=? AND revision=?`)
      .bind(at,input.companyId,a.id,input.expectedRevision):this.db.prepare(`UPDATE po_cart_authorizations SET revision=revision+1,status='canceled',
        released_at=CASE WHEN started_at IS NULL THEN COALESCE(released_at,?) ELSE NULL END WHERE company_id=? AND id=? AND revision=?`)
        .bind(at,input.companyId,a.id,input.expectedRevision);
    return this.commit(input.companyId,input.operationId,actor,fingerprint,receipt,guards,[
      this.event(input.companyId,a.id,revision,input.action,actor,input.action==='cancel'?input.reason:'Preparation started; unresolved exposure must be retained',at),statement]);
  }
  /** Advisory read only. Future external writes additionally require guarded transitions and fencing. */
  async revalidate(companyId:string,authorizationId:string):Promise<CartAuthorization> {
    const actor=await this.actor(companyId),row=await this.row(companyId,authorizationId),status=await this.status(row,actor);
    if(!status.valid)fail('source_changed',status.reason!);return status.authorization!;
  }
  /** Internal composition boundary. Predicates MUST run inside the consumer's final batch. */
  async guardedUse(companyId:string,authorizationId:string,actor:string){
    const authorization=this.decode(await this.row(companyId,authorizationId));
    if(authorization.status!=='authorized'||authorization.releasedAt!==null)
      fail('source_changed','Preparation permission is no longer active.');
    return {authorization,guards:[this.stateGuard(authorization),...await this.inputGuards(authorization.inputs,actor)]};
  }
  /** Internal worker status, including held work after author membership revocation. No route exposure. */
  async consumerStatus(companyId:string,authorizationId:string,actor:string){
    return this.status(await this.row(companyId,authorizationId),actor,false);
  }
  /** Compose permission start/cancel, audit and consumer mutations in one transaction. */
  async guardedTransition(companyId:string,authorizationId:string,actor:string,kind:'start'|'cancel',at:string,reason:string){
    const authorization=this.decode(await this.row(companyId,authorizationId));
    if(authorization.status==='canceled')fail('conflict','Preparation permission is canceled.');
    const guards=kind==='start'?(await this.guardedUse(companyId,authorizationId,actor)).guards:[this.stateGuard(authorization)];
    const statements:D1PreparedStatement[]=[];
    if(kind==='start'&&authorization.startedAt===null){
      statements.push(this.db.prepare('UPDATE po_cart_authorizations SET revision=revision+1,started_at=? WHERE company_id=? AND id=? AND revision=?')
        .bind(at,companyId,authorizationId,authorization.revision),this.event(companyId,authorizationId,authorization.revision+1,kind,actor,reason,at));
    }else if(kind==='cancel'){
      // Save audit first: the job invalidation trigger consumes this same revision's actor/time.
      statements.push(this.event(companyId,authorizationId,authorization.revision+1,kind,actor,reason,at),
        this.db.prepare(`UPDATE po_cart_authorizations SET revision=revision+1,status='canceled',
          released_at = CASE WHEN started_at IS NULL THEN ? ELSE NULL END WHERE company_id=? AND id=? AND revision=?`)
          .bind(at,companyId,authorizationId,authorization.revision));
    }
    return {authorization,guards,statements};
  }
}
