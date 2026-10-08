import {canonicalJson, frozenCopy, validateSupplierQuote, type SupplierCapability, type SupplierSource,
  type SupplierQuote, type SupplierLookupResult, type SupplierTerminalResult} from './supplier-simulation-contract';

export type FakeSupplierScenario = 'accepted' | 'rejected' | 'lost_response' | 'timeout' | 'malformed' | 'mismatched';
export type FakeSupplierConnector = Readonly<{
  capabilities: Readonly<Record<'quote' | 'submit' | 'status' | 'delivery' | 'portal', SupplierCapability>>;
  quote(source: SupplierSource, id: string, now: Date): SupplierQuote;
  submit(reference: string, quote: SupplierQuote): Promise<unknown>;
  lookup(reference: string): Promise<SupplierLookupResult>;
  readonly calls: number;
}>;
const registered = new WeakSet<object>();
export function isFakeSupplierConnector(value: unknown): value is FakeSupplierConnector {
  return value !== null && typeof value === 'object' && registered.has(value);
}
/** Network-free fixture. Frozen methods and private registry prevent injecting a live adapter. */
export function createFakeSupplierConnector(options: {scenario?: FakeSupplierScenario; unitPriceMinor: number; feeMinor: number; quoteTtlMs: number}): FakeSupplierConnector {
  const fixture = frozenCopy(options);
  if (!['accepted','rejected','lost_response','timeout','malformed','mismatched'].includes(fixture.scenario ?? 'accepted') ||
      !Number.isInteger(fixture.unitPriceMinor) || fixture.unitPriceMinor < 0 || fixture.unitPriceMinor > 1_000_000 ||
      !Number.isInteger(fixture.feeMinor) || fixture.feeMinor < 0 || fixture.feeMinor > 1_000_000 ||
      !Number.isSafeInteger(fixture.quoteTtlMs) || fixture.quoteTtlMs < 1 || fixture.quoteTtlMs > 86_400_000) throw new Error('Invalid supplier fixture.');
  let calls = 0;
  const outcomes = new Map<string, SupplierTerminalResult>();
  const connector: FakeSupplierConnector = Object.freeze({
    capabilities: Object.freeze({quote:'supported',submit:'supported',status:'supported',delivery:'unavailable',portal:'unverified'} as const),
    get calls() {return calls;},
    quote(source: SupplierSource, id: string, now: Date): SupplierQuote {
      const lines = source.handoffs.map(h => ({proposalId:h.proposalId,revision:h.revision,productId:h.productId,
        sku:h.supplier.sku,packs:h.packs,stockUnitsPerPack:h.stockUnitsPerPack,unitPriceMinor:fixture.unitPriceMinor,
        lineTotalMinor:Number(BigInt(h.packs) * BigInt(fixture.unitPriceMinor))}));
      return validateSupplierQuote({id,group:source.group,sourceFingerprint:source.fingerprint,currency:'USD',lines,
        fees:[{label:'fictional delivery',minor:fixture.feeMinor}],totalMinor:lines.reduce((n,l)=>n+l.lineTotalMinor,fixture.feeMinor),
        quotedAt:now.toISOString(),expiresAt:new Date(now.getTime()+fixture.quoteTtlMs).toISOString(),provenance:'simulated'},source,now);
    },
    async submit(reference: string, quote: SupplierQuote): Promise<unknown> {
      calls++;
      if (fixture.scenario === 'timeout') throw new Error('Simulated timeout before outcome.');
      const result = frozenCopy({status:fixture.scenario === 'rejected' ? 'rejected' : 'accepted',reference,
        group:quote.group,quoteFingerprint:canonicalJson(quote),externalId:`fake-${calls}`,provenance:'simulated'} as const);
      outcomes.set(reference, result);
      if (fixture.scenario === 'lost_response') throw new Error('Simulated lost response after acceptance.');
      if (fixture.scenario === 'malformed') return {status:'accepted'};
      if (fixture.scenario === 'mismatched') return {...result,reference:'another-order'};
      return result;
    },
    async lookup(reference: string): Promise<SupplierLookupResult> {return outcomes.get(reference) ?? {status:'not_found'};},
  });
  registered.add(connector);
  return connector;
}
