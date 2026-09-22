import {
  INVENTORY_CONSUMPTION_CONTRACT, type ConsumptionIssue, type InventoryConsumptionPort,
  type InventoryConsumptionRequest, type InventoryConsumptionResult, type UnitDimension,
} from '@/lib/inventory-consumption-contract';
import {
  InventoryConsumptionEngine, canonicalConsumptionFingerprint, consumptionInstant,
  validateConsumptionRequest, type RecipeIngredient,
} from '@/lib/inventory-consumption-engine';
import {D1InventoryConsumptionStore, InventoryCommitError} from '@/lib/d1-inventory-consumption-store';
import {CONSUMPTION_SNAPSHOT_SQL, type ConsumptionSnapshot, type IngredientRow} from '@/lib/inventory-consumption-snapshot';

const dimension = (value: string | null): value is UnitDimension => value !== null && ['mass', 'volume', 'count'].includes(value);
function classified(unit: ConsumptionSnapshot['units'][number] | undefined) {
  return unit && ['curated', 'custom'].includes(unit.kind) && dimension(unit.dimension) &&
    /^[1-9]\d*$/.test(unit.numerator ?? '') && /^[1-9]\d*$/.test(unit.denominator ?? '');
}

/** Internal company-bound port. The caller must authenticate and authorize first.
 * No route is connected until the M2/A2/A3 acceptance and cutover reviews pass.
 */
export class D1InventoryConsumptionPort implements InventoryConsumptionPort {
  private readonly store: D1InventoryConsumptionStore;
  constructor(private readonly db: D1Database, private readonly companyId: string,
    private readonly actor: string, private readonly clock: () => string = () => new Date().toISOString()) {
    this.store = new D1InventoryConsumptionStore(db, companyId);
    if (!actor) throw new Error('Server-selected inventory actor is required.');
  }

  async consume(input: InventoryConsumptionRequest): Promise<InventoryConsumptionResult> {
    const request = structuredClone(input);
    const base = {contract: INVENTORY_CONSUMPTION_CONTRACT, companyId: this.companyId,
      idempotencyKey: request?.idempotencyKey ?? '', replayed: false} as const;
    const rejected = (issue: ConsumptionIssue): InventoryConsumptionResult => ({...base, status: 'rejected', issues: [issue]});
    if (!request || request.companyId !== this.companyId) return rejected({code: 'invalid_request', message: 'Request does not belong to the authorized company.'});
    const now = this.clock();
    const nowInstant = consumptionInstant(now);
    if (nowInstant === null) throw new Error('Invalid inventory server clock.');
    const issue = validateConsumptionRequest(request, nowInstant);
    if (issue) return rejected(issue);
    const fingerprint = canonicalConsumptionFingerprint(request);
    const recipeIdsJson = JSON.stringify([...new Set(request.lines.map(line => line.recipeId))].sort());
    try {
      // Retry a bounded number of whole calculations, never individual writes.
      for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await this.store.application(request.idempotencyKey, fingerprint);
        if (saved) return saved;
        const row = await this.db.prepare(CONSUMPTION_SNAPSHOT_SQL).bind(this.companyId, recipeIdsJson).first<{snapshot: string}>();
        if (!row) throw new Error('Inventory snapshot unavailable.');
        const state = JSON.parse(row.snapshot) as ConsumptionSnapshot;
        const ingredient = (item: IngredientRow): RecipeIngredient => {
          const unit = state.units.find(unit => unit.product_id === item.product_id && unit.unit_id === item.unit_id && unit.version === item.unit_version);
          const issue = !classified(unit) ? 'unit_unclassified' :
            !dimension(item.dimension) || unit!.dimension !== item.dimension || item.quantity_minor === null ? 'unit_incompatible' : undefined;
          return {productId: item.product_id, quantity: {dimension: dimension(item.dimension) ? item.dimension : 'count', minor: item.quantity_minor ?? 'invalid'}, issue};
        };
        const engine = new InventoryConsumptionEngine({
          now,
          balances: state.balances.map(balance => {
            const config = state.configs.find(config => config.product_id === balance.product_id && config.id === balance.config_id);
            const unit = state.units.find(unit => unit.product_id === balance.product_id && unit.unit_id === config?.stock_unit_id && unit.version === config?.stock_unit_version);
            return {companyId: this.companyId, productId: balance.product_id,
              dimension: balance.dimension as UnitDimension, onHandMinor: balance.on_hand_minor, version: balance.version,
              openingCountAt: balance.latest_count_effective_at,
              classified: Boolean(config?.status === 'active' && classified(unit) && unit!.dimension === balance.dimension)};
          }),
          recipes: state.recipes.filter(version => !version.legacy).map(version => ({
            companyId: this.companyId, recipeId: version.recipe_id, versionId: version.id, status: version.status,
            activeFrom: version.active_from, activeTo: version.active_to,
            ingredients: state.ingredients.filter(item => item.recipe_id === version.recipe_id && item.version_id === version.id).map(ingredient),
          })),
          modifiers: state.modifiers.map(version => ({
            companyId: this.companyId, recipeId: version.recipe_id, modifierId: version.modifier_id!, versionId: version.id,
            status: version.status, activeFrom: version.active_from, activeTo: version.active_to,
            deltas: state.deltas.filter(item => item.recipe_id === version.recipe_id && item.modifier_id === version.modifier_id && item.version_id === version.id).map(ingredient),
          })),
        });
        const plan = await engine.consume(request);
        if (plan.status !== 'applied') {
          // A concurrent delivery may already have applied this request.
          return await this.store.application(request.idempotencyKey, fingerprint) ?? plan;
        }
        const snapshots = plan.changes.map(change => {
          const balance = state.balances.find(balance => balance.product_id === change.productId)!;
          return {productId: balance.product_id, configId: balance.config_id, dimension: balance.dimension,
            onHandMinor: balance.on_hand_minor, estimatedUsedMinor: balance.estimated_used_minor,
            version: balance.version, latestCountEffectiveAt: balance.latest_count_effective_at};
        });
        try {
          return await this.store.commit(plan, fingerprint, snapshots, this.actor, now, {recipeIdsJson, snapshot: row.snapshot});
        } catch (error) {
          if (error instanceof InventoryCommitError && error.code === 'stale_balance' && attempt < 2) continue;
          throw error;
        }
      }
      throw new Error('Inventory retry limit reached.');
    } catch (error) {
      if (error instanceof InventoryCommitError && error.code === 'idempotency_conflict') {
        return rejected({code: 'idempotency_conflict', message: 'Sale key already has different input.'});
      }
      if (error instanceof InventoryCommitError && error.code === 'invalid_plan') {
        return rejected({code: 'invalid_quantity', message: 'Calculated inventory update exceeds supported values.'});
      }
      throw error;
    }
  }
}
