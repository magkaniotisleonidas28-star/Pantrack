import type { UnitDimension } from './inventory-consumption-contract';
import { D1StockUsage, RECORDED_USE, type StockUsageView } from './d1-stock-usage';
import {
  D1ReplenishmentSettingsStore,
  ReplenishmentSettingsError,
  type ReplenishmentSettings,
  type SettingsActor,
} from './d1-replenishment-settings';
import {
  DEFAULT_COUNT_EVERY_DAYS,
  RUN_OUT_WINDOW_DAYS,
  suggestLevel,
  type Caution,
  type LevelSuggestion,
  type SupplierSchedule,
} from './stock-levels';
import { RECENT_USE_DAYS } from './stock-usage';
import { deliveryRhythmSchema, type DeliveryRhythm } from './purchasing-supplier-contract';

const DAY_MS = 86_400_000;
export const ACCEPT_REASON = 'Accepted Pantrack suggestion';

type Clock = { now(): Date };

export type StockLevelsView = Readonly<{
  usage: StockUsageView;
  caution: Caution;
  suggestions: readonly LevelSuggestion[];
  /** The current settings version per product, needed to accept a suggestion. */
  settingsVersions: Readonly<Record<string, number>>;
  /** Products with their own caution, overriding the café setting. */
  productCautions: Readonly<Record<string, Caution>>;
  /** Products whose current suggestion an owner or manager chose to ignore. */
  ignored: Readonly<Record<string, boolean>>;
}>;

export const CAFE = '*';
const CAUTIONS: readonly Caution[] = ['lean', 'balanced', 'cautious'];

export class StockLevelError extends Error {
  constructor(
    public readonly code: 'stale' | 'not_suggested' | 'conflict' | 'forbidden',
    message: string,
  ) {
    super(message);
    this.name = 'StockLevelError';
  }
}

const exactTotal = (value: number | string) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('Usage total is too large to use exactly.');
  return Number(value);
};

/** Reads suggestions (R1e) and accepts one as a new restocking-settings version. */
export class D1StockLevels {
  private readonly clock: Clock;

