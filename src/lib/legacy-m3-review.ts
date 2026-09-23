import type {LegacyM3Review} from '@/lib/inventory-management-contract';

type LegacyStock = {
  product_id: string;
  data: string;
  baseline_updated: string | null;
  baseline_unit: string | null;
  baseline_pack: string | null;
  has_exact_count: number;
};
type LegacyRecipe = {id: string; data: string; baseline_name: string | null; active_reviewed: number};
type LegacyIngredient = {recipe_id: string; product_id: string; entered_amount: string; legacy_unit_label: string | null};

function parsed(value: string): Record<string, unknown> | null {
  try {
    const result: unknown = JSON.parse(value);
    return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Reports possible post-backfill changes; it never converts or writes legacy quantities. */
export async function legacyM3Review(db: D1Database, companyId: string): Promise<LegacyM3Review> {
  const [stock, recipes, ingredients] = await Promise.all([
    db.prepare(`SELECT i.product_id,i.data,c.created_at AS baseline_updated,
      u.label AS baseline_unit,c.legacy_units_per_pack AS baseline_pack,
      EXISTS(SELECT 1 FROM inventory_balances_exact b WHERE b.company_id=i.company_id
        AND b.product_id=i.product_id AND b.latest_count_effective_at IS NOT NULL) AS has_exact_count
      FROM inventory i LEFT JOIN inventory_config_versions c ON c.company_id=i.company_id
        AND c.product_id=i.product_id AND c.id='legacy'
      LEFT JOIN product_unit_versions u ON u.company_id=i.company_id AND u.product_id=i.product_id
        AND u.unit_id='legacy-stock' AND u.version=1
      WHERE i.company_id=? ORDER BY i.product_id`).bind(companyId).all<LegacyStock>(),
    db.prepare(`SELECT r.id,r.data,v.name AS baseline_name,
      EXISTS(SELECT 1 FROM recipe_versions current WHERE current.company_id=r.company_id
        AND current.recipe_id=r.id AND current.status='active' AND current.legacy=0) AS active_reviewed
      FROM recipes r LEFT JOIN recipe_versions v ON v.company_id=r.company_id
        AND v.recipe_id=r.id AND v.id='legacy' WHERE r.company_id=? ORDER BY r.id`).bind(companyId).all<LegacyRecipe>(),
    db.prepare(`SELECT recipe_id,product_id,entered_amount,legacy_unit_label
      FROM recipe_version_ingredients WHERE company_id=? AND version_id='legacy'
      ORDER BY recipe_id,position`).bind(companyId).all<LegacyIngredient>(),
  ]);

  return {
    products: stock.results.map(row => {
      const current = parsed(row.data);
      const settings = current?.settings && typeof current.settings === 'object' && !Array.isArray(current.settings)
        ? current.settings as Record<string, unknown> : null;
      return {
        productId: row.product_id,
        changedSinceBackfill: !current || !row.baseline_updated || current.updated !== row.baseline_updated ||
          settings?.unit !== row.baseline_unit || String(settings?.unitsPerPack) !== row.baseline_pack,
        needsOpeningCount: row.has_exact_count !== 1,
      };
    }),
    recipes: recipes.results.map(row => {
      const current = parsed(row.data);
      const currentIngredients = Array.isArray(current?.ingredients) ? current.ingredients : null;
      const baseline = ingredients.results.filter(item => item.recipe_id === row.id);
      return {
        recipeId: row.id,
        changedSinceBackfill: !current || !row.baseline_name || current.name !== row.baseline_name ||
          !currentIngredients || currentIngredients.length !== baseline.length ||
          baseline.some((item, index) => {
            const ingredient = currentIngredients[index];
            if (!ingredient || typeof ingredient !== 'object' || Array.isArray(ingredient)) return true;
            const value = ingredient as Record<string, unknown>;
            return value.productId !== item.product_id || String(value.quantity) !== item.entered_amount ||
              value.unit !== item.legacy_unit_label;
          }),
        needsReviewedVersion: row.active_reviewed !== 1,
      };
    }),
  };
}
