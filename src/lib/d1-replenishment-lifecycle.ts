import {D1ReplenishmentProposalOrigins, type ProposalOrigin} from './d1-replenishment-proposal-origins';
import type {SettingsActor} from './d1-replenishment-settings';
import {
  buildProposalHandoff, prepareProposalPackEdit, proposalInvalidation, PROPOSAL_TRANSITIONS,
  type ProposalHandoff, type ProposalInvalidationReason, type ProposalPackEdit,
  type ProposalSourceVersions, type ProposalStatus,
} from './replenishment-lifecycle';

type StateRow = {
  company_id: string; proposal_id: string; product_id: string; revision: number;
  status: ProposalStatus; packs: string; change_id: string; kind: string;
  changed_by: string; reason: string; changed_at: string;
  invalidation_reason: ProposalInvalidationReason | null;
};
type EventRow = {
  company_id: string; proposal_id: string; revision: number; change_id: string;
  kind: 'create' | 'edit' | 'invalidate' | 'cancel' | 'supplier';
  from_status: ProposalStatus | null; status: ProposalStatus; packs: string;
  actor: string; reason: string; at: string;
  invalidation_reason: ProposalInvalidationReason | null;
};
type CurrentRow = {
  inventory_version: number; inventory_config_id: string; inventory_config_version: number;
  settings_version: number; settings_change_id: string; config_status: string;
};
type Clock = {now(): Date};

export type ProposalLifecycleEvent = Readonly<{
  revision: number; changeId: string; kind: EventRow['kind'];
  fromStatus: ProposalStatus | null; status: ProposalStatus; packs: string;
  actor: string; reason: string; at: string;
  invalidationReason: ProposalInvalidationReason | null;
}>;
export type ProposalLifecycleView = Readonly<{
  origin: ProposalOrigin; status: ProposalStatus; revision: number; packs: string;
  invalidationReason: ProposalInvalidationReason | null;
  events: readonly ProposalLifecycleEvent[]; handoff: ProposalHandoff;
}>;

export class ProposalLifecycleError extends Error {
  constructor(public readonly code: 'invalid_request' | 'forbidden' | 'missing' | 'conflict' | 'source_changed' | 'quantity_reserved' | 'corrupt_store' | 'storage_failure', message: string) {
    super(message);
    this.name = 'ProposalLifecycleError';
  }
}

function identifier(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new ProposalLifecycleError('invalid_request', 'Proposal identifier is invalid.');
  }
}
function reasonText(value: string): string {
  if (typeof value !== 'string' || value.trim().length < 4 || value.length > 500) {
    throw new ProposalLifecycleError('invalid_request', 'A reason of 4 to 500 characters is required.');
  }
  return value.trim();
}
function actorFor(actor: SettingsActor, companyId: string, write: boolean): void {
  if (!actor || actor.companyId !== companyId || !['owner', 'manager', 'employee'].includes(actor.role) ||
      typeof actor.userId !== 'string' || !actor.userId.trim()) {
    throw new ProposalLifecycleError('forbidden', 'Company access is required.');
  }
  if (write && actor.role === 'employee') throw new ProposalLifecycleError('forbidden', 'A manager or owner is required.');
}
function changeId(value: string): void {
  identifier(value);
  if (value.startsWith('origin:') || value.startsWith('invalidation:')) {
    throw new ProposalLifecycleError('invalid_request', 'This change ID prefix is reserved.');
  }
}
function revision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new ProposalLifecycleError('invalid_request', 'Expected revision is invalid.');
}
function sourceArgs(origin: ProposalOrigin): readonly (string | number)[] {
  const s = origin.snapshot;
  return [origin.companyId, origin.productId, s.inventoryVersion, s.inventoryConfigId,
    s.inventoryConfigVersion, s.settingsVersion, s.settingsChangeId];
}
const SOURCE_MATCH = `EXISTS (
 SELECT 1 FROM inventory_balances_exact b
 JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
 JOIN replenishment_settings_versions v ON v.company_id=b.company_id AND v.product_id=b.product_id
 WHERE b.company_id=? AND b.product_id=? AND b.version=? AND b.config_id=?
  AND c.version=? AND c.status='active' AND v.version=? AND v.change_id=?
  AND v.inventory_config_id=b.config_id AND v.inventory_config_version=c.version
  AND v.version=(SELECT MAX(version) FROM replenishment_settings_versions
   WHERE company_id=b.company_id AND product_id=b.product_id)
)`;

