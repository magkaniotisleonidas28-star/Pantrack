import {consumptionInstant} from '@/lib/inventory-consumption-engine';
import {curatedUnit, customUnit, toCanonical, type UnitDefinition} from '@/lib/inventory-quantities';
import {RecipeVersionError} from '@/lib/recipe-version-service';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';

type DeltaInput = {productId: string; unitId: string; unitVersion: number; amount: string};
type Version = {id: string; version: number; status: string; active_from: string | null;
  active_to: string | null; created_at: string};
type Delta = {version_id: string; position: number; product_id: string; unit_id: string;
  unit_version: number; dimension: UnitDimension; quantity_minor: string; entered_amount: string};
type Unit = {product_id: string; unit_id: string; version: number; kind: string; dimension: UnitDimension;
  label: string; numerator: string; denominator: string; retired_at: string | null};
type State = {lineage: {id: string; name: string}[]; recipeVersions: {status: string; active_from: string | null;
  active_to: string | null; legacy: number}[]; versions: Version[]; deltas: Delta[];
  units: Unit[]; configs: {product_id: string; status: string; stock_unit_id: string; stock_unit_version: number}[];
  applications: {idempotency_key: string; occurred_at: string}[]};

const specs = {
  lineage: ['recipe_modifier_lineages', 'id name', 'AND recipe_id=(SELECT recipe FROM context) AND id=(SELECT modifier FROM context)', 'id'],
  recipeVersions: ['recipe_versions', 'status active_from active_to legacy', 'AND recipe_id=(SELECT recipe FROM context)', 'active_from'],
  versions: ['recipe_modifier_versions', 'id version status active_from active_to created_at', 'AND recipe_id=(SELECT recipe FROM context) AND modifier_id=(SELECT modifier FROM context)', 'version,id'],
  deltas: ['recipe_modifier_deltas', 'version_id position product_id unit_id unit_version dimension quantity_minor entered_amount', 'AND recipe_id=(SELECT recipe FROM context) AND modifier_id=(SELECT modifier FROM context)', 'version_id,position'],
  units: ['product_unit_versions', 'product_id unit_id version kind dimension label numerator denominator retired_at', '', 'product_id,unit_id,version'],
  configs: ['inventory_config_versions', 'product_id status stock_unit_id stock_unit_version', '', 'product_id,id'],
  applications: ['inventory_consumption_applications', 'idempotency_key occurred_at', `AND EXISTS(
    SELECT 1 FROM json_each(result_json,'$.selectedVersions') AS line,
      json_each(line.value,'$.modifiers') AS extra
    WHERE json_extract(line.value,'$.recipeId')=(SELECT recipe FROM context)
      AND json_extract(extra.value,'$.modifierId')=(SELECT modifier FROM context))`, 'idempotency_key'],
} as const;
const SNAPSHOT = `WITH context AS (SELECT ? AS company, ? AS recipe, ? AS modifier)
  SELECT json_object(${Object.entries(specs).map(([key, [table, columns, filter, order]]) =>
    `'${key}',json((SELECT json_group_array(json_object(${columns.split(' ').map(column => `'${column}',${column}`).join(',')}))
      FROM (SELECT ${columns.split(' ').join(',')} FROM ${table}
        WHERE company_id=(SELECT company FROM context) ${filter} ORDER BY ${order})))`).join(',')}) AS snapshot`;

function fail(code: RecipeVersionError['code'], message: string): never { throw new RecipeVersionError(code, message); }
function identity(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('invalid_input', 'An identity is missing or too long.');
}

/** Server-only modifier draft/activation service. userId must be selected from
 * a verified session; no current HTTP route imports this service. */
export class ModifierVersionService {
  constructor(private readonly db: D1Database, private readonly companyId: string, private readonly userId: string | null,
    private readonly clock: () => string = () => new Date().toISOString(), private readonly idFactory: () => string = () => crypto.randomUUID()) {
    identity(companyId);
  }

  private async authorize() {
    if (!this.userId) fail('unauthenticated', 'Sign in before editing modifiers.');
    const row = await this.db.prepare('SELECT role FROM memberships WHERE company_id=? AND user_id=?')
      .bind(this.companyId, this.userId).first<{role: string}>();
    if (!row || !['owner', 'manager'].includes(row.role)) fail('forbidden', 'Only this company’s owner or manager can edit modifiers.');
  }

  async inspect(recipeId: string, modifierId: string): Promise<{token: string; versions: Version[]}> {
    identity(recipeId); identity(modifierId);
    await this.authorize();
    const row = await this.db.prepare(SNAPSHOT).bind(this.companyId, recipeId, modifierId).first<{snapshot: string}>();
    if (!row) throw new Error('Modifier snapshot unavailable.');
    const state = JSON.parse(row.snapshot) as State;
    return {token: row.snapshot, versions: state.versions};
  }

  private async state(recipeId: string, modifierId: string, expected: string) {
    const current = await this.inspect(recipeId, modifierId);
    if (current.token !== expected) fail('conflict', 'Modifier, recipe or units changed. Reload before saving.');
    return JSON.parse(current.token) as State;
  }

