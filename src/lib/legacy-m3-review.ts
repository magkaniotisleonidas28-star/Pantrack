type LegacyStock = {product_id:string; data:string; baseline_updated:string|null;
  baseline_unit:string|null; baseline_pack:string|null; has_exact_count:number};
type LegacyRecipe = {id:string; data:string; baseline_name:string|null; active_reviewed:number};
type LegacyIngredient = {recipe_id:string; product_id:string; entered_amount:string; legacy_unit_label:string|null};

/** Read-only A4 report. It flags differences; it never converts old quantities. */
export async function legacyM3Review(db:D1Database,companyId:string){
  const [stock,recipes,ingredients]=await Promise.all([
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
  const products=stock.results.map(row=>{
    const current=JSON.parse(row.data) as {updated?:string;settings?:{unit?:string;unitsPerPack?:number}};
    const changedSinceBackfill=!row.baseline_updated||current.updated!==row.baseline_updated||
      current.settings?.unit!==row.baseline_unit||String(current.settings?.unitsPerPack) !== row.baseline_pack;
    return {productId:row.product_id,changedSinceBackfill,needsOpeningCount:row.has_exact_count!==1};
  });
  const menu=recipes.results.map(row=>{
    const current=JSON.parse(row.data) as {name?:string;ingredients?:{productId:string;quantity:number;unit:string}[]};
    const baseline=ingredients.results.filter(item=>item.recipe_id===row.id);
    const changedSinceBackfill=!row.baseline_name||current.name!==row.baseline_name||
      !Array.isArray(current.ingredients)||current.ingredients.length!==baseline.length||
      baseline.some((item,index)=>current.ingredients?.[index]?.productId!==item.product_id||
        String(current.ingredients?.[index]?.quantity)!==item.entered_amount||
        current.ingredients?.[index]?.unit!==item.legacy_unit_label);
    return {recipeId:row.id,changedSinceBackfill,needsReviewedVersion:row.active_reviewed!==1};
  });
  return {products,recipes:menu};
}
