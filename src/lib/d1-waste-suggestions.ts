import { D1WasteService } from './d1-waste';
import { D1MenuWasteService } from './d1-menu-waste';
import { CURATED_UNIT_IDS } from './inventory-quantities';
import { shortUnitLabel } from './unit-preferences';
import {
  checkedEntries,
  readPhoto,
  SuggestionError,
  wasteSuggestionOutcome,
  wasteSuggestionRequest,
  type ReaderCatalogItem,
  type SuggestedEntry,
  type WasteReader,
} from './waste-suggestion-contract';

/** Where a suggested entry goes in the normal waste forms. */
export type SuggestionTarget =
  | { form: 'menu'; sourceKind: 'product' | 'recipe'; sourceId: string; sourceVersion: string }
  | { form: 'ingredient'; productId: string; unitId: string };

export type ResolvedSuggestion = SuggestedEntry & { target: SuggestionTarget };

export type WasteSuggestionResult = {
  operationId: string;
  status: 'suggested' | 'empty' | 'failed';
  entries: ResolvedSuggestion[];
  message: string;
};

type Row = {
  fingerprint: string;
  status: 'pending' | 'suggested' | 'empty' | 'failed';
  entries_json: string;
  created_at: string;
};

/** A read still pending after this long was interrupted; it is reported, never read again. */
const STALE_PENDING_MS = 120_000;

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const messages = {
  suggested: 'Check the suggestion, change anything that is wrong, then save.',
  empty: 'Pantrack could not match this to your items. Fill in the waste form instead.',
  failed: 'The photo could not be read. Fill in the waste form, or try another photo.',
};

/**
 * Photo waste suggestions (decision 0010). Each request is claimed by its
 * operation ID before the reader runs, so a repeat never reads (or bills) twice.
 * Only the photo's fingerprint is stored.
 */
export class D1WasteSuggestions {
  constructor(
    private readonly db: D1Database,
    private readonly reader: WasteReader,
    private readonly options: { clock?: { now(): Date } } = {},
  ) {}

  private now() {
    return (this.options.clock?.now() ?? new Date()).toISOString();
  }

  /** The company's waste items the reader may choose from, keyed by opaque refs. */
  async catalog(companyId: string) {
    const [menu, ingredients] = await Promise.all([
      new D1MenuWasteService(this.db).options(companyId, false),
      new D1WasteService(this.db).options(companyId),
    ]);
    const entries: Array<{ item: ReaderCatalogItem; target: SuggestionTarget }> = [];
    menu.items
      .filter((m) => m.ready && m.offered)
      .forEach((m, i) =>
        entries.push({
          item: { ref: `m${i + 1}`, name: m.name, kind: 'menu' },
          target: { form: 'menu', sourceKind: m.kind, sourceId: m.id, sourceVersion: m.version },
        }),
      );
    // A product sold ready-made appears once, as the menu item.
    const sold = new Set(
      menu.items.filter((m) => m.kind === 'product' && m.ready && m.offered).map((m) => m.id),
    );
    ingredients.items
      .filter((g) => !sold.has(g.productId))
      .forEach((g, i) =>
        entries.push({
          item: {
            ref: `i${i + 1}`,
            name: g.name,
            kind: 'ingredient',
            unit: CURATED_UNIT_IDS.some((id) => id === g.unitId)
              ? shortUnitLabel(g.unitId)
              : g.unitLabel,
          },
          target: { form: 'ingredient', productId: g.productId, unitId: g.unitId },
        }),
      );
    return entries;
  }

  private result(operationId: string, row: Row): WasteSuggestionResult {
    if (
      row.status === 'pending' &&
      Date.parse(this.now()) - Date.parse(row.created_at) > STALE_PENDING_MS
    )
      return { operationId, status: 'failed', entries: [], message: messages.failed };
    if (row.status === 'pending')
      throw new SuggestionError(
        'operation_conflict',
        'This photo is still being read. Wait a moment, then try again.',
      );
    return {
      operationId,
      status: row.status,
      entries: JSON.parse(row.entries_json) as ResolvedSuggestion[],
      message: messages[row.status],
    };
  }

