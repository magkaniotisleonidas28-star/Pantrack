import {REPLENISHMENT_HANDOFF_CONTRACT, type ProposalHandoff} from './replenishment-lifecycle';

export type FakeSupplierHold = Readonly<{
  kind: 'held';
  handoff: ProposalHandoff;
  reasons: readonly string[];
}>;

export class FakeSupplierConsumerError extends Error {
  constructor(public readonly code: 'forbidden' | 'invalid_handoff' | 'revision_conflict' | 'stale_revision' | 'origin_changed', message: string) {
    super(message);
    this.name = 'FakeSupplierConsumerError';
  }
}

type RecordValue = Record<string, unknown>;
type Saved = Readonly<{revision: number; payload: string; origin: string; hold: FakeSupplierHold}>;
const STATUSES = new Set(['draft', 'review_required', 'approved', 'sending', 'unknown', 'accepted', 'rejected', 'canceled', 'partially_received', 'closed']);
const INVALIDATION_REASONS = new Set(['inventory_changed', 'inventory_config_changed', 'settings_changed', 'source_unavailable']);
const HANDOFF_KEYS = [
  'contract', 'mode', 'companyId', 'proposalId', 'revision', 'status', 'productId',
  'supplier', 'salesReadiness', 'priceSource', 'packs', 'stockUnitsPerPack',
  'estimatedLineTotal', 'estimatedProposalTotal', 'deliveryExpectedAt', 'limitPacks',
  'inventoryVersion', 'inventoryConfigId', 'inventoryConfigVersion',
  'settingsVersion', 'settingsChangeId', 'editReason', 'editedBy',
  'reviewReasons', 'invalidationReasons', 'warnings', 'supplierSubmissionAllowed',
] as const;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return record(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}
function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function canonical(value: unknown, positive = false): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value) &&
    (!positive || value !== '0');
}
function money(value: unknown): value is {currency: string; minor: string} {
  return exactKeys(value, ['currency', 'minor']) && record(value) &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) &&
    canonical(value.minor);
}
function textList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function invalid(): never {
  throw new FakeSupplierConsumerError('invalid_handoff', 'The A7 proposal handoff is incomplete or unsafe.');
}

