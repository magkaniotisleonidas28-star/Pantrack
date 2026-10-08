import type {ExactQuantity} from './inventory-consumption-contract';
import type {ProposalHandoff} from './replenishment-lifecycle';
import {frozenCopy, supplierSource, type SupplierGroup} from './supplier-simulation-contract';

export const FICTIONAL_DRAFT_LABEL = 'Fictional review draft — not an order.';
export type SupplierOrderDraft = Readonly<{
  label: typeof FICTIONAL_DRAFT_LABEL;
  group: SupplierGroup;
  sourceFingerprint: string;
  lines: readonly Readonly<{handoff: ProposalHandoff; stockQuantity: ExactQuantity}>[];
  warnings: readonly string[];
}>;

/** A read-only projection of immutable A → C handoffs; no replenishment or price calculation. */
export function buildSupplierOrderDraft(values: unknown, expectedCompanyId: string): SupplierOrderDraft {
  const source = supplierSource(values, expectedCompanyId);
  return frozenCopy({
    label: FICTIONAL_DRAFT_LABEL, group: source.group, sourceFingerprint: source.fingerprint,
    lines: source.handoffs.map(handoff => ({handoff, stockQuantity: {
      dimension: handoff.stockUnitsPerPack.dimension,
      minor: (BigInt(handoff.packs) * BigInt(handoff.stockUnitsPerPack.minor)).toString(),
    }})),
    warnings: ['Fictional supplier mappings are unverified.',
      'Prices are estimates only; availability, fees, minimums, cutoffs and delivery are unverified.',
      'Review the current proposal and supplier details before any separate manual ordering.'],
  });
}

/** Canonical mass/volume are millionths of g/mL; count is whole each. No float or rounding. */
export function draftStockDisplay(quantity: ExactQuantity): string {
  const units = {count: 'each', mass: 'g', volume: 'mL'};
  if (quantity.dimension === 'count') return `${quantity.minor} each`;
  const digits = quantity.minor.padStart(7, '0');
  const fraction = digits.slice(-6).replace(/0+$/, '');
  return `${digits.slice(0, -6)}${fraction ? `.${fraction}` : ''} ${units[quantity.dimension]}`;
}

export function draftEstimateDisplay(estimate: ProposalHandoff['estimatedLineTotal']): string {
  if (estimate === null) return 'Unavailable';
  // The handoff does not define currency exponents. USD has a known two-digit scale.
  if (estimate.currency !== 'USD') return `${estimate.currency} ${estimate.minor} minor units (estimate)`;
  const digits = estimate.minor.padStart(3, '0');
  return `USD ${digits.slice(0, -2)}.${digits.slice(-2)} (estimate)`;
}

export function serializeSupplierDraftText(draft: SupplierOrderDraft): string {
  const {group} = draft;
  return [draft.label, `Company: ${group.companyId}`, `Supplier: ${group.supplierId}`,
    `Account: ${group.accountId}`, `Location: ${group.locationId}`, '',
    ...draft.lines.flatMap(({handoff: h, stockQuantity}) => [
      `Product: ${h.productId} | SKU: ${h.supplier.sku}`,
      `Proposal: ${h.proposalId} | revision: ${h.revision} | ${h.contract} | status: ${h.status}`,
      `Quantity: ${h.packs} whole packs`,
      `Per pack: ${draftStockDisplay(h.stockUnitsPerPack)} (${h.stockUnitsPerPack.dimension}, ${h.stockUnitsPerPack.minor} canonical minor units)`,
      `Stock quantity: ${draftStockDisplay(stockQuantity)} (${stockQuantity.minor} canonical minor units)`,
      `Estimated line price: ${draftEstimateDisplay(h.estimatedLineTotal)}`,
      `Warnings: ${JSON.stringify(h.warnings)}`, `Review reasons: ${JSON.stringify(h.reviewReasons)}`,
      `Edit reason: ${h.editReason === null ? 'None' : JSON.stringify(h.editReason)}`,
      `Sales source: ${h.salesReadiness.source} | ${h.salesReadiness.status}`, '',
    ]), ...draft.warnings, 'No supplier submission, approval, reservation or inventory change is recorded.', '',
  ].join('\n');
}

/** Quote every cell; neutralize formula prefixes even after leading whitespace/control characters. */
function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function serializeSupplierDraftCsv(draft: SupplierOrderDraft): string {
  const g = draft.group;
  const rows = [
    ['draft_label', 'company', 'supplier', 'account', 'location', 'contract', 'proposal', 'revision',
      'source_status', 'product', 'sku', 'whole_packs', 'stock_dimension', 'stock_minor_per_pack',
      'stock_minor_total', 'per_pack_display', 'stock_quantity_display', 'estimate_currency',
      'estimated_line_minor', 'estimated_line_price', 'warnings', 'review_reasons', 'edit_reason', 'sales_source', 'sales_status'],
    ...draft.lines.map(({handoff: h, stockQuantity}) => [
      draft.label, g.companyId, g.supplierId, g.accountId, g.locationId, h.contract, h.proposalId,
      String(h.revision), h.status, h.productId, h.supplier.sku, h.packs, h.stockUnitsPerPack.dimension,
      h.stockUnitsPerPack.minor, stockQuantity.minor, draftStockDisplay(h.stockUnitsPerPack),
      draftStockDisplay(stockQuantity), h.estimatedLineTotal?.currency ?? 'Unavailable',
      h.estimatedLineTotal?.minor ?? 'Unavailable', draftEstimateDisplay(h.estimatedLineTotal),
      JSON.stringify([...h.warnings, ...draft.warnings]), JSON.stringify(h.reviewReasons),
      h.editReason ?? 'None', h.salesReadiness.source, h.salesReadiness.status,
    ]),
  ];
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