/** Review-only D1 lifecycle. Every mutation is one SQL statement with database audit triggers. */
export class D1ReplenishmentLifecycle {
  private readonly origins: D1ReplenishmentProposalOrigins;
  private readonly clock: Clock;
  constructor(private readonly db: D1Database, options: {clock?: Clock} = {}) {
    this.clock = options.clock ?? {now: () => new Date()};
    this.origins = new D1ReplenishmentProposalOrigins(db, {clock: this.clock});
  }

  private async current(origin: ProposalOrigin): Promise<ProposalSourceVersions | null> {
    const row = await this.db.prepare(`SELECT b.version AS inventory_version,b.config_id AS inventory_config_id,
      c.version AS inventory_config_version,c.status AS config_status,
      v.version AS settings_version,v.change_id AS settings_change_id
      FROM inventory_balances_exact b
      JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
      JOIN replenishment_settings_versions v ON v.company_id=b.company_id AND v.product_id=b.product_id
       AND v.version=(SELECT MAX(version) FROM replenishment_settings_versions
        WHERE company_id=b.company_id AND product_id=b.product_id)
      WHERE b.company_id=? AND b.product_id=?`)
      .bind(origin.companyId, origin.productId).first<CurrentRow>();
    if (!row || row.config_status !== 'active') return null;
    return {
      inventoryVersion: row.inventory_version, inventoryConfigId: row.inventory_config_id,
      inventoryConfigVersion: row.inventory_config_version,
      settingsVersion: row.settings_version, settingsChangeId: row.settings_change_id,
    };
  }

  private async state(origin: ProposalOrigin): Promise<StateRow> {
    const row = await this.db.prepare('SELECT * FROM replenishment_proposal_states WHERE company_id=? AND proposal_id=?')
      .bind(origin.companyId, origin.id).first<StateRow>();
    if (!row || row.product_id !== origin.productId ||
        !Object.prototype.hasOwnProperty.call(PROPOSAL_TRANSITIONS, row.status)) {
      throw new ProposalLifecycleError('corrupt_store', 'Proposal state is missing or invalid.');
    }
    return row;
  }

  private async refresh(origin: ProposalOrigin, state: StateRow, current: ProposalSourceVersions | null): Promise<void> {
    if (state.invalidation_reason !== null ||
        ['rejected', 'canceled', 'closed'].includes(state.status) ||
        proposalInvalidation(origin, current).length === 0) return;
    const why = proposalInvalidation(origin, current)[0];
    await this.db.prepare(`UPDATE replenishment_proposal_states
      SET revision=revision+1,
       status=CASE WHEN status IN ('draft','approved') THEN 'review_required' ELSE status END,
       change_id=?,kind='invalidate',changed_by='system',reason=?,changed_at=?,invalidation_reason=?
      WHERE company_id=? AND proposal_id=? AND invalidation_reason IS NULL
       AND status NOT IN ('rejected','canceled','closed') AND NOT ${SOURCE_MATCH}`)
      .bind(`invalidation:${origin.id}`, `Proposal source changed: ${why}`, this.clock.now().toISOString(),
        why, origin.companyId, origin.id, ...sourceArgs(origin)).run();
  }

