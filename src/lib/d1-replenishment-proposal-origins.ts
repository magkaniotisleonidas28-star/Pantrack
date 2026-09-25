import {D1ReplenishmentReview, validateReviewFixtures, type ReviewSourceRequest} from './d1-replenishment-review';
import type {SettingsActor} from './d1-replenishment-settings';
import {buildReviewProposal, type ReviewProposalSnapshot} from './replenishment-proposal';

export type ProposalOriginStatus = 'draft' | 'review_required';
export type ProposalOrigin = Readonly<{
  companyId: string;
  id: string;
  createId: string;
  productId: string;
  initialStatus: ProposalOriginStatus;
  snapshot: ReviewProposalSnapshot;
  createdBy: string;
  createdAt: string;
}>;
export type CreateProposalOriginInput = ReviewSourceRequest & Readonly<{id: string; createId: string}>;

export class ProposalOriginError extends Error {
  constructor(public readonly code: 'invalid_request' | 'forbidden' | 'source_unavailable' | 'source_changed' | 'quantity_reserved' | 'create_conflict' | 'id_conflict' | 'corrupt_store' | 'storage_failure', message: string) {
    super(message);
    this.name = 'ProposalOriginError';
  }
}

type StoredRow = {
  company_id: string; id: string; create_id: string; product_id: string;
  initial_status: ProposalOriginStatus; snapshot_json: string;
  created_by: string; created_at: string;
};
type Clock = {now(): Date};

function identifier(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new ProposalOriginError('invalid_request', 'Proposal company, ID, or product is invalid.');
  }
}

function actorFor(actor: SettingsActor, companyId: string, write: boolean): void {
  if (!actor || actor.companyId !== companyId || !['owner', 'manager', 'employee'].includes(actor.role)) {
    throw new ProposalOriginError('forbidden', 'Company access is required.');
  }
  identifier(actor.userId);
  if (write && actor.role === 'employee') throw new ProposalOriginError('forbidden', 'An owner or manager must create a proposal.');
}

export function initialProposalStatus(snapshot: ReviewProposalSnapshot): ProposalOriginStatus {
  return snapshot.explanation.reviewReasons.length ? 'review_required' : 'draft';
}

function decode(row: StoredRow): ProposalOrigin {
  try {
    const parsed = JSON.parse(row.snapshot_json) as ReviewProposalSnapshot;
    const snapshot = buildReviewProposal(parsed);
    if (JSON.stringify(snapshot) !== row.snapshot_json || snapshot.companyId !== row.company_id ||
        snapshot.productId !== row.product_id || initialProposalStatus(snapshot) !== row.initial_status) {
      throw new Error('Saved snapshot differs from its source fields.');
    }
    return Object.freeze({
      companyId: row.company_id, id: row.id, createId: row.create_id, productId: row.product_id,
      initialStatus: row.initial_status, snapshot, createdBy: row.created_by, createdAt: row.created_at,
    });
  } catch {
    throw new ProposalOriginError('corrupt_store', 'Saved proposal origin failed validation.');
  }
}

function sameRequest(prior: ProposalOrigin, request: CreateProposalOriginInput): boolean {
  const snapshot = prior.snapshot;
  const source = {
    salesReadiness: {source: request.sales.source, status: request.sales.status, heldEventCount: request.sales.heldEventCount},
    supplier: {
      source: request.supplier.source, mappingId: request.supplier.mappingId, mappingVersion: request.supplier.mappingVersion,
      supplierId: request.supplier.supplierId, accountId: request.supplier.accountId,
      locationId: request.supplier.locationId, sku: request.supplier.sku,
    },
    priceEstimate: request.priceEstimate === null ? null : {
      source: request.priceEstimate.source, currency: request.priceEstimate.currency,
      perPackMinor: request.priceEstimate.perPackMinor,
    },
  };
  return prior.id === request.id && prior.productId === request.productId && prior.createdBy === request.actor.userId &&
    JSON.stringify({salesReadiness: snapshot.salesReadiness, supplier: snapshot.supplier, priceEstimate: snapshot.priceEstimate}) === JSON.stringify(source);
}

/** Stores only the immutable, review-only origin. Later A7 states belong in append-only history. */
export class D1ReplenishmentProposalOrigins {
  private readonly review: D1ReplenishmentReview;
  private readonly clock: Clock;
  constructor(private readonly db: D1Database, options: {clock?: Clock} = {}) {
    this.clock = options.clock ?? {now: () => new Date()};
    this.review = new D1ReplenishmentReview(db, {clock: this.clock});
  }

