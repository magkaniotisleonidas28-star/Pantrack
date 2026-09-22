import {consumptionInstant} from '@/lib/inventory-consumption-engine';
import {curatedUnit, customUnit, toCanonical, type UnitDefinition} from '@/lib/inventory-quantities';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';

type IngredientInput = {productId: string; unitId: string; unitVersion: number; amount: string};
type Version = {id: string; version: number; status: string; name: string; active_from: string | null;
  active_to: string | null; legacy: number; created_by: string; created_at: string};
type Ingredient = {version_id: string; position: number; product_id: string; unit_id: string | null;
  unit_version: number | null; dimension: string | null; quantity_minor: string | null; entered_amount: string};
type Unit = {product_id: string; unit_id: string; version: number; kind: string; dimension: UnitDimension;
  label: string; numerator: string; denominator: string; retired_at: string | null};
type Config = {product_id: string; id: string; status: string; stock_unit_id: string; stock_unit_version: number};
type State = {versions: Version[]; ingredients: Ingredient[]; units: Unit[]; configs: Config[];
  applications: {idempotency_key: string; occurred_at: string}[]};

// Exact optimistic read token. Unit/configuration edits must invalidate a draft
// write or activation just as recipe edits do. No schema or legacy route cutover.
const tables = {
  versions: ['recipe_versions', 'id version status name active_from active_to legacy created_by created_at', true, 'version,id'],
  ingredients: ['recipe_version_ingredients', 'version_id position product_id unit_id unit_version dimension quantity_minor entered_amount', true, 'version_id,position'],
  units: ['product_unit_versions', 'product_id unit_id version kind dimension label numerator denominator retired_at', false, 'product_id,unit_id,version'],
  configs: ['inventory_config_versions', 'product_id id status stock_unit_id stock_unit_version', false, 'product_id,id'],
  applications: ['inventory_consumption_applications', 'idempotency_key occurred_at', false, 'idempotency_key'],
} as const;
const SNAPSHOT = `WITH context AS (SELECT ? AS company, ? AS recipe)
  SELECT json_object(${Object.entries(tables).map(([key, [table, columns, recipeScoped, order]]) =>
    `'${key}',json((SELECT json_group_array(json_object(${columns.split(' ').map(column => `'${column}',${column}`).join(',')}))
      FROM (SELECT ${columns.split(' ').join(',')} FROM ${table} WHERE company_id=(SELECT company FROM context)
      ${recipeScoped ? 'AND recipe_id=(SELECT recipe FROM context)' : ''}
      ${table === 'inventory_consumption_applications' ? "AND EXISTS(SELECT 1 FROM json_each(result_json,'$.selectedVersions') WHERE json_extract(value,'$.recipeId')=(SELECT recipe FROM context))" : ''}
      ORDER BY ${order})))`).join(',')}) AS snapshot`;

export class RecipeVersionError extends Error {
  constructor(public readonly code: 'unauthenticated' | 'forbidden' | 'invalid_input' | 'immutable' | 'not_found' | 'conflict' | 'invalid_history', message: string) { super(message); }
}
function fail(code: RecipeVersionError['code'], message: string): never { throw new RecipeVersionError(code, message); }
function identity(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('invalid_input', 'An identity is missing or too long.');
}

/** Internal server service. userId must come from a verified session, never a
 * request body. Membership is checked here and again inside the write batch.
 * No HTTP route uses this service yet. */
export class RecipeVersionService {
  constructor(private readonly db: D1Database, private readonly companyId: string, private readonly userId: string | null,
    private readonly clock: () => string = () => new Date().toISOString(), private readonly idFactory: () => string = () => crypto.randomUUID()) {
    identity(companyId);
  }

  private async authorize() {
    if (!this.userId) fail('unauthenticated', 'Sign in before editing recipes.');
    const row = await this.db.prepare('SELECT role FROM memberships WHERE company_id=? AND user_id=?')
      .bind(this.companyId, this.userId).first<{role: string}>();
    if (!row || !['owner', 'manager'].includes(row.role)) fail('forbidden', 'Only this company’s owner or manager can edit recipes.');
  }

  async inspect(recipeId: string): Promise<{token: string; versions: Version[]}> {
    identity(recipeId);
    await this.authorize();
    const row = await this.db.prepare(SNAPSHOT).bind(this.companyId, recipeId).first<{snapshot: string}>();
    if (!row) throw new Error('Recipe snapshot unavailable.');
    return {token: row.snapshot, versions: (JSON.parse(row.snapshot) as State).versions};
  }