  async suggest(input: unknown, actor: string): Promise<WasteSuggestionResult> {
    const request = wasteSuggestionRequest.parse(input);
    const bytes = readPhoto(request.photo);
    const fingerprint = await sha256(
      new TextEncoder().encode(JSON.stringify([request.note, await sha256(bytes)])),
    );
    const existing = () =>
      this.db
        .prepare(
          'SELECT fingerprint,status,entries_json,created_at FROM waste_suggestions WHERE company_id=? AND id=?',
        )
        .bind(request.companyId, request.operationId)
        .first<Row>();
    const replay = (row: Row) => {
      if (row.fingerprint !== fingerprint)
        throw new SuggestionError(
          'operation_conflict',
          'This request was already used for a different photo or note.',
        );
      return this.result(request.operationId, row);
    };
    const prior = await existing();
    if (prior) return replay(prior);
    const catalog = await this.catalog(request.companyId);
    // Claim the request before reading, so concurrent repeats cannot read it twice.
    const claim = await this.db
      .prepare(
        `INSERT INTO waste_suggestions(company_id,id,actor,fingerprint,note,status,created_at)
        VALUES (?,?,?,?,?,'pending',?) ON CONFLICT(company_id,id) DO NOTHING`,
      )
      .bind(request.companyId, request.operationId, actor, fingerprint, request.note, this.now())
      .run();
    if (claim.meta.changes !== 1) {
      const raced = await existing();
      if (!raced) throw new SuggestionError('reader_failed', messages.failed);
      return replay(raced);
    }
    let status: 'suggested' | 'empty' | 'failed' = 'failed',
      entries: ResolvedSuggestion[] = [],
      usage = {
        provider: null as string | null,
        model: null as string | null,
        input: 0,
        output: 0,
        cost: 0,
      };
    try {
      const output = await this.reader.read({
        photo: { mediaType: request.photo.mediaType, bytes },
        note: request.note,
        catalog: catalog.map((c) => c.item),
        reasons: ['end_of_day', 'spilled', 'spoiled', 'preparation_error', 'other'],
      });
      usage = {
        provider: output.provider,
        model: output.model,
        input: Math.max(0, Math.trunc(output.inputTokens) || 0),
        output: Math.max(0, Math.trunc(output.outputTokens) || 0),
        cost: Math.max(0, Math.trunc(output.costMicroUsd) || 0),
      };
      entries = checkedEntries(
        output.entries,
        catalog.map((c) => c.item),
      ).map((entry) => ({
        ...entry,
        target: catalog.find((c) => c.item.ref === entry.ref)!.target,
      }));
      status = entries.length ? 'suggested' : 'empty';
    } catch {
      status = 'failed';
    }
    await this.db
      .prepare(
        `UPDATE waste_suggestions SET status=?,provider=?,model=?,input_tokens=?,output_tokens=?,cost_micro_usd=?,entries_json=?,completed_at=?
        WHERE company_id=? AND id=? AND status='pending'`,
      )
      .bind(
        status,
        usage.provider,
        usage.model,
        usage.input,
        usage.output,
        usage.cost,
        JSON.stringify(entries),
        this.now(),
        request.companyId,
        request.operationId,
      )
      .run();
    return { operationId: request.operationId, status, entries, message: messages[status] };
  }

  /**
   * Records what the person did, for measuring accuracy (W4f). Only the person
   * who asked can record it. "Edited" outranks "confirmed", and "discarded"
   * applies only when nothing was saved from the suggestion.
   */
  async recordOutcome(input: unknown, actor: string) {
    const b = wasteSuggestionOutcome.parse(input);
    await this.db
      .prepare(
        `UPDATE waste_suggestions SET outcome=?,outcome_at=? WHERE company_id=? AND id=? AND actor=? AND status='suggested'
        AND (outcome IS NULL OR (outcome='confirmed' AND ?='edited') OR (outcome='discarded' AND ?<>'discarded'))`,
      )
      .bind(b.outcome, this.now(), b.companyId, b.operationId, actor, b.outcome, b.outcome)
      .run();
    const row = await this.db
      .prepare(
        "SELECT outcome FROM waste_suggestions WHERE company_id=? AND id=? AND actor=? AND status='suggested'",
      )
      .bind(b.companyId, b.operationId, actor)
      .first<{ outcome: string | null }>();
    if (!row) throw new SuggestionError('not_found', 'This suggestion is no longer available.');
    return { operationId: b.operationId, outcome: row.outcome };
  }
}