  private async events(origin: ProposalOrigin): Promise<readonly ProposalLifecycleEvent[]> {
    const result = await this.db.prepare(`SELECT * FROM replenishment_proposal_events
      WHERE company_id=? AND proposal_id=? ORDER BY revision`)
      .bind(origin.companyId, origin.id).all<EventRow>();
    return Object.freeze(result.results.map(row => Object.freeze({
      revision: row.revision, changeId: row.change_id, kind: row.kind,
      fromStatus: row.from_status, status: row.status, packs: row.packs,
      actor: row.actor, reason: row.reason, at: row.at,
      invalidationReason: row.invalidation_reason,
    })));
  }

  async get(companyId: string, proposalId: string, actor: SettingsActor): Promise<ProposalLifecycleView | null> {
    identifier(companyId); identifier(proposalId); actorFor(actor, companyId, false);
    const origin = await this.origins.get(companyId, proposalId, actor);
    if (!origin) return null;
    const before = await this.state(origin);
    const current = await this.current(origin);
    await this.refresh(origin, before, current);
    const state = await this.state(origin);
    const history = await this.events(origin);
    if (history.length !== state.revision || history.at(-1)?.status !== state.status ||
        history.at(-1)?.packs !== state.packs) {
      throw new ProposalLifecycleError('corrupt_store', 'Proposal audit history does not match its state.');
    }
    const lastEdit = [...history].reverse().find(event => event.kind === 'edit');
    const latestEdit: ProposalPackEdit | null = lastEdit ? {
      companyId, proposalId, packs: lastEdit.packs, reason: lastEdit.reason,
      changedBy: lastEdit.actor,
      estimatedLineTotal: origin.snapshot.priceEstimate === null ? null : {
        currency: origin.snapshot.priceEstimate.currency,
        minor: (BigInt(lastEdit.packs) * BigInt(origin.snapshot.priceEstimate.perPackMinor)).toString(),
      },
    } : null;
    if (latestEdit && latestEdit.packs !== state.packs) {
      throw new ProposalLifecycleError('corrupt_store', 'Proposal edited quantity differs from its audit history.');
    }
    return Object.freeze({
      origin, status: state.status, revision: state.revision, packs: state.packs,
      invalidationReason: state.invalidation_reason, events: history,
      handoff: buildProposalHandoff(origin, state.status, state.revision, current, latestEdit),
    });
  }

  private async prior(companyId: string, id: string): Promise<EventRow | null> {
    return this.db.prepare('SELECT * FROM replenishment_proposal_events WHERE company_id=? AND change_id=?')
      .bind(companyId, id).first<EventRow>();
  }