function validate(value: unknown, expectedCompanyId: string): ProposalHandoff {
  if (!id(expectedCompanyId)) throw new FakeSupplierConsumerError('forbidden', 'A company context is required.');
  if (!record(value)) invalid();
  if (value.companyId !== expectedCompanyId) throw new FakeSupplierConsumerError('forbidden', 'The proposal belongs to another company.');
  if (!exactKeys(value, HANDOFF_KEYS)) invalid();
  if (value.contract !== REPLENISHMENT_HANDOFF_CONTRACT || value.mode !== 'review_only' ||
      value.supplierSubmissionAllowed !== false || !id(value.proposalId) || !id(value.productId) ||
      !version(value.revision) || !STATUSES.has(String(value.status)) || !canonical(value.packs) ||
      value.deliveryExpectedAt !== null) invalid();
  if (!exactKeys(value.stockUnitsPerPack, ['dimension', 'minor']) || !record(value.stockUnitsPerPack) ||
      !['count', 'mass', 'volume'].includes(String(value.stockUnitsPerPack.dimension)) ||
      !canonical(value.stockUnitsPerPack.minor, true)) invalid();
  if (!exactKeys(value.supplier, ['source', 'mappingId', 'mappingVersion', 'supplierId', 'accountId', 'locationId', 'sku']) ||
      !record(value.supplier) || value.supplier.source !== 'fictional_fixture' ||
      !id(value.supplier.mappingId) || !version(value.supplier.mappingVersion) ||
      !id(value.supplier.supplierId) || !id(value.supplier.accountId) ||
      !id(value.supplier.locationId) || !id(value.supplier.sku)) invalid();
  if (!exactKeys(value.salesReadiness, ['source', 'status', 'heldEventCount']) ||
      !record(value.salesReadiness) || value.salesReadiness.source !== 'fictional_fixture' ||
      !['current', 'degraded', 'unknown'].includes(String(value.salesReadiness.status)) ||
      !Number.isSafeInteger(value.salesReadiness.heldEventCount) ||
      Number(value.salesReadiness.heldEventCount) < 0) invalid();
  if (value.priceSource !== null && value.priceSource !== 'fictional_fixture') invalid();
  if ((value.priceSource === null && (value.estimatedLineTotal !== null || value.estimatedProposalTotal !== null)) ||
      (value.priceSource !== null && (!money(value.estimatedLineTotal) || !money(value.estimatedProposalTotal)))) invalid();
  if (value.priceSource !== null &&
      ((value.estimatedLineTotal as {currency: string}).currency !== (value.estimatedProposalTotal as {currency: string}).currency ||
        (value.estimatedLineTotal as {minor: string}).minor !== (value.estimatedProposalTotal as {minor: string}).minor)) invalid();
  if (!exactKeys(value.limitPacks, ['capacity', 'shelfLife', 'maximum']) ||
      !record(value.limitPacks) || ![value.limitPacks.capacity, value.limitPacks.shelfLife, value.limitPacks.maximum]
    .every(limit => limit === null || canonical(limit))) invalid();
  for (const limit of [value.limitPacks.capacity, value.limitPacks.shelfLife, value.limitPacks.maximum]) {
    if (limit !== null && BigInt(value.packs as string) > BigInt(limit as string)) invalid();
  }
  if (!version(value.inventoryVersion) || !id(value.inventoryConfigId) || !version(value.inventoryConfigVersion) ||
      !version(value.settingsVersion) || !id(value.settingsChangeId)) invalid();
  if ((value.editReason === null) !== (value.editedBy === null) ||
      (value.editReason !== null && (typeof value.editReason !== 'string' || value.editReason.trim().length < 4 || !id(value.editedBy)))) invalid();
  const reviewReasons = value.reviewReasons;
  const invalidationReasons = value.invalidationReasons;
  const warnings = value.warnings;
  if (!textList(reviewReasons) || !Array.isArray(invalidationReasons) ||
      !invalidationReasons.every(reason => INVALIDATION_REASONS.has(String(reason))) ||
      !textList(warnings)) invalid();
  if (!warnings.includes('delivery_unconfirmed') ||
      !warnings.includes('supplier_mapping_unverified') ||
      !warnings.includes(value.priceSource === null ? 'price_unavailable' : 'price_estimate_only') ||
      ![...reviewReasons, ...invalidationReasons].every(reason => warnings.includes(reason))) invalid();
  return value as ProposalHandoff;
}

function immutableOrigin(handoff: ProposalHandoff): string {
  return canonicalJson({
    companyId: handoff.companyId, proposalId: handoff.proposalId, productId: handoff.productId,
    supplier: handoff.supplier, salesReadiness: handoff.salesReadiness,
    priceSource: handoff.priceSource, stockUnitsPerPack: handoff.stockUnitsPerPack,
    limitPacks: handoff.limitPacks, reviewReasons: handoff.reviewReasons,
    inventoryVersion: handoff.inventoryVersion, inventoryConfigId: handoff.inventoryConfigId,
    inventoryConfigVersion: handoff.inventoryConfigVersion, settingsVersion: handoff.settingsVersion,
    settingsChangeId: handoff.settingsChangeId,
  });
}

/** C4's in-memory contract consumer. It has no supplier client or submission method. */
export class C4FakeSupplierConsumer {
  private readonly received = new Map<string, Saved>();

  consume(value: unknown, expectedCompanyId: string): FakeSupplierHold {
    const validated = validate(value, expectedCompanyId);
    const copy = freeze(structuredClone(validated));
    const key = `${copy.companyId.length}:${copy.companyId}:${copy.proposalId}`;
    const payload = canonicalJson(copy);
    const origin = immutableOrigin(copy);
    const previous = this.received.get(key);
    if (previous) {
      if (previous.origin !== origin) throw new FakeSupplierConsumerError('origin_changed', 'An immutable proposal field changed.');
      if (copy.revision < previous.revision) throw new FakeSupplierConsumerError('stale_revision', 'An older proposal revision was received.');
      if (copy.revision === previous.revision) {
        if (previous.payload !== payload) throw new FakeSupplierConsumerError('revision_conflict', 'The same revision has different contents.');
        return previous.hold;
      }
    }
    const hold = freeze({
      kind: 'held' as const, handoff: copy,
      reasons: ['review_only', 'fictional_supplier', 'submission_disabled', ...copy.warnings],
    });
    this.received.set(key, {revision: copy.revision, payload, origin, hold});
    return hold;
  }
}
