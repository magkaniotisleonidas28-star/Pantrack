import {D1ReplenishmentProposalOrigins} from './d1-replenishment-proposal-origins';
import {buildProposalHandoff, type ProposalHandoff, type ProposalStatus, type ProposalPackEdit} from './replenishment-lifecycle';
import {cloverSourceGuard, type CloverReviewPolicy} from './d1-replenishment-clover-source';
import {isFakeSupplierConnector, type FakeSupplierConnector} from './fake-supplier-connector';
import {canonicalJson, frozenCopy, fail, supplierId, supplierSource, validateSupplierQuote,
  matchingSupplierResult, moneyMinor, type SupplierSource, type SupplierQuote, type SupplierOrderStatus} from './supplier-simulation-contract';

type Clock = {now(): Date};
/** Server integration must supply authenticated identity, never a role from the command. */
export type SupplierSimulationOptions = Readonly<{
  identity: () => Promise<string | null>;
  connector: FakeSupplierConnector;
  fixtureLimits: () => Readonly<{perOrderMinor: number; perUtcDayMinor: number}>;
  clock?: Clock;
  salesPolicy?: CloverReviewPolicy;
}>;
type OrderRow = {company_id: string; id: string; source_json: string; status: SupplierOrderStatus; revision: number;
  quote_id: string | null; approval_id: string | null; send_operation_id: string | null; external_id: string | null;
  created_at: string; updated_at: string};
export type SupplierSimulationOrder = Readonly<{companyId: string; id: string; status: SupplierOrderStatus; revision: number;
  source: SupplierSource; quote: SupplierQuote | null; approvalId: string | null; externalId: string | null; provenance:'simulated'}>;
export type SupplierSimulationCommand = Readonly<{companyId: string; orderId: string; operationId: string; expectedRevision: number}>;
type Guard = {sql: string; args: (string | number)[]; checks?: Guard[]};
type CommandContext = {actor: string; fingerprint: string; at: string; replay: SupplierSimulationOrder | null};
type ReceiptRow = {fingerprint: string; result_json: string};
const allowedBeforeSend = ['awaiting_quote','awaiting_approval','approved'];
const MEMBER = "EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";