  private async state(recipeId: string, expected: string) {
    const current = await this.inspect(recipeId);
    if (current.token !== expected) fail('conflict', 'Recipe or units changed. Reload before saving.');
    return JSON.parse(current.token) as State;
  }

  private now() {
    const value = this.clock();
    if (consumptionInstant(value) === null) fail('invalid_input', 'Invalid server clock.');
    return new Date(value).toISOString();
  }

  private ingredients(state: State, input: IngredientInput[]) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 20 ||
      new Set(input.map(item => item?.productId)).size !== input.length) fail('invalid_input', 'Choose 1–20 distinct ingredients.');
    return input.map(item => {
      if (!item) fail('invalid_input', 'Invalid ingredient.');
      identity(item.productId); identity(item.unitId);
      const definitions = state.units.filter(unit => unit.product_id === item.productId && unit.unit_id === item.unitId);
      const unit = definitions.find(unit => unit.version === item.unitVersion);
      if (!unit || unit.retired_at || unit.version !== Math.max(...definitions.map(unit => unit.version))) {
        fail('invalid_input', 'Choose the current classified unit version.');
      }
      const configs = state.configs.filter(config => config.product_id === item.productId && config.status === 'active');
      const stock = state.units.find(unit => unit.product_id === item.productId && unit.unit_id === configs[0]?.stock_unit_id && unit.version === configs[0]?.stock_unit_version);
      if (configs.length !== 1 || !stock || !['curated', 'custom'].includes(stock.kind) || stock.retired_at ||
        !['count', 'mass', 'volume'].includes(stock.dimension)) fail('invalid_input', 'Configure classified inventory units first.');
      let definition: UnitDefinition;
      if (unit.kind === 'curated') {
        definition = curatedUnit(unit.unit_id);
        if (definition.version !== unit.version || definition.dimension !== unit.dimension ||
          definition.numerator !== unit.numerator || definition.denominator !== unit.denominator) fail('invalid_input', 'Stored curated unit definition does not match its catalog.');
      } else if (unit.kind === 'custom') {
        definition = customUnit({id: unit.unit_id, version: unit.version, companyId: this.companyId, productId: item.productId,
          label: unit.label, dimension: unit.dimension, numerator: unit.numerator, denominator: unit.denominator});
      } else fail('invalid_input', 'Classify this ingredient unit first.');
      const quantity = toCanonical(item.amount, definition, {companyId: this.companyId, productId: item.productId}, {dimension: stock.dimension});
      if (BigInt(quantity.minor) <= BigInt(0)) fail('invalid_input', 'Recipe ingredients must be positive.');
      return {...item, quantity};
    });
  }

  private async write(recipeId: string, expected: string, action: string, versionId: string, at: string, statements: D1PreparedStatement[]) {
    const auditId = this.idFactory();
    // NOT NULL assertion aborts the entire batch if membership or snapshot
    // changed after the read, so there can be no unaudited or partial write.
    const guard = this.db.prepare(`INSERT INTO security_audit(id,company_id,actor,action,target,created)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))
      AND (${SNAPSHOT}) = ? THEN ? ELSE NULL END,?,?,?,?,?`)
      .bind(this.companyId, this.userId, this.companyId, recipeId, expected, auditId,
        this.companyId, this.userId, action, JSON.stringify({recipeId, versionId}), Date.parse(at));
    try { await this.db.batch([guard, ...statements]); }
    catch (error) {
      if (String(error).includes('NOT NULL constraint failed: security_audit.id')) fail('conflict', 'Recipe, units or access changed. Reload before saving.');
      throw error;
    }
  }

  async saveDraft(recipeId: string, draft: {id?: string; name: string; ingredients: IngredientInput[]}, expected: string) {
    const input = structuredClone(draft);
    const state = await this.state(recipeId, expected);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) fail('invalid_input', 'Enter a recipe name.');
    if (input.id !== undefined) identity(input.id);
    const existing = input.id === undefined ? undefined : state.versions.find(version => version.id === input.id);
    if (input.id !== undefined && !existing) fail('not_found', 'Draft not found.');
    if (existing && (existing.status !== 'draft' || existing.legacy || existing.active_from || existing.active_to)) fail('immutable', 'Published recipes cannot be edited. Create a new draft.');
    const ingredients = this.ingredients(state, input.ingredients);
    const at = this.now(), id = existing?.id ?? this.idFactory();
    const version = existing?.version ?? Math.max(0, ...state.versions.map(version => version.version)) + 1;
    if (!Number.isSafeInteger(version) || version < 1) fail('invalid_history', 'Invalid recipe version sequence.');
    const statements = existing ? [
      this.db.prepare('UPDATE recipe_versions SET name=? WHERE company_id=? AND recipe_id=? AND id=?').bind(input.name.trim(), this.companyId, recipeId, id),
      this.db.prepare('DELETE FROM recipe_version_ingredients WHERE company_id=? AND recipe_id=? AND version_id=?').bind(this.companyId, recipeId, id),
    ] : [
      this.db.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?) ON CONFLICT(company_id,id) DO NOTHING').bind(this.companyId, recipeId, this.userId, at),
      this.db.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at)
        VALUES (?,?,?,?,'draft',?,NULL,NULL,0,?,?)`).bind(this.companyId, recipeId, id, version, input.name.trim(), this.userId, at),
    ];
    ingredients.forEach((item, position) => statements.push(this.db.prepare(`INSERT INTO recipe_version_ingredients
      (company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(this.companyId, recipeId, id, position, item.productId, item.unitId, item.unitVersion,
        item.quantity.dimension, item.quantity.minor, item.amount, item.unitId)));
    await this.write(recipeId, expected, existing ? 'recipe.draft_updated' : 'recipe.draft_created', id, at, statements);
    return {id, version};
  }

  async activate(recipeId: string, versionId: string, expected: string) {
    identity(versionId);
    const state = await this.state(recipeId, expected);
    const draft = state.versions.find(version => version.id === versionId);
    if (!draft) fail('not_found', 'Draft not found.');
    if (draft.status !== 'draft' || draft.legacy || draft.active_from || draft.active_to) fail('immutable', 'Only an unpublished draft can be activated.');
    const stored = state.ingredients.filter(item => item.version_id === versionId);
    const calculated = this.ingredients(state, stored.map(item => ({productId: item.product_id, unitId: item.unit_id!, unitVersion: item.unit_version!, amount: item.entered_amount})));
    if (stored.some((item, index) => item.dimension !== calculated[index].quantity.dimension || item.quantity_minor !== calculated[index].quantity.minor)) fail('invalid_input', 'Draft quantities changed. Save the draft again before activation.');
    const at = this.now();
    this.checkHistory(state, at);
    if (consumptionInstant(draft.created_at) === null || Date.parse(draft.created_at) > Date.parse(at)) fail('invalid_history', 'Server clock precedes draft creation.');
    await this.write(recipeId, expected, 'recipe.activated', versionId, at, [
      this.db.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND status='active'").bind(at, this.companyId, recipeId),
      this.db.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id=? AND id=?").bind(at, this.companyId, recipeId, versionId),
    ]);
    return {id: versionId, activeFrom: at};
  }

  async archive(recipeId: string, versionId: string, expected: string) {
    identity(versionId);
    const state = await this.state(recipeId, expected);
    const version = state.versions.find(version => version.id === versionId);
    if (!version) fail('not_found', 'Recipe version not found.');
    if (version.status !== 'active') fail('immutable', 'Only the active version can be archived.');
    const at = this.now();
    this.checkHistory(state, at);
    await this.write(recipeId, expected, 'recipe.archived', versionId, at, [
      this.db.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND id=?").bind(at, this.companyId, recipeId, versionId),
    ]);
  }

  private checkHistory(state: State, at: string) {
    if (state.applications.some(application => consumptionInstant(application.occurred_at) === null || Date.parse(application.occurred_at) >= Date.parse(at))) {
      fail('invalid_history', 'Activation or archival must be later than already applied sales for this recipe.');
    }
    const published = state.versions.filter(version => version.status !== 'draft').sort((a, b) => Date.parse(a.active_from!) - Date.parse(b.active_from!));
    let end: number | null = -Infinity;
    for (const version of published) {
      const from = version.active_from === null ? null : consumptionInstant(version.active_from);
      const to = version.active_to === null ? null : consumptionInstant(version.active_to);
      if (from === null || end === null || from < end || from >= Date.parse(at) ||
        !['active', 'archived'].includes(version.status) ||
        (version.status === 'active' && version.active_to !== null) ||
        (version.status === 'archived' && (to === null || to <= from || to > Date.parse(at)))) fail('invalid_history', 'Recipe history overlaps or the server clock would backdate this change.');
      end = to;
    }
  }
}
