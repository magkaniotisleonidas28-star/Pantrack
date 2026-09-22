import {env} from 'cloudflare:workers';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {InventoryConfigurationService, ConfigurationError} from '@/lib/inventory-configuration-service';
import {PhysicalCountService, PhysicalCountError} from '@/lib/physical-count-service';
import {ExactStockMovementService, StockMovementError} from '@/lib/exact-stock-movement-service';
import {RecipeVersionService, RecipeVersionError} from '@/lib/recipe-version-service';
import {ModifierVersionService} from '@/lib/modifier-version-service';
import {QuantityError} from '@/lib/inventory-quantities';
import {legacyM3Review} from '@/lib/legacy-m3-review';
import {z} from 'zod';

const enabled = () => (env as unknown as {M3_EXACT_PREVIEW_ENABLED?: string}).M3_EXACT_PREVIEW_ENABLED === 'true';
const id = z.string().trim().min(1).max(200);
const expected = z.string().min(1).max(1_000_000);
const amount = z.string().min(1).max(128);
const ingredient = z.object({productId: id, unitId: id, unitVersion: z.number().int().positive(), amount}).strict();
const unit = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('curated'), unitId: id}).strict(),
  z.object({kind: z.literal('custom'), unitId: id, label: id, dimension: z.enum(['count','mass','volume']),
    numerator: amount, denominator: amount}).strict(),
]);
const request = z.discriminatedUnion('action', [
  z.object({companyId: id, action: z.literal('configure'), productId: id, expected,
    unit, purchaseUnitLabel: id, packAmount: amount.optional()}).strict(),
  z.object({companyId: id, action: z.literal('count'), productId: id, expected,
    unitId: id, unitVersion: z.number().int().positive(), amount, effectiveAt: z.string().min(1).max(60),
    note: z.string().max(300).optional()}).strict(),
  z.object({companyId:id,action:z.literal('movement'),productId:id,expected,movementId:id,
    movement:z.enum(['receive','use','waste','incoming']),unitId:id,unitVersion:z.number().int().positive(),
    amount,note:z.string().max(300).optional(),fromIncoming:z.boolean().optional()}).strict(),
  z.object({companyId: id, action: z.literal('recipeDraft'), recipeId: id, expected,
    versionId: id.optional(), name: id, ingredients: z.array(ingredient).min(1).max(20)}).strict(),
  z.object({companyId: id, action: z.literal('recipeActivate'), recipeId: id, versionId: id, expected}).strict(),
  z.object({companyId: id, action: z.literal('recipeArchive'), recipeId: id, versionId: id, expected}).strict(),
  z.object({companyId: id, action: z.literal('modifierDraft'), recipeId: id, modifierId: id, expected,
    versionId: id.optional(), name: id, deltas: z.array(ingredient).min(1).max(20)}).strict(),
  z.object({companyId: id, action: z.literal('modifierActivate'), recipeId: id, modifierId: id, versionId: id, expected}).strict(),
  z.object({companyId: id, action: z.literal('modifierArchive'), recipeId: id, modifierId: id, versionId: id, expected}).strict(),
]);

function responseError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof QuantityError) return Response.json({error:'Check the entered values and units.'},{status:400});
  if (error instanceof ConfigurationError || error instanceof PhysicalCountError || error instanceof RecipeVersionError || error instanceof StockMovementError) {
    const status = error.code === 'unauthenticated' ? 401 : error.code === 'forbidden' ? 403 :
      error.code === 'not_found' ? 404 : error.code === 'conflict' || error.code === 'immutable' ||
      error.code === 'invalid_history' || error.code === 'incompatible_history' || error.code === 'duplicate_key' ? 409 : 400;
    return Response.json({error:error.message, code:error.code},{status});
  }
  return Response.json({error:'Could not save exact inventory. Please retry.'},{status:503});
}

async function access(companyId: string | null) {
  const user = await getChatGPTUser();
  if (!user) return null;
  const member = await companyAccess(user.userId, companyId);
  return member && ['owner','manager'].includes(member.role) ? {user, companyId: companyId!} : null;
}

