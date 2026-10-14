import {z} from 'zod';
import type {PurchaseOrderView} from './purchase-order-contract';
import {canonicalJson, frozenCopy} from './supplier-simulation-contract';

const id = z.string().trim().min(1).max(200);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const packs = z.string().regex(/^[1-9]\d{0,8}$/);
const money = z.string().regex(/^(0|[1-9]\d{0,11})$/);
const quantity = z.object({dimension:z.enum(['count','mass','volume']),
  minor:z.string().regex(/^[1-9]\d{0,29}$/)}).strict();

/** Client intent only. Actor, connection, quantities and cap come from server records. */
export const preparationRequestSchema = z.object({companyId:id, orderId:id,
  expectedRevision:version, operationId:z.string().uuid()}).strict();
export type PreparationRequest = z.infer<typeof preparationRequestSchema>;

/** Internal reference only; never include cookies, context IDs or live-view URLs. */
export const preparationConnectionSchema = z.object({companyId:id, id, version,
  supplierId:id, accountId:id, locationId:id, mode:z.enum(['fictional','real']),
  status:z.enum(['active','disconnected']), paused:z.boolean()}).strict();
export type PreparationConnection = Readonly<z.infer<typeof preparationConnectionSchema>>;

export type CartProgress = 'queued'|'preparing'|'sign_in_needed'|'review_needed'|
  'ready'|'handed_to_manager'|'expired'|'canceled'|'failed';
export type PurchaseProgress = 'not_confirmed'|'outcome_unknown'|'confirmed'|
  'cancellation_requested'|'cancellation_confirmed';
export type DeliveryProgress = 'outstanding'|'partially_received'|'received'|'closed';

export class CartPreparationError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'source_changed'|'real_disabled', message:string) {
    super(message); this.name = 'CartPreparationError';
  }
}
function hold(code:CartPreparationError['code'], message:string):never {
  throw new CartPreparationError(code,message);
}

export type PreparationPreflight = Readonly<{
  contract:'pantrack.po-cart-preflight.v1'; mode:'fictional'; authorization:'required';
  actor:string; request:PreparationRequest; connection:PreparationConnection;
  sourceFingerprint:string; currency:'USD'; capMinor:string; itemSubtotalMinor:string;
  lines:readonly Readonly<{
    lineId:string; kind:'stock'|'non_stock'; productId:string|null;
    sku:string; description:string; unitLabel:string; packs:string;
    unitMinor:string; lineMinor:string;
    stockUnitsPerPack:z.infer<typeof quantity>|null;
    stockQuantity:z.infer<typeof quantity>|null;
    configId:string|null; configVersion:number|null;
    mappingId:string|null; mappingVersion:number|null;
  }>[];
}>;

/**
 * Server-side preflight only. This is neither a signed token nor an executable grant.
 * A future durable writer must reserve exposure/quantities and recheck all inputs
 * atomically. Do not send the fingerprint (full private PO content) to a model.
 */
