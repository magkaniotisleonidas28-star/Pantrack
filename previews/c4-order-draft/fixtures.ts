import {buildReviewProposal, type ReviewProposalInput} from '../../src/lib/replenishment-proposal';
import {buildProposalHandoff, type ProposalHandoff} from '../../src/lib/replenishment-lifecycle';

export const FICTIONAL_COMPANY = 'Fictional Juniper Café';
function handoff(productId: string, dimension: 'count' | 'mass' | 'volume', pack: string, price: string | null): ProposalHandoff {
  const q = (multiple: number) => ({dimension, minor: (BigInt(pack) * BigInt(multiple)).toString()});
  const versions = {inventoryVersion: 1, inventoryConfigId: `fictional-config-${productId}`,
    inventoryConfigVersion: 1, settingsChangeId: `fictional-settings-${productId}`, settingsVersion: 1};
  const input: ReviewProposalInput = {
    companyId: FICTIONAL_COMPANY, productId, ...versions, settingsChangedBy: 'fictional-manager',
    calculatedAt: '2026-10-01T12:00:00.000Z', lastCountAt: '2026-10-01T11:00:00.000Z',
    countEveryDays: 7, expiresAt: null, expiryStatus: 'not_checked',
    salesReadiness: {source: 'fictional_fixture', status: 'current', heldEventCount: 0},
    supplier: {source: 'fictional_fixture', mappingId: `fictional-mapping-${productId}`, mappingVersion: 1,
      supplierId: 'Fictional Orchard Supply', accountId: 'DEMO-ACCOUNT', locationId: 'Fictional NYC stockroom', sku: `DEMO-${productId}`},
    priceEstimate: price === null ? null : {source: 'fictional_fixture', currency: 'USD', perPackMinor: price},
    quantities: {target: q(4), onHand: q(1), incoming: q(0), pack: q(1), capacity: q(5), shelfLimit: null},
    policy: {minimumPacks: '0', orderMultiplePacks: '1', maximumPacks: '4'},
  };
  const snapshot = buildReviewProposal(input);
  return buildProposalHandoff({companyId: FICTIONAL_COMPANY, id: `fictional-proposal-${productId}`,
    createId: `fictional-create-${productId}`, productId, snapshot, initialStatus: 'review_required',
    createdBy: 'fictional-manager', createdAt: input.calculatedAt},
    'review_required', 2, versions);
}

export function fictionalDraftExamples(): Record<'normal' | 'missing' | 'invalid', readonly ProposalHandoff[]> {
  const normal = [handoff('Oat milk', 'volume', '6000000000', '2450'),
    handoff('Café beans, "house"', 'mass', '2267961850', '4250'), handoff('Paper cups', 'count', '500', '1800')];
  const missing = [...normal.slice(0, 2), handoff('Paper cups', 'count', '500', null)];
  const invalid = [{...normal[0], invalidationReasons: ['inventory_changed'] as const,
    warnings: [...normal[0].warnings, 'inventory_changed']}];
  return {normal, missing, invalid};
}