async function handleGET(req: Request) {
  if (!enabled()) return Response.json({error:'Exact inventory preview is unavailable.'},{status:404});
  const params = new URL(req.url).searchParams;
  const auth = await access(params.get('companyId'));
  if (!auth) return Response.json({error:'Manager access required.'},{status:403});
  const {companyId, user} = auth, db = database();
  const productId = params.get('productId'), recipeId = params.get('recipeId'), modifierId = params.get('modifierId');
  const kind = params.get('kind') ?? 'list';
  try {
    if (kind === 'config' && productId) return Response.json(await new InventoryConfigurationService(db, companyId, user.userId).inspect(productId));
    if (kind === 'count' && productId) return Response.json(await new PhysicalCountService(db, companyId, user.userId).inspect(productId));
    if (kind === 'movement' && productId) return Response.json(await new ExactStockMovementService(db, companyId, user.userId).inspect(productId));
    if (kind === 'recipe' && recipeId) return Response.json(await new RecipeVersionService(db, companyId, user.userId).inspect(recipeId));
    if (kind === 'modifier' && recipeId && modifierId) return Response.json(await new ModifierVersionService(db, companyId, user.userId).inspect(recipeId, modifierId));
    if (kind !== 'list') return Response.json({error:'Choose a valid item.'},{status:400});
    const [products, recipes, modifiers, counts, ingredients, deltas] = await Promise.all([
      db.prepare(`SELECT p.id, COALESCE(json_extract(p.data,'$.name'),p.id) AS name,
        c.stock_unit_id AS unitId, c.stock_unit_version AS unitVersion, c.status AS status,
        b.dimension, b.on_hand_minor AS onHandMinor, b.incoming_minor AS incomingMinor,
        b.latest_count_effective_at AS cutoff
        FROM products p LEFT JOIN inventory_config_versions c ON c.company_id=p.owner AND c.product_id=p.id AND c.status='active'
        LEFT JOIN inventory_balances_exact b ON b.company_id=p.owner AND b.product_id=p.id
        WHERE p.owner=? ORDER BY name,p.id`).bind(companyId).all(),
      db.prepare(`SELECT l.id, v.id AS versionId, v.version, v.status, v.name, v.legacy
        FROM recipe_lineages l LEFT JOIN recipe_versions v ON v.company_id=l.company_id AND v.recipe_id=l.id
        WHERE l.company_id=? ORDER BY l.id,v.version`).bind(companyId).all(),
      db.prepare(`SELECT m.recipe_id AS recipeId, m.id, m.name, v.id AS versionId, v.version, v.status
        FROM recipe_modifier_lineages m LEFT JOIN recipe_modifier_versions v
        ON v.company_id=m.company_id AND v.recipe_id=m.recipe_id AND v.modifier_id=m.id
        WHERE m.company_id=? ORDER BY m.recipe_id,m.id,v.version`).bind(companyId).all(),
      db.prepare(`SELECT product_id AS productId, effective_at AS effectiveAt, measured_minor AS measuredMinor,
        variance_minor AS varianceMinor, opening FROM inventory_reconciliations
        WHERE company_id=? ORDER BY effective_at DESC LIMIT 100`).bind(companyId).all(),
      db.prepare(`SELECT recipe_id AS recipeId, version_id AS versionId, product_id AS productId,
        entered_amount AS amount, unit_id AS unitId, quantity_minor AS quantityMinor
        FROM recipe_version_ingredients WHERE company_id=? ORDER BY recipe_id,version_id,position`).bind(companyId).all(),
      db.prepare(`SELECT recipe_id AS recipeId, modifier_id AS modifierId, version_id AS versionId,
        product_id AS productId, entered_amount AS amount, unit_id AS unitId, quantity_minor AS quantityMinor
        FROM recipe_modifier_deltas WHERE company_id=? ORDER BY recipe_id,modifier_id,version_id,position`).bind(companyId).all(),
    ]);
    const legacy=await legacyM3Review(db,companyId);
    return Response.json({products:products.results, recipes:recipes.results, modifiers:modifiers.results,
      counts:counts.results, ingredients:ingredients.results, deltas:deltas.results, legacy},{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) { return responseError(error); }
}

async function handlePOST(req: Request) {
  if (!enabled()) return Response.json({error:'Exact inventory preview is unavailable.'},{status:404});
  try {
    const body = request.parse(await req.json());
    const auth = await access(body.companyId);
    if (!auth) return Response.json({error:'Manager access required.'},{status:403});
    const db = database(), {user, companyId} = auth;
    const config = () => new InventoryConfigurationService(db, companyId, user.userId);
    const count = () => new PhysicalCountService(db, companyId, user.userId);
    const movement = () => new ExactStockMovementService(db, companyId, user.userId);
    const recipe = () => new RecipeVersionService(db, companyId, user.userId);
    const modifier = () => new ModifierVersionService(db, companyId, user.userId);
    switch (body.action) {
      case 'configure': {
        // The preview cannot reinterpret an older JSON balance. A later,
        // reviewed reconciliation step must handle migrated products.
        const legacy = await db.prepare('SELECT product_id FROM inventory WHERE company_id=? AND product_id=?')
          .bind(companyId, body.productId).first();
        if (legacy) return Response.json({error:'This product has older stock records. Review them before switching to exact stock.'},{status:409});
        return Response.json(await config().activate(body.productId,
          {unit:body.unit, purchaseUnitLabel:body.purchaseUnitLabel, packAmount:body.packAmount}, body.expected));
      }
      case 'count': return Response.json(await count().record(body.productId,
        {unitId:body.unitId, unitVersion:body.unitVersion, amount:body.amount,
          effectiveAt:body.effectiveAt, note:body.note}, body.expected));
      case 'movement': return Response.json(await movement().record(body.productId,
        {id:body.movementId,action:body.movement,unitId:body.unitId,unitVersion:body.unitVersion,
          amount:body.amount,note:body.note,fromIncoming:body.fromIncoming},body.expected));
      case 'recipeDraft': return Response.json(await recipe().saveDraft(body.recipeId,
        {id:body.versionId, name:body.name, ingredients:body.ingredients}, body.expected));
      case 'recipeActivate': return Response.json(await recipe().activate(body.recipeId, body.versionId, body.expected));
      case 'recipeArchive': await recipe().archive(body.recipeId, body.versionId, body.expected); return Response.json({ok:true});
      case 'modifierDraft': return Response.json(await modifier().saveDraft(body.recipeId, body.modifierId,
        {id:body.versionId, name:body.name, deltas:body.deltas}, body.expected));
      case 'modifierActivate': return Response.json(await modifier().activate(body.recipeId, body.modifierId, body.versionId, body.expected));
      case 'modifierArchive': await modifier().archive(body.recipeId, body.modifierId, body.versionId, body.expected); return Response.json({ok:true});
    }
  } catch (error) { return responseError(error); }
}
export const GET = withCompanyRoute('inventory',handleGET);
export const POST = withCompanyRoute('inventory',handlePOST);
