import {z} from 'zod';
import {C4FakeSupplierConsumer} from './c4-fake-supplier-consumer';
import type {ProposalHandoff} from './replenishment-lifecycle';

export type SupplierCapability = 'supported' | 'unavailable' | 'unverified';
export type SupplierProvenance = 'simulated' | 'human_verified' | 'provider_verified';
export type SupplierOrderStatus = 'awaiting_quote' | 'awaiting_approval' | 'approved' | 'sending' | 'unknown' | 'accepted' | 'rejected' | 'canceled';
export class SupplierSimulationError extends Error {
  constructor(public readonly code: 'invalid_request' | 'forbidden' | 'missing' | 'source_changed' | 'conflict' | 'guard_failed' | 'simulation_only', message: string) {
    super(message); this.name = 'SupplierSimulationError';
  }
}
export function fail(code: SupplierSimulationError['code'], message: string): never {throw new SupplierSimulationError(code, message);}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('invalid_request', 'Undefined command field.');
  return encoded;
}
export function frozenCopy<T>(value: T): T {
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === 'object') {Object.values(item).forEach(freeze); Object.freeze(item);}
  };
  const copy = structuredClone(value); freeze(copy); return copy;
}
export const supplierId = z.string().trim().min(1).max(200);
// Bounded below SQLite's signed integer and JS safe integer limits, including aggregate exposure.
export const moneyMinor = z.number().int().min(0).max(1_000_000_000);
const positivePacks = z.string().regex(/^[1-9]\d{0,8}$/);
const stockQuantity = z.object({dimension: z.enum(['count', 'mass', 'volume']), minor: z.string().regex(/^[1-9]\d{0,29}$/)}).strict();
const groupSchema = z.object({companyId: supplierId, supplierId, accountId: supplierId, locationId: supplierId}).strict();
const lineSchema = z.object({proposalId: supplierId, revision: z.number().int().positive(), productId: supplierId,
  sku: supplierId, packs: positivePacks, stockUnitsPerPack: stockQuantity,
  unitPriceMinor: moneyMinor, lineTotalMinor: moneyMinor}).strict();
const iso = z.string().refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
export const supplierQuoteSchema = z.object({id: supplierId, group: groupSchema, sourceFingerprint: z.string().min(1).max(100_000),
  currency: z.literal('USD'), lines: z.array(lineSchema).min(1).max(50),
  fees: z.array(z.object({label: supplierId, minor: moneyMinor}).strict()).max(20),
  totalMinor: moneyMinor, quotedAt: iso, expiresAt: iso, provenance: z.literal('simulated')}).strict();
export type SupplierGroup = z.infer<typeof groupSchema>;
export type SupplierQuote = Readonly<z.infer<typeof supplierQuoteSchema>>;
export type SupplierSource = Readonly<{group: SupplierGroup; handoffs: readonly ProposalHandoff[]; fingerprint: string}>;

export function supplierSource(values: unknown, companyId: string): SupplierSource {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50 || JSON.stringify(values).length > 100_000) fail('invalid_request', 'One to fifty bounded proposal handoffs are required.');
  const consumer = new C4FakeSupplierConsumer();
  let handoffs: ProposalHandoff[];
  try {handoffs = values.map(v => consumer.consume(v, companyId).handoff).sort((a,b) => a.proposalId.localeCompare(b.proposalId));}
  catch {return fail('invalid_request', 'Invalid or foreign proposal handoff.');}
  const first = handoffs[0].supplier;
  const group = {companyId, supplierId: first.supplierId, accountId: first.accountId, locationId: first.locationId};
  const products = new Set<string>(), proposals = new Set<string>();
  for (const h of handoffs) {
    if (!positivePacks.safeParse(h.packs).success || !stockQuantity.safeParse(h.stockUnitsPerPack).success ||
        !['draft','review_required','approved'].includes(h.status) || h.invalidationReasons.length ||
        h.salesReadiness.status !== 'current' || h.salesReadiness.heldEventCount !== 0 ||
        h.reviewReasons.some(r => ['opening_count_required','expired_stock'].includes(r)) ||
        h.supplier.supplierId !== group.supplierId || h.supplier.accountId !== group.accountId || h.supplier.locationId !== group.locationId ||
        products.has(h.productId) || proposals.has(h.proposalId)) fail('invalid_request', 'Unsafe, duplicate or mixed-group source.');
    products.add(h.productId); proposals.add(h.proposalId);
  }
  return frozenCopy({group, handoffs, fingerprint: canonicalJson(handoffs)});
}
export function validateSupplierQuote(value: unknown, source: SupplierSource, now: Date): SupplierQuote {
  const parsed = supplierQuoteSchema.safeParse(value);
  if (!parsed.success) fail('invalid_request', 'Invalid final supplier quote.');
  const quote = parsed.data;
  if (canonicalJson(quote.group) !== canonicalJson(source.group) || quote.sourceFingerprint !== source.fingerprint ||
      quote.lines.length !== source.handoffs.length || Date.parse(quote.quotedAt) > now.getTime() ||
      Date.parse(quote.expiresAt) <= now.getTime() || Date.parse(quote.expiresAt) <= Date.parse(quote.quotedAt)) fail('invalid_request', 'Quote group, source or expiry differs.');
  let total = BigInt(0);
  quote.lines.forEach((line, i) => {
    const h = source.handoffs[i];
    if (line.proposalId !== h.proposalId || line.revision !== h.revision || line.productId !== h.productId ||
        line.sku !== h.supplier.sku || line.packs !== h.packs || canonicalJson(line.stockUnitsPerPack) !== canonicalJson(h.stockUnitsPerPack) ||
        BigInt(line.lineTotalMinor) !== BigInt(line.packs) * BigInt(line.unitPriceMinor)) fail('invalid_request', 'Quote changed a source line or conversion.');
    total += BigInt(line.lineTotalMinor);
  });
  for (const fee of quote.fees) total += BigInt(fee.minor);
  if (total !== BigInt(quote.totalMinor)) fail('invalid_request', 'Final quote total does not include exact lines and fees.');
  return frozenCopy(quote);
}
const resultSchema = z.object({status: z.enum(['accepted','rejected']), reference: z.string().min(1).max(500),
  group: groupSchema, quoteFingerprint: z.string().min(1).max(150_000),
  externalId: supplierId, provenance: z.literal('simulated')}).strict();
export type SupplierTerminalResult = Readonly<z.infer<typeof resultSchema>>;
export type SupplierLookupResult = SupplierTerminalResult | Readonly<{status:'not_found' | 'unknown'}>;
export function matchingSupplierResult(value: unknown, reference: string, quote: SupplierQuote): SupplierTerminalResult | null {
  const result = resultSchema.safeParse(value);
  if (!result.success || result.data.reference !== reference || canonicalJson(result.data.group) !== canonicalJson(quote.group) ||
      result.data.quoteFingerprint !== canonicalJson(quote)) return null;
  return frozenCopy(result.data);
}
