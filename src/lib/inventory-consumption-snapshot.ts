// One consistent read, scoped to this company's requested recipe lineages and
// their ingredients. Re-evaluated inside the commit batch to fence concurrent
// configuration, recipe, modifier and count changes (including zero deductions).
const tables = {
  recipes: ['recipe_versions', 'company_id recipe_id id version status active_from active_to legacy', 'recipe_id', 'recipe_id,version,id'],
  ingredients: ['recipe_version_ingredients', 'company_id recipe_id version_id position product_id unit_id unit_version dimension quantity_minor', 'recipe_id', 'recipe_id,version_id,position'],
  modifiers: ['recipe_modifier_versions', 'company_id recipe_id modifier_id id version status active_from active_to', 'recipe_id', 'recipe_id,modifier_id,version,id'],
  deltas: ['recipe_modifier_deltas', 'company_id recipe_id modifier_id version_id position product_id unit_id unit_version dimension quantity_minor', 'recipe_id', 'recipe_id,modifier_id,version_id,position'],
  balances: ['inventory_balances_exact', 'product_id config_id dimension on_hand_minor estimated_used_minor version latest_count_effective_at', 'product_id', 'product_id'],
  configs: ['inventory_config_versions', 'product_id id status stock_unit_id stock_unit_version', 'product_id', 'product_id,id'],
  units: ['product_unit_versions', 'product_id unit_id version kind dimension numerator denominator', 'product_id', 'product_id,unit_id,version'],
} as const;

export const CONSUMPTION_SNAPSHOT_SQL = `WITH context AS (SELECT ? AS company_id, ? AS recipe_ids),
  requested AS (SELECT value AS id FROM context, json_each(context.recipe_ids)),
  used_products AS (
    SELECT product_id AS id FROM recipe_version_ingredients
      WHERE company_id = (SELECT company_id FROM context) AND recipe_id IN (SELECT id FROM requested)
    UNION SELECT product_id AS id FROM recipe_modifier_deltas
      WHERE company_id = (SELECT company_id FROM context) AND recipe_id IN (SELECT id FROM requested)
  ) SELECT json_object(${Object.entries(tables).map(([key, [table, columns, scope, order]]) => {
    const object = columns.split(' ').map(column => `'${column}',${column}`).join(',');
    return `'${key}',json((SELECT json_group_array(json_object(${object})) FROM
      (SELECT ${columns.split(' ').join(',')} FROM ${table}
       WHERE company_id = (SELECT company_id FROM context)
       AND ${scope} IN (SELECT id FROM ${scope === 'recipe_id' ? 'requested' : 'used_products'}) ORDER BY ${order})))`;
  }).join(',')}) AS snapshot`;

export type ConsumptionSnapshotGuard = {recipeIdsJson: string; snapshot: string};

export type VersionRow = {
  company_id: string; recipe_id: string; id: string; status: 'draft' | 'active' | 'archived';
  active_from: string | null; active_to: string | null; legacy?: number; modifier_id?: string;
};
export type IngredientRow = {
  company_id: string; recipe_id: string; version_id: string; modifier_id?: string;
  product_id: string; unit_id: string | null; unit_version: number | null;
  dimension: string | null; quantity_minor: string | null;
};
export type ConsumptionSnapshot = {
  recipes: VersionRow[]; modifiers: VersionRow[]; ingredients: IngredientRow[]; deltas: IngredientRow[];
  balances: {product_id: string; config_id: string; dimension: string; on_hand_minor: string;
    estimated_used_minor: string; version: number; latest_count_effective_at: string | null}[];
  configs: {product_id: string; id: string; status: string; stock_unit_id: string; stock_unit_version: number}[];
  units: {product_id: string; unit_id: string; version: number; kind: string; dimension: string | null;
    numerator: string | null; denominator: string | null}[];
};
