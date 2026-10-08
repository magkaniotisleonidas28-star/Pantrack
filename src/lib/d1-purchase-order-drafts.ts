import {z} from 'zod';
import {D1ReplenishmentProposalOrigins} from './d1-replenishment-proposal-origins';
import {buildProposalHandoff, type ProposalPackEdit, type ProposalStatus} from './replenishment-lifecycle';
import {cloverSourceGuard, type CloverReviewPolicy} from './d1-replenishment-clover-source';
import {canonicalJson, frozenCopy, supplierSource} from './supplier-simulation-contract';
import {D1PurchasingSuppliers} from './d1-purchasing-suppliers';
import {SupplierRegistryError} from './purchasing-supplier-contract';
import {cancelPoSchema, createPoSchema, editPoSchema, reviewPoSchema, poFail, poId, type PurchaseOrderLine,
  type PurchaseOrderSnapshot, type PurchaseOrderView, type CreatePoInput, type EditPoInput} from './purchase-order-contract';

type Guard = {sql: string; args: (string | number)[]};
type Clock = {now(): Date};
type Row = {company_id: string; id: string; number: string; status: PurchaseOrderView['status'];
  revision: number; snapshot_json: string; created_at: string};
type Config = {id: string; version: number; purchase_unit_label: string;
  purchase_quantity_minor: string | null; dimension: 'count' | 'mass' | 'volume'};
const MEMBER = "EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
const MAX_MINOR = BigInt('9223372036854775807');

/** Review-only drafts. No network, purchase approval, reservation, source hold or stock writer. */
export class D1PurchaseOrderDrafts {
  constructor(private readonly db: D1Database, private readonly options: {
    identity: () => Promise<string | null>; clock?: Clock; salesPolicy?: CloverReviewPolicy;
  }) {}