  private now() {
    const value = this.clock();
    if (consumptionInstant(value) === null) fail('invalid_input', 'Invalid server clock.');
    return new Date(value).toISOString();
  }

  private deltas(state: State, input: DeltaInput[]) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 20 ||
      new Set(input.map(item => item?.productId)).size !== input.length) fail('invalid_input', 'Choose 1–20 distinct ingredients.');
    return input.map(item => {
      if (!item) fail('invalid_input', 'Invalid ingredient.');
      identity(item.productId); identity(item.unitId);
      const definitions = state.units.filter(unit => unit.product_id === item.productId && unit.unit_id === item.unitId);
      const unit = definitions.find(unit => unit.version === item.unitVersion);
      if (!unit || unit.retired_at || unit.version !== Math.max(...definitions.map(unit => unit.version))) fail('invalid_input', 'Choose the current classified unit version.');
      const configs = state.configs.filter(config => config.product_id === item.productId && config.status === 'active');
      const stock = state.units.find(unit => unit.product_id === item.productId && unit.unit_id === configs[0]?.stock_unit_id && unit.version === configs[0]?.stock_unit_version);
      if (configs.length !== 1 || !stock || !['curated', 'custom'].includes(stock.kind) || stock.retired_at ||
        !['count', 'mass', 'volume'].includes(stock.dimension)) fail('invalid_input', 'Configure classified inventory units first.');
      let definition: UnitDefinition;
      if (unit.kind === 'curated') {
        definition = curatedUnit(unit.unit_id);
        if (definition.version !== unit.version || definition.dimension !== unit.dimension ||
          definition.numerator !== unit.numerator || definition.denominator !== unit.denominator) fail('invalid_input', 'Stored unit differs from the curated catalog.');
      } else if (unit.kind === 'custom') {
        definition = customUnit({id: unit.unit_id, version: unit.version, companyId: this.companyId, productId: item.productId,
          label: unit.label, dimension: unit.dimension, numerator: unit.numerator, denominator: unit.denominator});
      } else fail('invalid_input', 'Classify the ingredient unit first.');
      const quantity = toCanonical(item.amount, definition, {companyId: this.companyId, productId: item.productId}, {signed: true, dimension: stock.dimension});
      if (BigInt(quantity.minor) === BigInt(0)) fail('invalid_input', 'Modifier changes must be nonzero.');
      return {...item, quantity};
    });
  }

  private async write(recipeId: string, modifierId: string, expected: string, action: string, versionId: string, at: string, statements: D1PreparedStatement[]) {
    const auditId = this.idFactory();
    const guard = this.db.prepare(`INSERT INTO security_audit(id,company_id,actor,action,target,created)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))
        AND (${SNAPSHOT})=? THEN ? ELSE NULL END,?,?,?,?,?`)
      .bind(this.companyId, this.userId, this.companyId, recipeId, modifierId, expected, auditId,
        this.companyId, this.userId, action, JSON.stringify({recipeId, modifierId, versionId}), Date.parse(at));
    try { await this.db.batch([guard, ...statements]); }
    catch (error) {
      if (String(error).includes('NOT NULL constraint failed: security_audit.id')) fail('conflict', 'Modifier, recipe, units or access changed. Reload before saving.');
      throw error;
    }
  }

  async saveDraft(recipeId: string, modifierId: string,
    draft: {id?: string; name: string; deltas: DeltaInput[]}, expected: string) {
    const input = structuredClone(draft);
    const state = await this.state(recipeId, modifierId, expected);
    if (input?.id !== undefined) identity(input.id);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) fail('invalid_input', 'Enter a modifier name.');
    if (state.lineage.length > 1) fail('invalid_history', 'Modifier identity is ambiguous.');
    if (state.versions.some(version => version.status !== 'draft') &&
      state.lineage[0]?.name !== input.name.trim()) fail('immutable', 'Published modifier names cannot be changed.');
    const recipe = await this.db.prepare('SELECT id FROM recipe_lineages WHERE company_id=? AND id=?')
      .bind(this.companyId, recipeId).first();
    if (!recipe) fail('not_found', 'Base recipe does not belong to this company.');
    const existing = input.id === undefined ? undefined : state.versions.find(version => version.id === input.id);
    if (input.id !== undefined && !existing) fail('not_found', 'Draft not found.');
    if (existing && (existing.status !== 'draft' || existing.active_from || existing.active_to)) fail('immutable', 'Published modifiers cannot be edited. Create a new draft.');
    const deltas = this.deltas(state, input.deltas);
    const at = this.now(), id = existing?.id ?? this.idFactory();
    const version = existing?.version ?? Math.max(0, ...state.versions.map(version => version.version)) + 1;
    if (!Number.isSafeInteger(version) || version < 1) fail('invalid_history', 'Invalid modifier version sequence.');
    const statements = existing ? [
      this.db.prepare('UPDATE recipe_modifier_lineages SET name=? WHERE company_id=? AND recipe_id=? AND id=?').bind(input.name.trim(), this.companyId, recipeId, modifierId),
      this.db.prepare('DELETE FROM recipe_modifier_deltas WHERE company_id=? AND recipe_id=? AND modifier_id=? AND version_id=?').bind(this.companyId, recipeId, modifierId, id),
    ] : [
      this.db.prepare(`INSERT INTO recipe_modifier_lineages(company_id,recipe_id,id,name,created_by,created_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(company_id,recipe_id,id) DO UPDATE SET name=excluded.name`).bind(this.companyId, recipeId, modifierId, input.name.trim(), this.userId, at),
      this.db.prepare(`INSERT INTO recipe_modifier_versions(company_id,recipe_id,modifier_id,id,version,status,active_from,active_to,created_by,created_at)
        VALUES (?,?,?,?,?,'draft',NULL,NULL,?,?)`).bind(this.companyId, recipeId, modifierId, id, version, this.userId, at),
    ];
    deltas.forEach((item, position) => statements.push(this.db.prepare(`INSERT INTO recipe_modifier_deltas
      (company_id,recipe_id,modifier_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(this.companyId, recipeId, modifierId, id, position, item.productId,
        item.unitId, item.unitVersion, item.quantity.dimension, item.quantity.minor, item.amount, item.unitId)));
    await this.write(recipeId, modifierId, expected, existing ? 'modifier.draft_updated' : 'modifier.draft_created', id, at, statements);
    return {id, version};
  }

  async activate(recipeId: string, modifierId: string, versionId: string, expected: string) {
    identity(versionId);
    const state = await this.state(recipeId, modifierId, expected);
    const draft = state.versions.find(version => version.id === versionId);
    if (!draft) fail('not_found', 'Modifier draft not found.');
    if (draft.status !== 'draft' || draft.active_from || draft.active_to) fail('immutable', 'Only an unpublished draft can be activated.');
    const stored = state.deltas.filter(item => item.version_id === versionId);
    const calculated = this.deltas(state, stored.map(item => ({productId: item.product_id, unitId: item.unit_id,
      unitVersion: item.unit_version, amount: item.entered_amount})));
    if (stored.some((item, index) => item.dimension !== calculated[index].quantity.dimension || item.quantity_minor !== calculated[index].quantity.minor)) fail('invalid_input', 'Draft quantities changed. Save the draft again.');
    const at = this.now();
    this.checkHistory(state, at);
    const baseActive = state.recipeVersions.filter(version => version.status === 'active' && !version.legacy &&
      version.active_from !== null && Date.parse(version.active_from) <= Date.parse(at) && version.active_to === null);
    if (baseActive.length !== 1) fail('invalid_history', 'Activate a reviewed base recipe first.');
    if (consumptionInstant(draft.created_at) === null || Date.parse(draft.created_at) > Date.parse(at)) fail('invalid_history', 'Server clock precedes draft creation.');
    await this.write(recipeId, modifierId, expected, 'modifier.activated', versionId, at, [
      this.db.prepare("UPDATE recipe_modifier_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND status='active'")
        .bind(at, this.companyId, recipeId, modifierId),
      this.db.prepare("UPDATE recipe_modifier_versions SET status='active',active_from=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=?")
        .bind(at, this.companyId, recipeId, modifierId, versionId),
    ]);
    return {id: versionId, activeFrom: at};
  }

  async archive(recipeId: string, modifierId: string, versionId: string, expected: string) {
    identity(versionId);
    const state = await this.state(recipeId, modifierId, expected);
    const version = state.versions.find(version => version.id === versionId);
    if (!version) fail('not_found', 'Modifier not found.');
    if (version.status !== 'active') fail('immutable', 'Only the active modifier can be archived.');
    const at = this.now();
    this.checkHistory(state, at);
    await this.write(recipeId, modifierId, expected, 'modifier.archived', versionId, at, [
      this.db.prepare("UPDATE recipe_modifier_versions SET status='archived',active_to=? WHERE company_id=? AND recipe_id=? AND modifier_id=? AND id=?")
        .bind(at, this.companyId, recipeId, modifierId, versionId),
    ]);
  }

  private checkHistory(state: State, at: string) {
    if (state.applications.some(application => consumptionInstant(application.occurred_at) === null || Date.parse(application.occurred_at) >= Date.parse(at))) {
      fail('invalid_history', 'Modifier change must follow already applied sales.');
    }
    const published = state.versions.filter(version => version.status !== 'draft').sort((a, b) => Date.parse(a.active_from!) - Date.parse(b.active_from!));
    let end: number | null = -Infinity;
    for (const version of published) {
      const from = version.active_from === null ? null : consumptionInstant(version.active_from);
      const to = version.active_to === null ? null : consumptionInstant(version.active_to);
      if (from === null || end === null || from < end || from >= Date.parse(at) ||
        !['active', 'archived'].includes(version.status) ||
        (version.status === 'active' && version.active_to !== null) ||
        (version.status === 'archived' && (to === null || to <= from || to > Date.parse(at)))) fail('invalid_history', 'Modifier history overlaps or the clock would backdate this change.');
      end = to;
    }
  }
}