  constructor(
    private readonly db: D1Database,
    options: { clock?: Clock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async read(companyId: string): Promise<StockLevelsView> {
    const now = this.clock.now(),
      nowMs = now.getTime();
    const usage = await new D1StockUsage(this.db, this.clock).read(companyId);
    const windowStart = new Date(nowMs - RECENT_USE_DAYS * DAY_MS).toISOString(),
      runOutStart = new Date(nowMs - RUN_OUT_WINDOW_DAYS * DAY_MS).toISOString();
    const [daily, first, suppliers, runOuts, settings, cautions, ignores] = await Promise.all([
      this.db
        .prepare(
          `SELECT product_id,dimension,substr(effective_at,1,10) AS day,
            COALESCE(SUM(CAST(quantity_minor AS INTEGER)),0) AS total
          FROM inventory_events_exact
          WHERE company_id=? AND action IN ${RECORDED_USE} AND effective_at>=? AND effective_at<=?
          GROUP BY product_id,dimension,day`,
        )
        .bind(companyId, windowStart, now.toISOString())
        .all<{
          product_id: string;
          dimension: UnitDimension;
          day: string;
          total: number | string;
        }>(),
      this.db
        .prepare(
          `SELECT product_id,MIN(effective_at) AS first_at FROM inventory_events_exact
          WHERE company_id=? AND action IN ${RECORDED_USE} GROUP BY product_id`,
        )
        .bind(companyId)
        .all<{ product_id: string; first_at: string }>(),
      this.db
        .prepare(
          `SELECT DISTINCT m.product_id,s.id AS supplier_id,s.name,v.data_json
          FROM purchasing_mappings m
          JOIN purchasing_suppliers s ON s.company_id=m.company_id AND s.id=m.supplier_id
          JOIN purchasing_supplier_versions v ON v.company_id=s.company_id AND v.id=s.id AND v.version=s.version
          WHERE m.company_id=? AND m.status='active' AND s.status='active'`,
        )
        .bind(companyId)
        .all<{ product_id: string; supplier_id: string; name: string; data_json: string }>(),
      this.db
        .prepare(
          `SELECT r.product_id,COUNT(*) AS n FROM run_out_reports r
          LEFT JOIN run_out_resolutions s ON s.company_id=r.company_id AND s.report_id=r.id
          WHERE r.company_id=? AND r.reported_at>=? AND (s.outcome IS NULL OR s.outcome='confirmed')
          GROUP BY r.product_id`,
        )
        .bind(companyId, runOutStart)
        .all<{ product_id: string; n: number }>(),
      this.db
        .prepare(
          `SELECT v.product_id,v.version,v.dimension,v.settings_json FROM replenishment_settings_versions v
          WHERE v.company_id=? AND v.version=(SELECT MAX(version) FROM replenishment_settings_versions
            WHERE company_id=v.company_id AND product_id=v.product_id)`,
        )
        .bind(companyId)
        .all<{
          product_id: string;
          version: number;
          dimension: UnitDimension;
          settings_json: string;
        }>(),
      this.db
        .prepare('SELECT product_id,caution FROM stock_level_cautions WHERE company_id=?')
        .bind(companyId)
        .all<{ product_id: string; caution: Caution }>(),
      this.db
        .prepare('SELECT product_id,level_minor FROM stock_level_ignores WHERE company_id=?')
        .bind(companyId)
        .all<{ product_id: string; level_minor: string }>(),
    ]);
    const firstUse = new Map(first.results.map((r) => [r.product_id, r.first_at]));
    const known = (value: string): value is Caution => CAUTIONS.includes(value as Caution);
    const cafeRow = cautions.results.find((r) => r.product_id === CAFE);
    const caution: Caution = cafeRow && known(cafeRow.caution) ? cafeRow.caution : 'balanced';
    const productCautions: Record<string, Caution> = {};
    for (const row of cautions.results)
      if (row.product_id !== CAFE && known(row.caution))
        productCautions[row.product_id] = row.caution;
    const settingsVersions: Record<string, number> = {};
    const suggestions = usage.products.map((product) => {
      // Whole UTC days after the first recorded use (or the window start) and before today, each
      // with its total; part days would make use look more uneven than it is.
      const start = Math.max(
        Date.parse(windowStart),
        Date.parse(firstUse.get(product.productId) ?? now.toISOString()),
      );
      const midnight = (ms: number) => Date.parse(new Date(ms).toISOString().slice(0, 10)),
        firstDay = midnight(start) + DAY_MS,
        today = midnight(nowMs);
      const totals = new Map(
        daily.results
          .filter((r) => r.product_id === product.productId && r.dimension === product.dimension)
          .map((r) => [r.day, -exactTotal(r.total)]),
      );
      const days: number[] = [];
      for (let day = firstDay; day < today; day += DAY_MS)
        days.push(Math.max(0, totals.get(new Date(day).toISOString().slice(0, 10)) ?? 0));
      const mapped = new Map<
        string,
        { supplierId: string; supplierName: string; schedule: SupplierSchedule | null }
      >();
      for (const row of suppliers.results.filter((r) => r.product_id === product.productId)) {
        // Saved supplier versions are read as data and checked again before use.
        let rhythm: DeliveryRhythm | null = null;
        try {
          const parsed = deliveryRhythmSchema.safeParse(
            (JSON.parse(row.data_json) as { profile?: { deliveryRhythm?: unknown } }).profile
              ?.deliveryRhythm,
          );
          rhythm = parsed.success ? parsed.data : null;
        } catch {
          rhythm = null;
        }
        mapped.set(row.supplier_id, {
          supplierId: row.supplier_id,
          supplierName: row.name,
          schedule: rhythm
            ? {
                supplierId: row.supplier_id,
                supplierName: row.name,
                orderEveryDays: rhythm.orderEveryDays,
                deliveryDays: rhythm.deliveryDays,
              }
            : null,
        });
      }
      const current = settings.results.find((r) => r.product_id === product.productId);
      settingsVersions[product.productId] = current?.version ?? 0;
      let currentTarget = null;
      if (current && current.dimension === product.dimension) {
        try {
          currentTarget = (JSON.parse(current.settings_json) as ReplenishmentSettings).target;
        } catch {
          currentTarget = null;
        }
      }
      return suggestLevel({
        usage: product,
        dailyRecordedUse: days,
        suppliers: [...mapped.values()],
        runOutReports: Number(
          runOuts.results.find((r) => r.product_id === product.productId)?.n ?? 0,
        ),
        currentTarget,
        caution: productCautions[product.productId] ?? caution,
      });
    });
    // An ignored suggestion stays hidden only while the suggested level is the one ignored.
    const ignored: Record<string, boolean> = {};
    for (const row of ignores.results) {
      const current = suggestions.find((s) => s.productId === row.product_id);
      if (current?.status === 'suggested' && current.level?.minor === row.level_minor)
        ignored[row.product_id] = true;
    }
    return { usage, caution, suggestions, settingsVersions, productCautions, ignored };
  }

  /**
   * Saves the suggestion the person saw as the product's new level. Refused when the numbers have
   * changed since, so nobody accepts a level they did not see. A repeated request returns the
   * saved version.
   */
  async accept(
    input: {
      companyId: string;
      productId: string;
      operationId: string;
      expectedLevelMinor: string;
      expectedSettingsVersion: number;
    },
    actor: SettingsActor,
  ) {
    if (actor.role !== 'owner' && actor.role !== 'manager')
      throw new StockLevelError('forbidden', 'An owner or manager accepts suggested levels.');
    const store = new D1ReplenishmentSettingsStore(this.db, { clock: this.clock });
    const replay = await this.db
      .prepare(
        'SELECT version FROM replenishment_settings_versions WHERE company_id=? AND product_id=? AND change_id=?',
      )
      .bind(input.companyId, input.productId, input.operationId)
      .first<{ version: number }>();
    if (replay) {
      const saved = (await store.history(input.companyId, input.productId, actor)).find(
        (v) => v.version === replay.version,
      )!;
      if (
        saved.changeReason !== ACCEPT_REASON ||
        saved.settings.target.minor !== input.expectedLevelMinor ||
        saved.version !== input.expectedSettingsVersion + 1
      )
        throw new StockLevelError('conflict', 'That action reference was already used.');
      return saved;
    }
    const view = await this.read(input.companyId);
    const suggestion = view.suggestions.find((s) => s.productId === input.productId);
    if (!suggestion || suggestion.status !== 'suggested' || !suggestion.level || !suggestion.perDay)
      throw new StockLevelError('not_suggested', 'There is no suggestion for this product now.');
    if (
      suggestion.level.minor !== input.expectedLevelMinor ||
      (view.settingsVersions[input.productId] ?? 0) !== input.expectedSettingsVersion
    )
      throw new StockLevelError('stale', 'The numbers changed. Review the new suggestion first.');
    const config = await this.db
      .prepare(
        `SELECT c.id,c.version FROM inventory_config_versions c
        WHERE c.company_id=? AND c.product_id=? AND c.status='active'`,
      )
      .bind(input.companyId, input.productId)
      .first<{ id: string; version: number }>();
    if (!config) throw new StockLevelError('stale', 'Stock setup changed. Refresh and try again.');
    const prior = await store.current(input.companyId, input.productId, actor);
    const settings: ReplenishmentSettings = prior
      ? { ...prior.settings, target: suggestion.level, dailyUse: suggestion.perDay }
      : {
          target: suggestion.level,
          capacity: null,
          dailyUse: suggestion.perDay,
          shelfDays: null,
          countEveryDays: DEFAULT_COUNT_EVERY_DAYS,
          minimumPacks: '0',
          orderMultiplePacks: '1',
          maximumPacks: null,
        };
    try {
      return await store.save({
        companyId: input.companyId,
        productId: input.productId,
        changeId: input.operationId,
        expectedVersion: input.expectedSettingsVersion,
        expectedConfigId: config.id,
        expectedConfigVersion: config.version,
        actor,
        reason: ACCEPT_REASON,
        settings,
      });
    } catch (error) {
      if (
        error instanceof ReplenishmentSettingsError &&
        ['concurrent_update', 'config_changed'].includes(error.code)
      )
        throw new StockLevelError('stale', 'Settings just changed. Review the suggestion again.');
      if (error instanceof ReplenishmentSettingsError && error.code === 'change_conflict')
        throw new StockLevelError('conflict', 'That action reference was already used.');
      throw error;
    }
  }

  private manager(actor: SettingsActor) {
    if (actor.role !== 'owner' && actor.role !== 'manager')
      throw new StockLevelError('forbidden', 'An owner or manager changes suggestion settings.');
  }

  /**
   * Sets the café's caution (productId '*'), or one product's. 'cafe' removes a product's own
   * setting so it follows the café again.
   */
  async setCaution(
    input: { companyId: string; productId: string; caution: Caution | 'cafe' },
    actor: SettingsActor,
  ) {
    this.manager(actor);
    if (input.productId === CAFE && input.caution === 'cafe')
      throw new StockLevelError('not_suggested', 'Choose Lean, Balanced or Cautious for the café.');
    if (input.productId !== CAFE) {
      const stocked = await this.db
        .prepare('SELECT 1 AS ok FROM inventory_balances_exact WHERE company_id=? AND product_id=?')
        .bind(input.companyId, input.productId)
        .first<{ ok: number }>();
      if (!stocked) throw new StockLevelError('not_suggested', 'This product has no stock set up.');
    }
    if (input.caution === 'cafe') {
      await this.db
        .prepare('DELETE FROM stock_level_cautions WHERE company_id=? AND product_id=?')
        .bind(input.companyId, input.productId)
        .run();
      return { productId: input.productId, caution: 'cafe' as const };
    }
    await this.db
      .prepare(
        `INSERT INTO stock_level_cautions(company_id,product_id,caution,updated_by,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(company_id,product_id) DO UPDATE SET caution=excluded.caution,
          updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      )
      .bind(
        input.companyId,
        input.productId,
        input.caution,
        actor.userId,
        this.clock.now().toISOString(),
      )
      .run();
    return { productId: input.productId, caution: input.caution };
  }

  /** Hides the suggestion that was seen, until its numbers change. */
  async ignore(
    input: { companyId: string; productId: string; expectedLevelMinor: string },
    actor: SettingsActor,
  ) {
    this.manager(actor);
    const suggestion = (await this.read(input.companyId)).suggestions.find(
      (s) => s.productId === input.productId,
    );
    if (suggestion?.status !== 'suggested' || !suggestion.level)
      throw new StockLevelError('not_suggested', 'There is no suggestion for this product now.');
    if (suggestion.level.minor !== input.expectedLevelMinor)
      throw new StockLevelError('stale', 'The numbers changed. Review the new suggestion first.');
    await this.db
      .prepare(
        `INSERT INTO stock_level_ignores(company_id,product_id,level_minor,ignored_by,ignored_at) VALUES(?,?,?,?,?)
        ON CONFLICT(company_id,product_id) DO UPDATE SET level_minor=excluded.level_minor,
          ignored_by=excluded.ignored_by,ignored_at=excluded.ignored_at`,
      )
      .bind(
        input.companyId,
        input.productId,
        input.expectedLevelMinor,
        actor.userId,
        this.clock.now().toISOString(),
      )
      .run();
    return { productId: input.productId, ignored: true };
  }

  /** Shows an ignored suggestion again. */
  async unignore(input: { companyId: string; productId: string }, actor: SettingsActor) {
    this.manager(actor);
    await this.db
      .prepare('DELETE FROM stock_level_ignores WHERE company_id=? AND product_id=?')
      .bind(input.companyId, input.productId)
      .run();
    return { productId: input.productId, ignored: false };
  }
}