  async edit(input: Readonly<{
    companyId: string; proposalId: string; expectedRevision: number; changeId: string;
    actor: SettingsActor; packs: string; reason: string;
  }>): Promise<ProposalLifecycleView> {
    identifier(input.companyId); identifier(input.proposalId); changeId(input.changeId);
    actorFor(input.actor, input.companyId, true); revision(input.expectedRevision);
    const reason = reasonText(input.reason);
    const existing = await this.prior(input.companyId, input.changeId);
    if (existing) {
      if (existing.proposal_id === input.proposalId && existing.kind === 'edit' &&
          existing.actor === input.actor.userId && existing.packs === input.packs && existing.reason === reason) {
        const replay = await this.get(input.companyId, input.proposalId, input.actor);
        if (replay) return replay;
      }
      throw new ProposalLifecycleError('conflict', 'Change ID already belongs to another edit.');
    }
    const view = await this.get(input.companyId, input.proposalId, input.actor);
    if (!view) throw new ProposalLifecycleError('missing', 'Proposal was not found.');
    if (view.revision !== input.expectedRevision || !['draft', 'review_required'].includes(view.status) ||
        view.invalidationReason !== null) throw new ProposalLifecycleError('conflict', 'Proposal revision or state changed.');
    const current = await this.current(view.origin);
    let edit: ProposalPackEdit;
    try { edit = prepareProposalPackEdit(view.origin, current, input.actor, input.packs, reason); }
    catch { throw new ProposalLifecycleError('invalid_request', 'Quantity edit violates current review rules.'); }
    let result: D1Result;
    try {
      result = await this.db.prepare(`UPDATE replenishment_proposal_states
        SET revision=revision+1,packs=?,change_id=?,kind='edit',changed_by=?,reason=?,changed_at=?
        WHERE company_id=? AND proposal_id=? AND revision=? AND status IN ('draft','review_required')
         AND invalidation_reason IS NULL AND ${SOURCE_MATCH}`)
        .bind(edit.packs, input.changeId, input.actor.userId, edit.reason, this.clock.now().toISOString(),
          input.companyId, input.proposalId, input.expectedRevision, ...sourceArgs(view.origin)).run();
    } catch {
      const duplicate = await this.prior(input.companyId, input.changeId);
      if (duplicate) throw new ProposalLifecycleError('conflict', 'Change ID already exists.');
      const competing = await this.db.prepare(`SELECT 1 FROM replenishment_proposal_states
        WHERE company_id=? AND product_id=? AND proposal_id!=? AND packs!='0'
          AND status NOT IN ('rejected','canceled','closed') LIMIT 1`)
        .bind(input.companyId, view.origin.productId, input.proposalId).first();
      if (competing) throw new ProposalLifecycleError('quantity_reserved', 'Another unresolved proposal holds this product quantity.');
      throw new ProposalLifecycleError('storage_failure', 'Proposal edit could not be stored.');
    }
    if (Number(result.meta?.changes ?? 0) !== 1) {
      throw new ProposalLifecycleError('source_changed', 'Proposal sources or revision changed before the edit was stored.');
    }
    return (await this.get(input.companyId, input.proposalId, input.actor))!;
  }

  async cancel(input: Readonly<{
    companyId: string; proposalId: string; expectedRevision: number; changeId: string;
    actor: SettingsActor; reason: string;
  }>): Promise<ProposalLifecycleView> {
    identifier(input.companyId); identifier(input.proposalId); changeId(input.changeId);
    actorFor(input.actor, input.companyId, true); revision(input.expectedRevision);
    const reason = reasonText(input.reason);
    const existing = await this.prior(input.companyId, input.changeId);
    if (existing) {
      if (existing.proposal_id === input.proposalId && existing.kind === 'cancel' &&
          existing.actor === input.actor.userId && existing.reason === reason) {
        const replay = await this.get(input.companyId, input.proposalId, input.actor);
        if (replay) return replay;
      }
      throw new ProposalLifecycleError('conflict', 'Change ID already belongs to another action.');
    }
    const view = await this.get(input.companyId, input.proposalId, input.actor);
    if (!view) throw new ProposalLifecycleError('missing', 'Proposal was not found.');
    if (view.revision !== input.expectedRevision || !['draft', 'review_required', 'approved'].includes(view.status)) {
      throw new ProposalLifecycleError('conflict', 'Proposal cannot be canceled from this revision or state.');
    }
    let result: D1Result;
    try {
      result = await this.db.prepare(`UPDATE replenishment_proposal_states
        SET revision=revision+1,status='canceled',change_id=?,kind='cancel',changed_by=?,reason=?,changed_at=?
        WHERE company_id=? AND proposal_id=? AND revision=? AND status IN ('draft','review_required','approved')`)
        .bind(input.changeId, input.actor.userId, reason, this.clock.now().toISOString(),
          input.companyId, input.proposalId, input.expectedRevision).run();
    } catch {
      const duplicate = await this.prior(input.companyId, input.changeId);
      if (duplicate) throw new ProposalLifecycleError('conflict', 'Change ID already exists.');
      throw new ProposalLifecycleError('storage_failure', 'Proposal cancellation could not be stored.');
    }
    if (Number(result.meta?.changes ?? 0) !== 1) throw new ProposalLifecycleError('conflict', 'Proposal revision changed.');
    return (await this.get(input.companyId, input.proposalId, input.actor))!;
  }
}