  private async byCreate(companyId: string, createId: string): Promise<ProposalOrigin | null> {
    const row = await this.db.prepare('SELECT * FROM replenishment_proposal_origins WHERE company_id=? AND create_id=?')
      .bind(companyId, createId).first<StoredRow>();
    return row ? decode(row) : null;
  }

  async get(companyId: string, id: string, actor: SettingsActor): Promise<ProposalOrigin | null> {
    identifier(companyId); identifier(id); actorFor(actor, companyId, false);
    const row = await this.db.prepare('SELECT * FROM replenishment_proposal_origins WHERE company_id=? AND id=?')
      .bind(companyId, id).first<StoredRow>();
    return row ? decode(row) : null;
  }

  async create(request: CreateProposalOriginInput): Promise<ProposalOrigin> {
    identifier(request.companyId); identifier(request.productId); identifier(request.id); identifier(request.createId);
    actorFor(request.actor, request.companyId, true);
    try { validateReviewFixtures(request); }
    catch { throw new ProposalOriginError('invalid_request', 'Review fixtures must be valid and belong to this company.'); }
    const prior = await this.byCreate(request.companyId, request.createId);
    if (prior) {
      if (sameRequest(prior, request)) return prior;
      throw new ProposalOriginError('create_conflict', 'This create ID already represents a different proposal.');
    }
    const review = await this.review.build(request);
    if (review.kind === 'unavailable') throw new ProposalOriginError('source_unavailable', `Review source is unavailable: ${review.reason}.`);
    const snapshot = review.snapshot;
    const status = initialProposalStatus(snapshot);
    const snapshotJson = JSON.stringify(snapshot);
    const at = this.clock.now().toISOString();
    try {
      const result = await this.db.prepare(`INSERT INTO replenishment_proposal_origins
        (company_id,id,create_id,product_id,initial_status,snapshot_json,created_by,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM inventory_balances_exact b
          JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
          JOIN replenishment_settings_versions s ON s.company_id=b.company_id AND s.product_id=b.product_id AND s.version=?
          WHERE b.company_id=? AND b.product_id=? AND b.version=? AND b.config_id=?
            AND c.version=? AND c.status='active' AND s.change_id=?
            AND s.inventory_config_id=b.config_id AND s.inventory_config_version=c.version
            AND s.dimension=b.dimension
            AND s.version=(SELECT MAX(version) FROM replenishment_settings_versions
              WHERE company_id=b.company_id AND product_id=b.product_id)
        )`)
        .bind(request.companyId, request.id, request.createId, request.productId, status, snapshotJson,
          request.actor.userId, at, snapshot.settingsVersion, request.companyId, request.productId,
          snapshot.inventoryVersion, snapshot.inventoryConfigId, snapshot.inventoryConfigVersion,
          snapshot.settingsChangeId).run();
      if (Number(result.meta?.changes ?? 0) !== 1) {
        throw new ProposalOriginError('source_changed', 'Inventory or settings changed before this proposal was stored.');
      }
    } catch (error) {
      if (error instanceof ProposalOriginError) throw error;
      const replay = await this.byCreate(request.companyId, request.createId);
      if (replay) {
        if (sameRequest(replay, request)) return replay;
        throw new ProposalOriginError('create_conflict', 'This create ID already represents a different proposal.');
      }
      if (await this.get(request.companyId, request.id, request.actor)) {
        throw new ProposalOriginError('id_conflict', 'This proposal ID already exists.');
      }
      const reserved = await this.db.prepare(`SELECT 1 FROM replenishment_proposal_states
        WHERE company_id=? AND product_id=? AND packs!='0'
          AND status NOT IN ('rejected','canceled','closed') LIMIT 1`)
        .bind(request.companyId, request.productId).first();
      if (reserved) throw new ProposalOriginError('quantity_reserved', 'An unresolved proposal already holds this product quantity.');
      throw new ProposalOriginError('storage_failure', 'Proposal origin could not be stored.');
    }
    const saved = await this.byCreate(request.companyId, request.createId);
    if (!saved) throw new ProposalOriginError('corrupt_store', 'A saved proposal origin is missing.');
    return saved;
  }
}