export function preparationPreflight(request:PreparationRequest, actor:string,
  order:PurchaseOrderView, connection:PreparationConnection):PreparationPreflight {
  if (!preparationRequestSchema.safeParse(request).success || !id.safeParse(actor).success ||
      !preparationConnectionSchema.safeParse(connection).success) hold('invalid_request','Invalid preparation context.');
  if (connection.companyId !== request.companyId || order.snapshot.companyId !== request.companyId) {
    hold('forbidden','Preparation context belongs to another company.');
  }
  if (connection.mode !== 'fictional') hold('real_disabled','Real preparation needs production mappings and durable authorization.');
  const s = order.snapshot;
  if (connection.status !== 'active' || connection.paused || order.status !== 'reviewed' ||
      order.revision !== request.expectedRevision || s.id !== request.orderId) {
    hold('source_changed','PO, connection or pause state changed. Review the current draft.');
  }
  if (s.supplier.id !== 'cart-demo-supplier' || s.supplier.accountId !== 'DEMO-CART' ||
      s.supplier.locationId !== 'DEMO-CAFE' || connection.supplierId !== s.supplier.id ||
      connection.accountId !== s.supplier.accountId || connection.locationId !== s.supplier.locationId) {
    hold('source_changed','Use the configured fictional supplier/account/location.');
  }
  if (s.currency !== 'USD' || !money.safeParse(s.capMinor).success || BigInt(s.capMinor) === BigInt(0) ||
      !s.pricesComplete || s.lines.length < 1 || s.lines.length > 50 || JSON.stringify(s).length > 100_000) {
    hold('source_changed','A bounded PO with known USD estimates and a positive cap is required.');
  }
  const ids = new Set<string>(), skus = new Set<string>();
  const lines = s.lines.map(line => {
    if (![line.id,line.sku,line.description,line.unitLabel].every(v=>id.safeParse(v).success) ||
        !packs.safeParse(line.packs).success || !money.safeParse(line.estimatedLineMinor).success ||
        ids.has(line.id) || skus.has(line.sku)) hold('source_changed','Invalid, duplicate or unpriced PO line.');
    ids.add(line.id); skus.add(line.sku);
    const total = BigInt(line.estimatedLineMinor!), count = BigInt(line.packs);
    const unit = line.estimatedUnitMinor === undefined ? (total % count === BigInt(0) ? String(total/count) : null) : line.estimatedUnitMinor;
    if (!money.safeParse(unit).success || BigInt(unit!) * count !== total) hold('source_changed','PO price arithmetic needs review.');
    if ((line.mappingId === undefined) !== (line.mappingVersion === undefined) ||
        line.mappingId !== undefined && (!id.safeParse(line.mappingId).success || !version.safeParse(line.mappingVersion).success)) {
      hold('source_changed','Incomplete mapping version.');
    }
    if (line.kind === 'stock') {
      if (!id.safeParse(line.productId).success || !id.safeParse(line.configId).success ||
          !version.safeParse(line.configVersion).success || !quantity.safeParse(line.stockUnitsPerPack).success ||
          !quantity.safeParse(line.stockQuantity).success ||
          line.stockQuantity!.dimension !== line.stockUnitsPerPack!.dimension ||
          BigInt(line.stockQuantity!.minor) !== BigInt(line.stockUnitsPerPack!.minor) * count) {
        hold('source_changed','Frozen stock conversion needs review.');
      }
    } else if (line.kind !== 'non_stock' || line.productId !== null || line.stockQuantity !== null ||
        line.stockUnitsPerPack !== null || line.configId !== null || line.configVersion !== null) {
      hold('source_changed','Non-stock lines cannot carry inventory effects.');
    }
    return {lineId:line.id, kind:line.kind, productId:line.productId, sku:line.sku,
      description:line.description, unitLabel:line.unitLabel, packs:line.packs,
      unitMinor:unit!, lineMinor:line.estimatedLineMinor!, stockUnitsPerPack:line.stockUnitsPerPack,
      stockQuantity:line.stockQuantity, configId:line.configId, configVersion:line.configVersion,
      mappingId:line.mappingId ?? null, mappingVersion:line.mappingVersion ?? null};
  });
  const subtotal = lines.reduce((sum,line)=>sum+BigInt(line.lineMinor),BigInt(0));
  if (String(subtotal) !== s.knownSubtotalMinor || subtotal > BigInt(s.capMinor)) {
    hold('source_changed','Known item subtotal or proposed cap needs review.');
  }
  return frozenCopy({contract:'pantrack.po-cart-preflight.v1',mode:'fictional',authorization:'required',
    actor,request,connection,sourceFingerprint:canonicalJson(s),currency:s.currency,
    capMinor:s.capMinor,itemSubtotalMinor:String(subtotal),lines});
}

export function assertPreparationUnchanged(previous:PreparationPreflight, current:PreparationPreflight):void {
  if (canonicalJson(previous) !== canonicalJson(current)) hold('source_changed','Preparation input changed. Obtain a new authorization.');
}