  private async actor(companyId: string): Promise<string> {
    if (!poId.safeParse(companyId).success) poFail('invalid_request','Choose a company.');
    const actor = await this.options.identity();
    if (!actor || !await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(companyId,actor).first()) {
      poFail('forbidden','Manager or owner membership is required.');
    }
    return actor;
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    if (JSON.stringify(value)?.length > 100_000) poFail('invalid_request','PO input is too large.');
    const parsed = schema.safeParse(value);
    if (!parsed.success) poFail('invalid_request','Check the PO fields and whole-pack quantities.');
    return parsed.data;
  }
  private async replay(companyId: string, operationId: string, fingerprint: string): Promise<PurchaseOrderView | null> {
    const row = await this.db.prepare(`SELECT fingerprint,result_json FROM purchase_order_draft_operations
      WHERE company_id=? AND operation_id=?`).bind(companyId,operationId).first<{fingerprint: string; result_json: string}>();
    if (!row) return null;
    if (row.fingerprint !== fingerprint) poFail('conflict','This operation ID was used for a different request or actor.');
    return frozenCopy(JSON.parse(row.result_json) as PurchaseOrderView);
  }
  private async config(companyId: string, productId: string): Promise<Config> {
    const row = await this.db.prepare(`SELECT c.id,c.version,c.purchase_unit_label,c.purchase_quantity_minor,u.dimension
      FROM inventory_config_versions c JOIN product_unit_versions u
      ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE c.company_id=? AND c.product_id=? AND c.status='active'`)
      .bind(companyId,productId).first<Config>();
    if (!row || !['count','mass','volume'].includes(row.dimension) ||
        !row.purchase_quantity_minor || !/^[1-9]\d*$/.test(row.purchase_quantity_minor)) {
      poFail('source_changed','This stock item needs an active exact pack conversion.');
    }
    return row;
  }
  private stockTotal(dimension: Config['dimension'], minor: string, packs: string) {
    const total = BigInt(minor) * BigInt(packs);
    if (total > MAX_MINOR) poFail('invalid_request','Stock quantity exceeds the exact inventory range.');
    return {dimension,minor:total.toString()};
  }
  private async manual(input: Extract<CreatePoInput,{source:'manual'}>): Promise<{lines: PurchaseOrderLine[]; guards: Guard[]}> {
    const lines: PurchaseOrderLine[] = [], guards: Guard[] = [], products = new Set<string>(), skus = new Set<string>();
    for (const [index,line] of input.lines.entries()) {
      if (skus.has(line.sku) || line.kind === 'stock' && products.has(line.productId)) {
        poFail('invalid_request','Duplicate product or supplier SKU.');
      }
      skus.add(line.sku);
      const estimatedLineMinor = line.estimatedUnitMinor === null ? null :
        (BigInt(line.packs) * BigInt(line.estimatedUnitMinor)).toString();
      const base = {id:`line-${index+1}`,kind:line.kind,sku:line.sku,description:line.description,
        packs:line.packs,estimatedUnitMinor:line.estimatedUnitMinor,estimatedLineMinor,proposal:null};
      if (line.kind === 'non_stock') {
        lines.push({...base,productId:null,unitLabel:line.unitLabel,stockUnitsPerPack:null,stockQuantity:null,configId:null,configVersion:null});
        continue;
      }
      products.add(line.productId);
      const config = await this.config(input.companyId,line.productId);
      if (config.id !== line.expectedConfigId || config.version !== line.expectedConfigVersion) {
        poFail('source_changed','Pack configuration changed; reload the item.');
      }
      const stockUnitsPerPack = {dimension:config.dimension,minor:config.purchase_quantity_minor!};
      lines.push({...base,productId:line.productId,unitLabel:config.purchase_unit_label,
        stockUnitsPerPack,stockQuantity:this.stockTotal(config.dimension,stockUnitsPerPack.minor,line.packs),
        configId:config.id,configVersion:config.version});
      guards.push({sql:`EXISTS (SELECT 1 FROM inventory_config_versions
        WHERE company_id=? AND product_id=? AND id=? AND version=? AND status='active' AND purchase_quantity_minor=?)`,
        args:[input.companyId,line.productId,config.id,config.version,stockUnitsPerPack.minor]});
    }
    return {lines,guards};
  }
  private async proposals(input: Extract<CreatePoInput,{source:'proposals'}>, actor: string): Promise<{lines: PurchaseOrderLine[]; guards: Guard[]}> {
    const handoffs = [], guards: Guard[] = [];
    const origins = new D1ReplenishmentProposalOrigins(this.db);
    for (const ref of input.proposals) {
      const companyId = input.companyId;
      const origin = await origins.get(companyId,ref.id,{companyId,userId:actor,role:'manager'});
      const state = await this.db.prepare(`SELECT revision,status,packs,invalidation_reason FROM replenishment_proposal_states
        WHERE company_id=? AND proposal_id=?`).bind(companyId,ref.id)
        .first<{revision:number;status:ProposalStatus;packs:string;invalidation_reason:string|null}>();
      if (!origin || !state || state.revision !== ref.revision || state.invalidation_reason !== null) {
        poFail('source_changed','Proposal is missing, changed or invalidated.');
      }
      const edited = await this.db.prepare(`SELECT packs,reason,actor FROM replenishment_proposal_events
        WHERE company_id=? AND proposal_id=? AND kind='edit' ORDER BY revision DESC LIMIT 1`)
        .bind(companyId,ref.id).first<{packs:string;reason:string;actor:string}>();
      const s = origin.snapshot;
      const edit: ProposalPackEdit | null = edited ? {companyId,proposalId:ref.id,packs:edited.packs,
        reason:edited.reason,changedBy:edited.actor,estimatedLineTotal:s.priceEstimate === null ? null :
          {currency:s.priceEstimate.currency,minor:(BigInt(edited.packs)*BigInt(s.priceEstimate.perPackMinor)).toString()}} : null;
      const h = buildProposalHandoff(origin,state.status,state.revision,{
        inventoryVersion:s.inventoryVersion,inventoryConfigId:s.inventoryConfigId,inventoryConfigVersion:s.inventoryConfigVersion,
        settingsVersion:s.settingsVersion,settingsChangeId:s.settingsChangeId},edit);
      if (state.packs !== h.packs || h.estimatedLineTotal && h.estimatedLineTotal.currency !== 'USD') {
        poFail('source_changed','Proposal quantity or currency differs.');
      }
      handoffs.push(h);
      guards.push({sql:`EXISTS (SELECT 1 FROM replenishment_proposal_states
        WHERE company_id=? AND proposal_id=? AND revision=? AND status=? AND packs=? AND invalidation_reason IS NULL)`,
        args:[companyId,ref.id,state.revision,state.status,state.packs]});
      guards.push({sql:`EXISTS (SELECT 1 FROM inventory_balances_exact b
        JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
        JOIN replenishment_settings_versions v ON v.company_id=b.company_id AND v.product_id=b.product_id
        WHERE b.company_id=? AND b.product_id=? AND b.version=? AND b.config_id=? AND c.version=? AND c.status='active'
        AND v.version=? AND v.change_id=? AND v.inventory_config_id=b.config_id AND v.inventory_config_version=c.version
        AND v.version=(SELECT MAX(version) FROM replenishment_settings_versions WHERE company_id=b.company_id AND product_id=b.product_id))`,
        args:[companyId,h.productId,h.inventoryVersion,h.inventoryConfigId,h.inventoryConfigVersion,h.settingsVersion,h.settingsChangeId]});
      if (h.salesReadiness.source === 'clover_sync') {
        const g = cloverSourceGuard(h.salesReadiness,this.options.salesPolicy,this.options.clock?.now() ?? new Date());
        guards.push({sql:g.sql,args:[...g.args]});
      }
    }
    let source;
    try {source = supplierSource(handoffs,input.companyId);}
    catch {return poFail('source_changed','Proposals are unsafe, duplicate or belong to different supplier groups.');}
    if (source.group.supplierId !== input.supplier.id || source.group.accountId !== input.supplier.accountId ||
        source.group.locationId !== input.supplier.locationId) poFail('invalid_request','Supplier/account/location must match the saved proposals.');
    const lines: PurchaseOrderLine[] = [];
    for (const [index,h] of source.handoffs.entries()) {
      const config = await this.config(input.companyId,h.productId);
      const product = await this.db.prepare("SELECT json_extract(data,'$.name') AS name FROM products WHERE owner=? AND id=?")
        .bind(input.companyId,h.productId).first<{name:string|null}>();
      lines.push({id:`line-${index+1}`,kind:'stock',productId:h.productId,sku:h.supplier.sku,
        description:product?.name ?? h.productId,unitLabel:config.purchase_unit_label,packs:h.packs,
        stockUnitsPerPack:h.stockUnitsPerPack,stockQuantity:this.stockTotal(h.stockUnitsPerPack.dimension,h.stockUnitsPerPack.minor,h.packs),
        configId:h.inventoryConfigId,configVersion:h.inventoryConfigVersion,estimatedLineMinor:h.estimatedLineTotal?.minor ?? null,proposal:h});
    }
    return {lines,guards};
  }
  private async registry(input:Extract<CreatePoInput,{source:'registry'}>) {
    try {
      const registry=new D1PurchasingSuppliers(this.db,this.options),ref=input.supplierRef;
      const sources=await registry.draftSources(input.companyId,ref.id,ref.version,ref.accountId,ref.locationId,
        input.lines.filter(l=>l.kind==='stock').map(l=>({id:l.mappingId,version:l.mappingVersion})));
      const lines:PurchaseOrderLine[]=[],products=new Set<string>(),skus=new Set<string>();
      for(const [i,line] of input.lines.entries()){
        if(line.kind==='non_stock'){
          if(skus.has(line.sku))poFail('invalid_request','Duplicate product or supplier SKU.');skus.add(line.sku);
          lines.push({id:`line-${i+1}`,kind:'non_stock',productId:null,sku:line.sku,description:line.description,unitLabel:line.unitLabel,packs:line.packs,
            stockUnitsPerPack:null,stockQuantity:null,configId:null,configVersion:null,proposal:null,estimatedUnitMinor:line.estimatedUnitMinor,
            estimatedLineMinor:line.estimatedUnitMinor===null?null:(BigInt(line.estimatedUnitMinor)*BigInt(line.packs)).toString()});continue;
        }
        const m=sources.projections.find(p=>p.mapping.id===line.mappingId)!.mapping;
        if(products.has(m.productId)||skus.has(m.sku))poFail('invalid_request','Duplicate product or supplier SKU.');products.add(m.productId);skus.add(m.sku);
        lines.push({id:`line-${i+1}`,kind:'stock',productId:m.productId,sku:m.sku,description:m.description,unitLabel:m.unitLabel,packs:line.packs,
          stockUnitsPerPack:m.stockUnitsPerPack,stockQuantity:this.stockTotal(m.stockUnitsPerPack.dimension,m.stockUnitsPerPack.minor,line.packs),
          configId:m.configId,configVersion:m.configVersion,proposal:null,mappingId:m.id,mappingVersion:m.version,estimatedUnitMinor:m.estimatedUnitMinor,
          estimatedLineMinor:m.estimatedUnitMinor===null?null:(BigInt(m.estimatedUnitMinor)*BigInt(line.packs)).toString()});
      }
      return {lines,guards:sources.guards,supplier:{id:sources.profile.id,name:sources.profile.profile.name,email:sources.profile.profile.email,
        accountId:sources.account.reference,locationId:sources.location.reference,deliveryAddress:sources.location.address},
        registry:{profile:sources.profile,mappings:sources.projections,group:{accountId:ref.accountId,locationId:ref.locationId}}};
    }catch(error){if(error instanceof SupplierRegistryError)poFail(error.code,error.message);throw error;}
  }
  private async commit(input: {companyId:string;operationId:string}, actor: string, fingerprint: string,
    result: PurchaseOrderView, guards: Guard[], statements: D1PreparedStatement[], create: boolean): Promise<PurchaseOrderView> {
    const id = result.snapshot.id;
    const checks = guards.map(g => this.db.prepare(`INSERT INTO purchase_order_draft_operations
      (company_id,operation_id,order_id,fingerprint,result_json,write_guard)
      SELECT ?,?,?,?,'{}',0 WHERE NOT (${g.sql})`).bind(input.companyId,input.operationId,id,fingerprint,...g.args));
    const receipt = this.db.prepare(`INSERT INTO purchase_order_draft_operations
      (company_id,operation_id,order_id,fingerprint,result_json,write_guard)
      VALUES (?,?,?,?,?,CASE WHEN ${MEMBER} THEN 1 ELSE 0 END)`)
      .bind(input.companyId,input.operationId,id,fingerprint,JSON.stringify(result),input.companyId,actor);
    const last = result.events.at(-1)!;
    const event = this.db.prepare(`INSERT INTO purchase_order_draft_events
      (company_id,order_id,revision,operation_id,kind,actor,reason,at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(input.companyId,id,last.revision,input.operationId,last.kind,actor,last.reason,last.at);
    try {
      await this.db.batch(create ? [...statements,receipt,...checks,event] : [receipt,...checks,...statements,event]);
    } catch {
      // A committed batch with a lost acknowledgment is an exact replay, not a new PO.
      await this.actor(input.companyId);
      const prior = await this.replay(input.companyId,input.operationId,fingerprint);
      if (prior) return prior;
      poFail('conflict','PO state, sources or membership changed; no draft change committed. Reload and review.');
    }
    const saved = await this.replay(input.companyId,input.operationId,fingerprint);
    if (!saved) poFail('storage_failure','Save outcome is uncertain; retry the same operation.');
    return saved;
  }
  async create(value: unknown): Promise<PurchaseOrderView> {
    const input = this.parse<CreatePoInput>(createPoSchema,value), actor = await this.actor(input.companyId);
    const fingerprint = canonicalJson({actor,input});
    const replay = await this.replay(input.companyId,input.operationId,fingerprint); if (replay) return replay;
    const resolved:{lines:PurchaseOrderLine[];guards:Guard[];supplier?:PurchaseOrderSnapshot['supplier'];registry?:PurchaseOrderSnapshot['registry']}=
      input.source==='registry'?await this.registry(input):input.source==='manual'?await this.manual(input):await this.proposals(input,actor);
    const {lines,guards}=resolved;
    const supplier=input.source==='registry'?(resolved.supplier??poFail('invalid_request','Supplier required.')):input.supplier;
    const subtotal = lines.reduce((total,line) => total + BigInt(line.estimatedLineMinor ?? '0'),BigInt(0));
    if (subtotal > BigInt(input.capMinor)) poFail('invalid_request','Draft spending cap is below the known estimated subtotal.');
    const at = (this.options.clock?.now() ?? new Date()).toISOString(), id = crypto.randomUUID();
    const warnings = ['Draft — not sent. No purchase approval, supplier confirmation or delivery is recorded.',
      'Supplier details and email ordering permission require verification.',
      'Prices are estimates; unavailable prices, fees and delivery require supplier confirmation.',
      'Spending cap is proposed only; no budget or stock quantity is reserved.'];
    if (input.source === 'proposals') warnings.push('Proposal supplier mappings and price sources are fictional; production ordering is prohibited.');
    if(input.source==='registry'&&resolved.registry){
      if(resolved.registry.profile.profile.emailAcceptance.status!=='manager_reported_accepted')warnings.push('Supplier email PO acceptance is unknown or not accepted; this draft cannot authorize sending.');
      else warnings.push('Email acceptance is manager-reported only; no supplier/provider validation or ordering gate is satisfied.');
      if(!supplier.email)warnings.push('Ordering email is unavailable.');
      warnings.push('Ordering rules, minimums and fee estimates are recorded for review only; they are not enforced.');
    }
    const snapshot: PurchaseOrderSnapshot = {contract:input.source==='registry'?'pantrack.purchase-order-draft.v2':'pantrack.purchase-order-draft.v1',companyId:input.companyId,
      id,number:`PO-${id.toUpperCase()}`,source:input.source,supplier,currency:'USD',capMinor:input.capMinor,
      notes:input.notes,lines,knownSubtotalMinor:subtotal.toString(),pricesComplete:lines.every(l=>l.estimatedLineMinor !== null),
      warnings,createdBy:actor,createdAt:at,...(resolved.registry?{registry:resolved.registry}:{})};
    const result: PurchaseOrderView = {snapshot,revision:1,status:'draft',events:[{revision:1,kind:'create',actor,reason:'Draft created — not sent',at}]};
    const statements = [this.db.prepare(`INSERT INTO purchase_order_drafts
      (company_id,id,number,supplier_id,status,revision,snapshot_json,created_at) VALUES (?,?,?,?,'draft',1,?,?)`)
      .bind(input.companyId,id,snapshot.number,supplier.id,JSON.stringify(snapshot),at),
      ...lines.map(l=>this.db.prepare(`INSERT INTO purchase_order_draft_lines
        (company_id,order_id,id,kind,product_id,proposal_id,source_revision,data_json) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(input.companyId,id,l.id,l.kind,l.productId,l.proposal?.proposalId ?? null,l.proposal?.revision ?? null,JSON.stringify(l)))];
    return this.commit(input,actor,fingerprint,result,guards,statements,true);
  }
  private async view(row: Row, actor: string): Promise<PurchaseOrderView> {
    const events = await this.db.prepare(`SELECT revision,kind,actor,reason,at FROM purchase_order_draft_events
      WHERE company_id=? AND order_id=? AND revision<=? AND ${MEMBER} ORDER BY revision`)
      .bind(row.company_id,row.id,row.revision,row.company_id,actor).all<PurchaseOrderView['events'][number]>();
    if (events.results.length !== row.revision) poFail('forbidden','PO history is unavailable for this membership.');
    const last=events.results.at(-1)!;
    return frozenCopy({snapshot:JSON.parse(row.snapshot_json) as PurchaseOrderSnapshot,status:row.status,revision:row.revision,events:events.results,
      ...(row.status==='reviewed'?{review:{contentRevision:row.revision-1,actor:last.actor,at:last.at}}:{})});
  }
  async get(companyId: string, orderId: string, revision?:number): Promise<PurchaseOrderView> {
    const actor = await this.actor(companyId);
    if (!poId.safeParse(orderId).success) poFail('invalid_request','Choose a PO.');
    if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))poFail('invalid_request','Invalid draft revision.');
    const row = await this.db.prepare(`SELECT h.company_id,h.id,h.number,r.status,r.revision,r.snapshot_json,h.created_at
      FROM purchase_order_drafts h JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id
      WHERE h.company_id=? AND h.id=? AND r.revision=COALESCE(?,h.revision) AND ${MEMBER}`)
      .bind(companyId,orderId,revision??null,companyId,actor).first<Row>();
    if (!row) poFail('missing','PO draft not found.');
    return this.view(row,actor);
  }
  async list(companyId: string, offset = 0) {
    const actor = await this.actor(companyId);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) poFail('invalid_request','Invalid history offset.');
    const rows = await this.db.prepare(`SELECT h.id,h.number,h.supplier_id,json_extract(r.snapshot_json,'$.supplier.name') AS supplier_name,h.status,h.revision,h.created_at
      FROM purchase_order_drafts h JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
      WHERE h.company_id=? AND ${MEMBER} ORDER BY h.created_at DESC,h.id DESC LIMIT 21 OFFSET ?`)
      .bind(companyId,companyId,actor,offset).all<{id:string;number:string;supplier_id:string;supplier_name:string;status:string;revision:number;created_at:string}>();
    return frozenCopy({orders:rows.results.slice(0,20),hasMore:rows.results.length > 20});
  }
  async choices(companyId: string) {
    const actor = await this.actor(companyId);
    const stocks = await this.db.prepare(`SELECT c.product_id,c.id AS config_id,c.version AS config_version,
      c.purchase_unit_label,c.purchase_quantity_minor,u.dimension,
      COALESCE(json_extract(p.data,'$.name'),c.product_id) AS name,COALESCE(json_extract(p.data,'$.sku'),'') AS sku
      FROM inventory_config_versions c JOIN products p ON p.owner=c.company_id AND p.id=c.product_id
      JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id
        AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version
      WHERE c.company_id=? AND c.status='active' AND c.purchase_quantity_minor IS NOT NULL AND ${MEMBER}
      ORDER BY name,c.product_id LIMIT 501`).bind(companyId,companyId,actor)
      .all<{product_id:string;config_id:string;config_version:number;purchase_unit_label:string;purchase_quantity_minor:string;dimension:Config['dimension'];name:string;sku:string}>();
    const proposals = await this.db.prepare(`SELECT o.id,s.revision,s.packs,o.product_id,
      COALESCE(json_extract(p.data,'$.name'),o.product_id) AS name,
      json_extract(o.snapshot_json,'$.supplier.supplierId') AS supplier_id,
      json_extract(o.snapshot_json,'$.supplier.accountId') AS account_id,
      json_extract(o.snapshot_json,'$.supplier.locationId') AS location_id
      FROM replenishment_proposal_origins o JOIN replenishment_proposal_states s
        ON s.company_id=o.company_id AND s.proposal_id=o.id
      JOIN products p ON p.owner=o.company_id AND p.id=o.product_id
      WHERE o.company_id=? AND s.status IN ('draft','review_required','approved')
        AND s.invalidation_reason IS NULL AND s.packs!='0' AND ${MEMBER}
      ORDER BY o.created_at DESC,o.id DESC LIMIT 501`).bind(companyId,companyId,actor)
      .all<{id:string;revision:number;packs:string;product_id:string;name:string;supplier_id:string;account_id:string;location_id:string}>();
    if (stocks.results.length > 500 || proposals.results.length > 500) poFail('invalid_request','Preview supports up to 500 stock items and proposals.');
    return frozenCopy({stocks:stocks.results,proposals:proposals.results});
  }
  private registryInput(snapshot:PurchaseOrderSnapshot):Extract<CreatePoInput,{source:'registry'}> {
    const saved=snapshot.registry??poFail('source_changed','Saved supplier versions are missing.');
    const group=saved.group??saved.mappings[0];
    const accounts=saved.profile.profile.accounts.filter(a=>group?a.id===group.accountId:a.reference===snapshot.supplier.accountId);
    const locations=saved.profile.profile.locations.filter(l=>l.accountId===accounts[0]?.id&&(group?l.id===group.locationId:l.reference===snapshot.supplier.locationId));
    if(accounts.length!==1||locations.length!==1)poFail('source_changed','Saved supplier group is ambiguous or unavailable; create a replacement draft.');
    const [account]=accounts,[location]=locations;
    return {action:'create',companyId:snapshot.companyId,operationId:'validate',source:'registry',
      supplierRef:{id:saved.profile.id,version:saved.profile.version,accountId:account.id,locationId:location.id},
      capMinor:snapshot.capMinor,notes:snapshot.notes,lines:snapshot.lines.map(l=>l.kind==='stock'?
        {kind:'stock',mappingId:l.mappingId!,mappingVersion:l.mappingVersion!,packs:l.packs}:
        {kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,estimatedUnitMinor:this.unitPrice(l)})};
  }
  private unitPrice(line:PurchaseOrderLine):string|null {
    return line.estimatedUnitMinor!==undefined?line.estimatedUnitMinor:line.estimatedLineMinor===null?null:
      (BigInt(line.estimatedLineMinor)/BigInt(line.packs)).toString();
  }
  private async sourceGuards(snapshot:PurchaseOrderSnapshot,actor:string):Promise<Guard[]> {
    if(snapshot.source==='registry')return (await this.registry(this.registryInput(snapshot))).guards;
    if(snapshot.source==='proposals')return (await this.proposals({action:'create',companyId:snapshot.companyId,operationId:'validate',
      source:'proposals',supplier:{...snapshot.supplier,email:snapshot.supplier.email!},capMinor:snapshot.capMinor,notes:snapshot.notes,
      proposals:snapshot.lines.map(l=>({id:l.proposal!.proposalId,revision:l.proposal!.revision}))},actor)).guards;
    return (await this.manual({action:'create',companyId:snapshot.companyId,operationId:'validate',source:'manual',
      supplier:{...snapshot.supplier,email:snapshot.supplier.email!},capMinor:snapshot.capMinor,notes:snapshot.notes,
      lines:snapshot.lines.map(l=>l.kind==='stock'?{kind:'stock',productId:l.productId!,expectedConfigId:l.configId!,expectedConfigVersion:l.configVersion!,
        sku:l.sku,description:l.description,packs:l.packs,estimatedUnitMinor:this.unitPrice(l)}:
        {kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:l.packs,estimatedUnitMinor:this.unitPrice(l)})})).guards;
  }
  private change(input:{companyId:string;operationId:string;orderId:string;expectedRevision:number},actor:string,fingerprint:string,
    current:PurchaseOrderView,status:PurchaseOrderView['status'],kind:'edit'|'review'|'cancel',reason:string,
    snapshot=current.snapshot,guards:Guard[]=[]):Promise<PurchaseOrderView> {
    const at=(this.options.clock?.now()??new Date()).toISOString(),revision=current.revision+1;
    const result:PurchaseOrderView={snapshot,status,revision,
      events:[...current.events,{revision,kind,actor,reason,at}],
      ...(kind==='review'?{review:{contentRevision:current.revision,actor,at}}:{})};
    const guard:Guard={sql:'EXISTS (SELECT 1 FROM purchase_order_drafts WHERE company_id=? AND id=? AND revision=? AND status=?)',
      args:[input.companyId,input.orderId,input.expectedRevision,current.status]};
    return this.commit(input,actor,fingerprint,result,[guard,...guards],[this.db.prepare(`UPDATE purchase_order_drafts
      SET status=?,revision=revision+1 WHERE company_id=? AND id=? AND revision=? AND status=?`)
      .bind(status,input.companyId,input.orderId,input.expectedRevision,current.status)],false);
  }
  async edit(value:unknown):Promise<PurchaseOrderView> {
    const input=this.parse<EditPoInput>(editPoSchema,value),actor=await this.actor(input.companyId);
    const fingerprint=canonicalJson({actor,input}),prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return prior;
    const current=await this.get(input.companyId,input.orderId),saved=current.snapshot;
    if(current.status==='canceled'||current.revision!==input.expectedRevision)poFail('conflict','Draft status or revision changed.');
    if(input.source!==saved.source)poFail('invalid_request','Create a new draft to change its source.');
    let snapshot:PurchaseOrderSnapshot,guards:Guard[];
    if(input.source==='registry'){
      const ref=this.registryInput(saved).supplierRef;
      if(canonicalJson(ref)!==canonicalJson(input.supplierRef))poFail('invalid_request','Create a new draft to change supplier details or grouping.');
      const resolved=await this.registry({...input,action:'create'});
      snapshot={...saved,lines:resolved.lines,capMinor:input.capMinor,notes:input.notes};guards=resolved.guards;
      // Explicit mapping replacements update only the saved mapping projections, never the supplier profile.
      snapshot={...snapshot,registry:{...saved.registry!,mappings:resolved.registry.mappings}};
    }else{
      if(input.supplier.id!==saved.supplier.id||input.supplier.accountId!==saved.supplier.accountId||input.supplier.locationId!==saved.supplier.locationId)
        poFail('invalid_request','Create a new draft to change the supplier/account/location group.');
      if(input.source==='manual'){
        const resolved=await this.manual({...input,action:'create'});guards=resolved.guards;
        snapshot={...saved,supplier:input.supplier,lines:resolved.lines,capMinor:input.capMinor,notes:input.notes};
      }else{
        guards=await this.sourceGuards(saved,actor);
        snapshot={...saved,supplier:input.supplier,capMinor:input.capMinor,notes:input.notes};
      }
    }
    const subtotal=snapshot.lines.reduce((sum,l)=>sum+BigInt(l.estimatedLineMinor??'0'),BigInt(0));
    if(subtotal>BigInt(input.capMinor))poFail('invalid_request','Draft spending cap is below the known estimated subtotal.');
    snapshot={...snapshot,knownSubtotalMinor:subtotal.toString(),pricesComplete:snapshot.lines.every(l=>l.estimatedLineMinor!==null)};
    if(canonicalJson(snapshot)===canonicalJson(saved))poFail('invalid_request','Change at least one draft field before saving.');
    return this.change(input,actor,fingerprint,current,'draft','edit',input.reason,snapshot,guards);
  }
  async review(value:unknown):Promise<PurchaseOrderView> {
    const input=this.parse(reviewPoSchema,value),actor=await this.actor(input.companyId);
    const fingerprint=canonicalJson({actor,input}),prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return prior;
    const current=await this.get(input.companyId,input.orderId);
    if(current.status!=='draft'||current.revision!==input.expectedRevision)poFail('conflict','Draft status or revision changed.');
    const guards=await this.sourceGuards(current.snapshot,actor);
    return this.change(input,actor,fingerprint,current,'reviewed','review','Reviewed warnings and draft details — not approved or sent',current.snapshot,guards);
  }
  async cancel(value: unknown): Promise<PurchaseOrderView> {
    const input = this.parse(cancelPoSchema,value), actor = await this.actor(input.companyId);
    const fingerprint = canonicalJson({actor,input});
    const replay = await this.replay(input.companyId,input.operationId,fingerprint); if (replay) return replay;
    const current = await this.get(input.companyId,input.orderId);
    if (current.status === 'canceled' || current.revision !== input.expectedRevision) poFail('conflict','Draft status or revision changed.');
    return this.change(input,actor,fingerprint,current,'canceled','cancel',input.reason);
  }
}
