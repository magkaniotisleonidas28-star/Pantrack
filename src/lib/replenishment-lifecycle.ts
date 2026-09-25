import type {ProposalOrigin} from './d1-replenishment-proposal-origins';
import type {SettingsActor} from './d1-replenishment-settings';

export const REPLENISHMENT_HANDOFF_CONTRACT = 'pantrack.replenishment-handoff.v1' as const;

export type ProposalStatus =
  | 'draft' | 'review_required' | 'approved' | 'sending' | 'unknown'
  | 'accepted' | 'rejected' | 'canceled' | 'partially_received' | 'closed';

export type ProposalSourceVersions = Readonly<{
  inventoryVersion: number;
  inventoryConfigId: string;
  inventoryConfigVersion: number;
  settingsChangeId: string;
  settingsVersion: number;
}>;

export type ProposalInvalidationReason =
  | 'inventory_changed' | 'inventory_config_changed' | 'settings_changed'
  | 'source_unavailable';

export function proposalInvalidation(
  origin: ProposalOrigin,
  current: ProposalSourceVersions | null,
): readonly ProposalInvalidationReason[] {
  if (current === null) return ['source_unavailable'];
  const snapshot = origin.snapshot;
  const reasons: ProposalInvalidationReason[] = [];
  if (snapshot.inventoryVersion !== current.inventoryVersion) reasons.push('inventory_changed');
  if (snapshot.inventoryConfigId !== current.inventoryConfigId ||
      snapshot.inventoryConfigVersion !== current.inventoryConfigVersion) reasons.push('inventory_config_changed');
  if (snapshot.settingsChangeId !== current.settingsChangeId ||
      snapshot.settingsVersion !== current.settingsVersion) reasons.push('settings_changed');
  return reasons;
}

/** The A-owned state graph; supplier states are recorded only by a future C consumer. */
export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = Object.freeze({
  draft: ['review_required', 'approved', 'canceled'],
  review_required: ['draft', 'canceled'],
  approved: ['review_required', 'sending', 'canceled'],
  sending: ['unknown', 'accepted', 'rejected'],
  unknown: ['accepted', 'rejected'],
  accepted: ['partially_received', 'closed'],
  rejected: ['closed'],
  canceled: ['closed'],
  partially_received: ['closed'],
  closed: [],
});
for (const next of Object.values(PROPOSAL_TRANSITIONS)) Object.freeze(next);

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return Object.prototype.hasOwnProperty.call(PROPOSAL_TRANSITIONS, from) && PROPOSAL_TRANSITIONS[from].includes(to);
}

/** Unknown and accepted supplier outcomes keep their quantity held until resolved. */
export function retainsUnresolvedQuantity(status: ProposalStatus): boolean {
  if (!Object.prototype.hasOwnProperty.call(PROPOSAL_TRANSITIONS, status)) throw new Error('Proposal status is invalid.');
  return status !== 'rejected' && status !== 'canceled' && status !== 'closed';
}

export type ProposalPackEdit = Readonly<{
  companyId: string;
  proposalId: string;
  packs: string;
  reason: string;
  changedBy: string;
  estimatedLineTotal: ProposalOrigin['snapshot']['estimatedLineTotal'];
}>;