/** Durable, network-free C4 engine. Nothing here is wired to a route or purchasing. */
export class D1SupplierSimulation {
  private readonly clock: Clock;
  private readonly origins: D1ReplenishmentProposalOrigins;
  constructor(private readonly db: D1Database, private readonly options: SupplierSimulationOptions) {
    if (!isFakeSupplierConnector(options.connector)) fail('simulation_only', 'Only a registered fictional connector is allowed.');
    this.options = Object.freeze({...options});
    this.clock = options.clock ?? {now: () => new Date()};
    this.origins = new D1ReplenishmentProposalOrigins(db);
    this.limits();
  }
  private limits(): {perOrderMinor: number; perUtcDayMinor: number} {
    const limits = this.options.fixtureLimits();
    if (!limits || !moneyMinor.safeParse(limits.perOrderMinor).success || !moneyMinor.safeParse(limits.perUtcDayMinor).success) fail('invalid_request', 'Explicit bounded USD fixture limits are required.');
    return {...limits};
  }
  private async actor(companyId: string): Promise<string> {
    if (!supplierId.safeParse(companyId).success) fail('invalid_request', 'Invalid company.');
    const userId = await this.options.identity();
    if (!userId || !supplierId.safeParse(userId).success) fail('forbidden', 'Sign-in is required.');
    const member = await this.db.prepare(`SELECT 1 AS allowed WHERE ${MEMBER}`).bind(companyId,userId).first();
    if (!member) fail('forbidden', 'Owner or manager membership is required.');
    return userId;
  }
  private now(): string {
    const date = this.clock.now();
    if (!Number.isFinite(date.getTime())) fail('invalid_request', 'Invalid clock.');
    return date.toISOString();
  }
  private async receipt(companyId: string, operationId: string, fingerprint: string): Promise<SupplierSimulationOrder | null> {
    const row = await this.db.prepare('SELECT fingerprint,result_json FROM supplier_simulation_operations WHERE company_id=? AND operation_id=?')
      .bind(companyId,operationId).first<ReceiptRow>();
    if (!row) return null;
    if (row.fingerprint !== fingerprint) fail('conflict', 'Operation ID already represents a different command or actor.');
    return frozenCopy(JSON.parse(row.result_json) as SupplierSimulationOrder);
  }
  private async context(kind: string, input: {companyId: string; orderId: string; operationId: string}, payload: unknown): Promise<CommandContext> {
    const actor = await this.actor(input.companyId);
    const fields = kind === 'create' ? ['companyId','orderId','operationId','handoffs'] :
      ['companyId','orderId','operationId','expectedRevision',...(kind === 'approve' ? ['quoteFingerprint'] : kind === 'cancel' ? ['reason'] : [])];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== fields.length ||
        !fields.every(field => Object.prototype.hasOwnProperty.call(payload,field))) fail('invalid_request', 'Unexpected or missing command field.');
    if (!supplierId.safeParse(input.orderId).success || !supplierId.safeParse(input.operationId).success || input.operationId.startsWith('internal:')) fail('invalid_request', 'Invalid or reserved identifier.');
    const fingerprint = canonicalJson({kind,actor,input:payload});
    if (fingerprint.length > 150_000) fail('invalid_request', 'Command is too large.');
    return {actor,fingerprint,at:this.now(),replay:await this.receipt(input.companyId,input.operationId,fingerprint)};
  }
  private async row(companyId: string, orderId: string): Promise<OrderRow> {
    const row = await this.db.prepare('SELECT * FROM supplier_simulation_orders WHERE company_id=? AND id=?').bind(companyId,orderId).first<OrderRow>();
    if (!row) fail('missing', 'Simulation order not found.');
    return row;
  }
  private async view(row: OrderRow): Promise<SupplierSimulationOrder> {
    const source = supplierSource(JSON.parse(row.source_json),row.company_id);
    let quote: SupplierQuote | null = null;
    if (row.quote_id) {
      const saved = await this.db.prepare('SELECT quote_json FROM supplier_simulation_quotes WHERE company_id=? AND order_id=? AND id=?')
        .bind(row.company_id,row.id,row.quote_id).first<{quote_json: string}>();
      if (!saved) fail('guard_failed', 'Simulation quote is missing.');
      // Historical quotes remain readable after expiry; validation uses their quoted time.
      const value = JSON.parse(saved.quote_json) as SupplierQuote;
      quote = validateSupplierQuote(value,source,new Date(value.quotedAt));
    }
    return frozenCopy({companyId:row.company_id,id:row.id,status:row.status,revision:row.revision,source,
      quote,approvalId:row.approval_id,externalId:row.external_id,provenance:'simulated' as const});
  }
  async get(companyId: string, orderId: string): Promise<SupplierSimulationOrder> {
    await this.actor(companyId);
    if (!supplierId.safeParse(orderId).success) fail('invalid_request', 'Invalid order identifier.');
    return this.view(await this.row(companyId,orderId));
  }
  async history(companyId: string, orderId: string): Promise<readonly Readonly<{revision: number; kind: string; status: SupplierOrderStatus; actor: string; detail_json: string; at: string}>[]> {
    await this.actor(companyId); await this.row(companyId,orderId);
    const result = await this.db.prepare('SELECT revision,kind,status,actor,detail_json,at FROM supplier_simulation_events WHERE company_id=? AND order_id=? ORDER BY revision').bind(companyId,orderId).all<{revision: number; kind: string; status: SupplierOrderStatus; actor: string; detail_json: string; at: string}>();
    return frozenCopy(result.results);
  }
  private expected(row: OrderRow, revision: number, statuses: readonly string[]): void {
    if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid_request', 'Expected revision is required.');
    if (row.revision !== revision || !statuses.includes(row.status)) fail('conflict', 'Order state or revision changed.');
  }
  /** Read origins/states directly: simulations must not invalidate or mutate upstream history. */
  private async sourceGuard(source: SupplierSource, actor: string, at: string): Promise<Guard> {
    const checks: Guard[] = [];
    for (const h of source.handoffs) {
      const clauses: string[] = [], args: (string | number)[] = [];
      const companyId = h.companyId;
      const origin = await this.origins.get(companyId,h.proposalId,{companyId,userId:actor,role:'manager'});
      const state = await this.db.prepare('SELECT * FROM replenishment_proposal_states WHERE company_id=? AND proposal_id=?')
        .bind(companyId,h.proposalId).first<{status:ProposalStatus; revision:number; packs:string; invalidation_reason:string|null}>();
      if (!origin || !state || state.invalidation_reason !== null) fail('source_changed', 'Saved proposal is unavailable or invalidated.');
      const edits = await this.db.prepare("SELECT packs,reason,actor FROM replenishment_proposal_events WHERE company_id=? AND proposal_id=? AND kind='edit' ORDER BY revision DESC LIMIT 1")
        .bind(companyId,h.proposalId).first<{packs:string; reason:string; actor:string}>();
      const edit: ProposalPackEdit | null = edits ? {companyId,proposalId:h.proposalId,packs:edits.packs,reason:edits.reason,changedBy:edits.actor,
        estimatedLineTotal:origin.snapshot.priceEstimate === null ? null : {currency:origin.snapshot.priceEstimate.currency,minor:(BigInt(edits.packs)*BigInt(origin.snapshot.priceEstimate.perPackMinor)).toString()}} : null;
      const s = origin.snapshot;
      const rebuilt = buildProposalHandoff(origin,state.status,state.revision,{
        inventoryVersion:s.inventoryVersion,inventoryConfigId:s.inventoryConfigId,inventoryConfigVersion:s.inventoryConfigVersion,
        settingsVersion:s.settingsVersion,settingsChangeId:s.settingsChangeId},edit);
      if (state.packs !== rebuilt.packs || canonicalJson(rebuilt) !== canonicalJson(h)) fail('source_changed', 'Saved proposal differs from handoff.');
      clauses.push(`EXISTS (SELECT 1 FROM replenishment_proposal_states WHERE company_id=? AND proposal_id=? AND revision=? AND status=? AND packs=? AND invalidation_reason IS NULL)`);
      args.push(companyId,h.proposalId,h.revision,h.status,h.packs);
      clauses.push(`EXISTS (SELECT 1 FROM inventory_balances_exact b
        JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
        JOIN replenishment_settings_versions v ON v.company_id=b.company_id AND v.product_id=b.product_id
        WHERE b.company_id=? AND b.product_id=? AND b.version=? AND b.config_id=? AND c.version=? AND c.status='active'
        AND v.version=? AND v.change_id=? AND v.inventory_config_id=b.config_id AND v.inventory_config_version=c.version
        AND v.version=(SELECT MAX(version) FROM replenishment_settings_versions WHERE company_id=b.company_id AND product_id=b.product_id))`);
      args.push(companyId,h.productId,h.inventoryVersion,h.inventoryConfigId,h.inventoryConfigVersion,h.settingsVersion,h.settingsChangeId);
      if (h.salesReadiness.source === 'clover_sync') {
        const guard = cloverSourceGuard(h.salesReadiness,this.options.salesPolicy,new Date(at));
        clauses.push(guard.sql); args.push(...guard.args);
      }
      checks.push({sql:clauses.join(' AND '),args});
    }
    return {sql:MEMBER,args:[source.group.companyId,actor],checks};
  }
  private stateGuard(row: OrderRow, actor: string): Guard {
    return {sql:`${MEMBER} AND EXISTS (SELECT 1 FROM supplier_simulation_orders WHERE company_id=? AND id=? AND revision=? AND status=?)`,
      args:[row.company_id,actor,row.company_id,row.id,row.revision,row.status]};
  }
  private combine(a: Guard,b: Guard): Guard {return {sql:`(${a.sql}) AND (${b.sql})`,args:[...a.args,...b.args],checks:[...(a.checks ?? []),...(b.checks ?? [])]};}
  /** Batch receipt guard aborts all writes on stale authorization/source/state/budget. */
  private async commit(input: {companyId:string;orderId:string;operationId:string}, ctx: CommandContext,
    result: SupplierSimulationOrder, kind: string, detail: unknown, guard: Guard, statements: D1PreparedStatement[], create = false): Promise<{result:SupplierSimulationOrder; won:boolean}> {
    const receipt = this.db.prepare(`INSERT INTO supplier_simulation_operations
      (company_id,operation_id,order_id,fingerprint,result_json,write_guard,created_at)
      VALUES (?,?,?,?,?,CASE WHEN ${guard.sql} THEN 1 ELSE 0 END,?)`)
      .bind(input.companyId,input.operationId,input.orderId,ctx.fingerprint,JSON.stringify(result),...guard.args,ctx.at);
    const event = this.db.prepare(`INSERT INTO supplier_simulation_events
      (company_id,order_id,revision,operation_id,kind,status,actor,detail_json,at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(input.companyId,input.orderId,result.revision,input.operationId,kind,result.status,ctx.actor,canonicalJson(detail),ctx.at);
    // One source check per statement keeps grouped orders within D1's 100-bound-parameter limit.
    // Successful checks write nothing. Failed checks hit the receipt trigger and abort the entire batch.
    const checks = (guard.checks ?? []).map(check => this.db.prepare(`INSERT INTO supplier_simulation_operations
      (company_id,operation_id,order_id,fingerprint,result_json,write_guard,created_at)
      SELECT ?,?,?,?,?,0,? WHERE NOT (${check.sql})`)
      .bind(input.companyId,input.operationId,input.orderId,ctx.fingerprint,'{}',ctx.at,...check.args));
    try {
      if (['quote','approve','send'].includes(kind) && result.quote) {
        validateSupplierQuote(result.quote,result.source,this.clock.now());
      }
      // Create requires its order FK before receipt; all later mutations guard before updating.
      await this.db.batch(create ? [...statements,receipt,...checks,event] : [receipt,...checks,...statements,event]);
      const saved = await this.receipt(input.companyId,input.operationId,ctx.fingerprint);
      if (!saved) fail('guard_failed', 'Simulation receipt was not committed.');
      return {result:saved,won:true};
    } catch (error) {
      const replay = await this.receipt(input.companyId,input.operationId,ctx.fingerprint);
      if (replay) return {result:replay,won:false};
      if (error instanceof Error && /immutable|injected/i.test(error.message)) throw error;
      fail('guard_failed', 'State, source, membership, held quantity or fixture budget changed; no write committed.');
    }
  }
  private update(row: OrderRow, result: SupplierSimulationOrder, at: string, sendId = row.send_operation_id): D1PreparedStatement {
    return this.db.prepare(`UPDATE supplier_simulation_orders SET status=?,revision=?,quote_id=?,approval_id=?,send_operation_id=?,external_id=?,updated_at=? WHERE company_id=? AND id=? AND revision=?`)
      .bind(result.status,result.revision,result.quote?.id ?? null,result.approvalId,sendId,result.externalId,at,row.company_id,row.id,row.revision);
  }
  async create(input: Readonly<{companyId:string;orderId:string;operationId:string;handoffs:readonly ProposalHandoff[]}>): Promise<SupplierSimulationOrder> {
    const ctx = await this.context('create',input,input); if (ctx.replay) return ctx.replay;
    const source = supplierSource(input.handoffs,input.companyId), guard = await this.sourceGuard(source,ctx.actor,ctx.at);
    const result = frozenCopy({companyId:input.companyId,id:input.orderId,status:'awaiting_quote' as const,revision:1,source,
      quote:null,approvalId:null,externalId:null,provenance:'simulated' as const});
    const insert = this.db.prepare(`INSERT INTO supplier_simulation_orders
      (company_id,id,source_json,status,revision,created_at,updated_at) VALUES (?,?,?,'awaiting_quote',1,?,?)`)
      .bind(input.companyId,input.orderId,JSON.stringify(source.handoffs),ctx.at,ctx.at);
    return (await this.commit(input,ctx,result,'create',{sourceFingerprint:source.fingerprint},guard,[insert],true)).result;
  }
  async quote(input: SupplierSimulationCommand): Promise<SupplierSimulationOrder> {
    const ctx = await this.context('quote',input,input); if (ctx.replay) return ctx.replay;
    const row = await this.row(input.companyId,input.orderId); this.expected(row,input.expectedRevision,allowedBeforeSend);
    const current = await this.view(row), source = current.source;
    const quote = validateSupplierQuote(this.options.connector.quote(source,input.operationId,new Date(ctx.at)),source,new Date(ctx.at));
    const result = frozenCopy({...current,status:'awaiting_approval' as const,revision:row.revision+1,quote,approvalId:null});
    const guard = this.combine(this.stateGuard(row,ctx.actor),await this.sourceGuard(source,ctx.actor,ctx.at));
    return (await this.commit(input,ctx,result,'quote',{quote},guard,[
      this.db.prepare('INSERT INTO supplier_simulation_quotes(company_id,order_id,id,quote_json,created_at) VALUES (?,?,?,?,?)')
        .bind(input.companyId,input.orderId,quote.id,canonicalJson(quote),ctx.at),this.update(row,result,ctx.at),
    ])).result;
  }
  async approve(input: SupplierSimulationCommand & Readonly<{quoteFingerprint:string}>): Promise<SupplierSimulationOrder> {
    const ctx = await this.context('approve',input,input); if (ctx.replay) return ctx.replay;
    const row = await this.row(input.companyId,input.orderId); this.expected(row,input.expectedRevision,['awaiting_approval']);
    const current = await this.view(row);
    if (!current.quote || input.quoteFingerprint !== canonicalJson(current.quote)) fail('conflict', 'Manager must approve the exact final quote.');
    validateSupplierQuote(current.quote,current.source,new Date(ctx.at));
    const result = frozenCopy({...current,status:'approved' as const,revision:row.revision+1,approvalId:input.operationId});
    const guard = this.combine(this.stateGuard(row,ctx.actor),await this.sourceGuard(current.source,ctx.actor,ctx.at));
    return (await this.commit(input,ctx,result,'approve',{quoteId:current.quote.id,quoteFingerprint:input.quoteFingerprint},guard,[
      this.db.prepare(`INSERT INTO supplier_simulation_approvals(company_id,order_id,id,quote_id,quote_fingerprint,source_fingerprint,actor,approved_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(input.companyId,input.orderId,input.operationId,current.quote.id,input.quoteFingerprint,current.source.fingerprint,ctx.actor,ctx.at),this.update(row,result,ctx.at),
    ])).result;
  }
  async cancel(input: SupplierSimulationCommand & Readonly<{reason:string}>): Promise<SupplierSimulationOrder> {
    const ctx = await this.context('cancel',input,input); if (ctx.replay) return ctx.replay;
    if (typeof input.reason !== 'string' || input.reason.trim().length < 4 || input.reason.length > 500) fail('invalid_request', 'A cancellation reason is required.');
    const row = await this.row(input.companyId,input.orderId); this.expected(row,input.expectedRevision,allowedBeforeSend);
    const result = frozenCopy({...await this.view(row),status:'canceled' as const,revision:row.revision+1});
    return (await this.commit(input,ctx,result,'cancel',{reason:input.reason},this.stateGuard(row,ctx.actor),[this.update(row,result,ctx.at)])).result;
  }
  /** Returns the immutable send-claim receipt. Read get/history for subsequent outcome. Never resends a replay. */
  async send(input: SupplierSimulationCommand): Promise<SupplierSimulationOrder> {
    const ctx = await this.context('send',input,input); if (ctx.replay) return ctx.replay;
    const row = await this.row(input.companyId,input.orderId); this.expected(row,input.expectedRevision,['approved']);
    const current = await this.view(row);
    if (!current.quote || !current.approvalId) fail('conflict', 'Exact quote approval is required.');
    const quote = validateSupplierQuote(current.quote,current.source,new Date(ctx.at));
    const approval = await this.db.prepare(`SELECT 1 FROM supplier_simulation_approvals WHERE company_id=? AND order_id=? AND id=? AND quote_id=? AND quote_fingerprint=? AND source_fingerprint=?`)
      .bind(input.companyId,input.orderId,current.approvalId,quote.id,canonicalJson(quote),current.source.fingerprint).first();
    if (!approval) fail('conflict', 'Approval does not match final quote and source.');
    const limits = this.limits(), day = ctx.at.slice(0,10);
    let guard = this.combine(this.stateGuard(row,ctx.actor),await this.sourceGuard(current.source,ctx.actor,ctx.at));
    guard = this.combine(guard,{sql:`?<=? AND ?<=(?-COALESCE((SELECT SUM(total_minor) FROM supplier_simulation_reservations WHERE company_id=? AND currency='USD' AND (state='reserved' OR (state='spent' AND day=?))),0))`,
      args:[quote.totalMinor,limits.perOrderMinor,quote.totalMinor,limits.perUtcDayMinor,input.companyId,day]});
    const result = frozenCopy({...current,status:'sending' as const,revision:row.revision+1});
    const claimed = await this.commit(input,ctx,result,'send',{quoteFingerprint:canonicalJson(quote),day,fixtureLimits:limits},guard,[
      ...current.source.handoffs.map(h => this.db.prepare('INSERT INTO supplier_simulation_source_holds(company_id,order_id,proposal_id,product_id,source_revision,active) VALUES (?,?,?,?,?,1)')
        .bind(input.companyId,input.orderId,h.proposalId,h.productId,h.revision)),
      this.db.prepare("INSERT INTO supplier_simulation_reservations(company_id,order_id,day,currency,total_minor,state,reserved_at) VALUES (?,?,?,'USD',?,'reserved',?)")
        .bind(input.companyId,input.orderId,day,quote.totalMinor,ctx.at),this.update(row,result,ctx.at,input.operationId),
    ]);
    if (claimed.won) {
      let outcome: unknown;
      try {
        // Database latency must not cause an expired quote to reach even the fake connector.
        validateSupplierQuote(quote,current.source,this.clock.now());
        outcome = await this.options.connector.submit(this.reference(row),quote);
      } catch {outcome = {status:'unknown'};}
      await this.settle(input.companyId,input.orderId,`internal:${input.operationId}`,ctx.actor,outcome);
    }
    return claimed.result;
  }
  private reference(row: OrderRow): string {return canonicalJson([row.company_id,row.id]);}
  private async settle(companyId: string,orderId: string,operationId: string,actor: string,outcome: unknown): Promise<SupplierSimulationOrder> {
    const row = await this.row(companyId,orderId), current = await this.view(row);
    if (['accepted','rejected'].includes(row.status)) return current;
    this.expected(row,row.revision,['sending','unknown']);
    if (!current.quote) fail('guard_failed', 'Sent quote missing.');
    const terminal = matchingSupplierResult(outcome,this.reference(row),current.quote);
    const status: SupplierOrderStatus = terminal?.status ?? 'unknown';
    const result = frozenCopy({...current,status,revision:row.revision+1,externalId:terminal?.externalId ?? null});
    const fingerprint = canonicalJson({kind:'outcome',orderId,actor,outcome:terminal ?? {status:'unknown'}});
    const ctx = {actor,at:this.now(),fingerprint,replay:null};
    const statements = [this.update(row,result,ctx.at)];
    if (terminal) {
      statements.push(this.db.prepare('UPDATE supplier_simulation_reservations SET state=? WHERE company_id=? AND order_id=? AND state=\'reserved\'')
        .bind(status === 'accepted' ? 'spent' : 'released',companyId,orderId));
      if (status === 'rejected') statements.push(this.db.prepare('UPDATE supplier_simulation_source_holds SET active=0 WHERE company_id=? AND order_id=? AND active=1').bind(companyId,orderId));
    }
    // An already authorized send result must be persisted even if membership was revoked during the call.
    const guard = {sql:'EXISTS (SELECT 1 FROM supplier_simulation_orders WHERE company_id=? AND id=? AND revision=? AND status=?)',args:[companyId,orderId,row.revision,row.status]};
    try {return (await this.commit({companyId,orderId,operationId},ctx,result,'outcome',{outcome:terminal ?? {status:'unknown'}},guard,statements)).result;}
    catch (error) {const latest = await this.view(await this.row(companyId,orderId)); if (['accepted','rejected'].includes(latest.status)) return latest; throw error;}
  }
  async reconcile(input: SupplierSimulationCommand): Promise<SupplierSimulationOrder> {
    const ctx = await this.context('reconcile',input,input); if (ctx.replay) return ctx.replay;
    const row = await this.row(input.companyId,input.orderId); this.expected(row,input.expectedRevision,['sending','unknown']);
    const current = await this.view(row);
    if (!current.quote) fail('guard_failed', 'Sent quote missing.');
    let value: unknown;
    try {value = await this.options.connector.lookup(this.reference(row));} catch {value = {status:'unknown'};}
    const terminal = matchingSupplierResult(value,this.reference(row),current.quote);
    const result: SupplierSimulationOrder = frozenCopy({...current,status:terminal?.status ?? 'unknown',revision:row.revision+1,externalId:terminal?.externalId ?? null});
    const statements = [this.update(row,result,ctx.at)];
    if (terminal) {
      statements.push(this.db.prepare("UPDATE supplier_simulation_reservations SET state=? WHERE company_id=? AND order_id=? AND state='reserved'")
        .bind(terminal.status === 'accepted' ? 'spent' : 'released',input.companyId,input.orderId));
      if (terminal.status === 'rejected') statements.push(this.db.prepare('UPDATE supplier_simulation_source_holds SET active=0 WHERE company_id=? AND order_id=? AND active=1').bind(input.companyId,input.orderId));
    }
    return (await this.commit(input,ctx,result,'reconcile',{outcome:terminal ?? {status:'unknown'},lookup:terminal ? 'matching_terminal' : 'unresolved'},this.stateGuard(row,ctx.actor),statements)).result;
  }
}