/** Validate a manager's review-only quantity change before it enters the audit log. */
export function prepareProposalPackEdit(
  origin: ProposalOrigin,
  current: ProposalSourceVersions | null,
  actor: SettingsActor,
  packs: string,
  reason: string,
): ProposalPackEdit {
  if (!actor || actor.companyId !== origin.companyId || !['owner', 'manager'].includes(actor.role) ||
      typeof actor.userId !== 'string' || !actor.userId.trim()) throw new Error('Proposal edit is forbidden.');
  if (typeof reason !== 'string' || reason.trim().length < 4 || reason.length > 500) throw new Error('A manager edit reason is required.');
  if (typeof packs !== 'string' || !/^(?:0|[1-9]\d*)$/.test(packs) || packs.length > 20) throw new Error('Edited packs must be a canonical nonnegative integer.');
  if (proposalInvalidation(origin, current).length) throw new Error('Proposal sources changed; generate a new proposal.');
  const wanted = BigInt(packs);
  if (wanted > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Edited packs exceed supported policy bounds.');
  const snapshot = origin.snapshot;
  const upper = [snapshot.explanation.capacityPacks, snapshot.explanation.shelfLifePacks,
    snapshot.explanation.maximumPacks].filter((value): value is string => value !== null)
    .reduce<bigint | null>((limit, value) => limit === null || BigInt(value) < limit ? BigInt(value) : limit, null);
  if (upper !== null && wanted > upper) throw new Error('Edited packs exceed a safety limit.');
  if (wanted > BigInt(0) && wanted < BigInt(snapshot.policy.minimumPacks)) throw new Error('Edited packs are below the minimum order.');
  if (wanted % BigInt(snapshot.policy.orderMultiplePacks) !== BigInt(0)) throw new Error('Edited packs violate the order multiple.');
  if (snapshot.explanation.reviewReasons.includes('opening_count_required') && wanted > BigInt(0)) {
    throw new Error('An opening count is required before choosing packs.');
  }
  if (snapshot.explanation.reviewReasons.includes('expired_stock') && wanted > BigInt(0)) {
    throw new Error('Expired stock requires a new proposal.');
  }
  const estimatedLineTotal = snapshot.priceEstimate === null ? null : Object.freeze({
    currency: snapshot.priceEstimate.currency,
    minor: (wanted * BigInt(snapshot.priceEstimate.perPackMinor)).toString(),
  });
  return Object.freeze({
    companyId: origin.companyId, proposalId: origin.id, packs, reason: reason.trim(),
    changedBy: actor.userId, estimatedLineTotal,
  });
}

export type ProposalHandoff = Readonly<{
  contract: typeof REPLENISHMENT_HANDOFF_CONTRACT;
  mode: 'review_only';
  companyId: string;
  proposalId: string;
  revision: number;
  status: ProposalStatus;
  productId: string;
  supplier: ProposalOrigin['snapshot']['supplier'];
  packs: string;
  stockUnitsPerPack: ProposalOrigin['snapshot']['quantities']['pack'];
  estimatedLineTotal: ProposalOrigin['snapshot']['estimatedLineTotal'];
  inventoryVersion: number;
  inventoryConfigId: string;
  inventoryConfigVersion: number;
  settingsVersion: number;
  settingsChangeId: string;
  editReason: string | null;
  editedBy: string | null;
  reviewReasons: readonly string[];
  invalidationReasons: readonly ProposalInvalidationReason[];
  supplierSubmissionAllowed: false;
}>;

/** A versioned, immutable consumer shape. Fictional sources can never authorize submission. */
export function buildProposalHandoff(
  origin: ProposalOrigin,
  status: ProposalStatus,
  revision: number,
  current: ProposalSourceVersions | null,
  latestEdit: ProposalPackEdit | null = null,
): ProposalHandoff {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Proposal revision is invalid.');
  if (!Object.prototype.hasOwnProperty.call(PROPOSAL_TRANSITIONS, status)) throw new Error('Proposal status is invalid.');
  const snapshot = origin.snapshot;
  if (latestEdit !== null && (latestEdit.companyId !== origin.companyId || latestEdit.proposalId !== origin.id)) {
    throw new Error('Proposal edit belongs to another proposal.');
  }
  const invalidationReasons = Object.freeze([...proposalInvalidation(origin, current)]);
  const reviewReasons = Object.freeze([...snapshot.explanation.reviewReasons]);
  const supplier = Object.freeze({...snapshot.supplier});
  const stockUnitsPerPack = Object.freeze({...snapshot.quantities.pack});
  const editedTotal = latestEdit === null ? snapshot.estimatedLineTotal : latestEdit.estimatedLineTotal;
  const estimatedLineTotal = editedTotal === null ? null : Object.freeze({...editedTotal});
  return Object.freeze({
    contract: REPLENISHMENT_HANDOFF_CONTRACT, mode: 'review_only',
    companyId: origin.companyId, proposalId: origin.id, revision, status,
    productId: origin.productId, supplier,
    packs: latestEdit?.packs ?? snapshot.explanation.recommendedPacks, stockUnitsPerPack,
    estimatedLineTotal,
    inventoryVersion: snapshot.inventoryVersion,
    inventoryConfigId: snapshot.inventoryConfigId,
    inventoryConfigVersion: snapshot.inventoryConfigVersion,
    settingsVersion: snapshot.settingsVersion, settingsChangeId: snapshot.settingsChangeId,
    editReason: latestEdit?.reason ?? null, editedBy: latestEdit?.changedBy ?? null,
    reviewReasons, invalidationReasons, supplierSubmissionAllowed: false,
  });
}
