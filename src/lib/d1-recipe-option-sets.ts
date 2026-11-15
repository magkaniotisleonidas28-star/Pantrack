import { D1InventoryManagementService, InventoryManagementError } from './d1-inventory-management';
import { publishRecipe } from './d1-recipe-publisher';
import { modifierChanges } from './modifier-editor';
import { CURATED_UNIT_IDS, formatCanonical } from './inventory-quantities';
import type { RecipeAmountInput, RecipeChoiceGroup } from './inventory-management-contract';
import {
  isOptionGenerated,
  optionGroupId,
  optionModifierId,
  type OptionApplyResult,
  type OptionChoice,
  type OptionLinkView,
  type OptionSetKind,
  type OptionSetView,
  type OptionSetsView,
} from './recipe-option-sets-contract';

export type SaveOptionSetInput = {
  companyId: string;
  actor: string;
  operationId: string;
  setId: string;
  /** 0 creates the set; otherwise the revision being replaced. */
  expectedRevision: number;
  name: string;
  kind: OptionSetKind;
  choices: OptionChoice[];
};

export type RemoveOptionSetInput = {
  companyId: string;
  actor: string;
  setId: string;
  /** The revision the person saw when choosing to remove the set. */
  expectedRevision: number;
};

export type AttachOptionSetsInput = {
  companyId: string;
  actor: string;
  recipeId: string;
  links: Array<{ setId: string; overrides: Record<string, string> }>;
};

type SetRow = {
  id: string;
  revision: number;
  name: string;
  kind: OptionSetKind;
  choices_json: string;
  updated_at: string;
};

const fail = (message: string, code = 'invalid_option_set'): never => {
  throw new InventoryManagementError(code, message);
};

/**
 * Shared option sets (decision 0009). Sets are setup templates: applying them
 * republishes each attached recipe through the atomic recipe publisher, so
 * sales keep reading only immutable recipe and modifier versions.
 */
export class D1RecipeOptionSets {
  constructor(
    private readonly db: D1Database,
    private readonly options: { clock?: { now(): Date } } = {},
  ) {}

  private now() {
    return (this.options.clock?.now() ?? new Date()).toISOString();
  }

  private view(row: SetRow): OptionSetView {
    return {
      id: row.id,
      revision: row.revision,
      name: row.name,
      kind: row.kind,
      choices: JSON.parse(row.choices_json) as OptionChoice[],
      updatedAt: row.updated_at,
    };
  }

  async list(companyId: string): Promise<OptionSetsView> {
    const [sets, links] = await Promise.all([
      this.db
        .prepare(
          'SELECT id,revision,name,kind,choices_json,updated_at FROM recipe_option_sets WHERE company_id=? AND archived_at IS NULL ORDER BY name,id',
        )
        .bind(companyId)
        .all<SetRow>(),
      this.db
        .prepare(
          'SELECT recipe_id,set_id,position,overrides_json,applied_revision FROM recipe_option_links WHERE company_id=? ORDER BY recipe_id,position',
        )
        .bind(companyId)
        .all<{
          recipe_id: string;
          set_id: string;
          position: number;
          overrides_json: string;
          applied_revision: number | null;
        }>(),
    ]);
    return {
      sets: sets.results.map((row) => this.view(row)),
      links: links.results.map((row): OptionLinkView => ({
        recipeId: row.recipe_id,
        setId: row.set_id,
        position: row.position,
        overrides: JSON.parse(row.overrides_json) as Record<string, string>,
        appliedRevision: row.applied_revision,
      })),
    };
  }

  private async set(companyId: string, setId: string) {
    const row = await this.db
      .prepare(
        'SELECT id,revision,name,kind,choices_json,updated_at FROM recipe_option_sets WHERE company_id=? AND id=? AND archived_at IS NULL',
      )
      .bind(companyId, setId)
      .first<SetRow>();
    return row ? this.view(row) : null;
  }

  async saveSet(
    input: SaveOptionSetInput,
  ): Promise<{ set: OptionSetView; applied: OptionApplyResult[] }> {
    const fingerprint = JSON.stringify([input.setId, input.name.trim(), input.kind, input.choices]);
    const replay = async () => {
      const row = await this.db
        .prepare(
          'SELECT set_id,name,kind,choices_json FROM recipe_option_set_revisions WHERE company_id=? AND operation_id=?',
        )
        .bind(input.companyId, input.operationId)
        .first<{ set_id: string; name: string; kind: string; choices_json: string }>();
      if (!row) return null;
      if (
        JSON.stringify([row.set_id, row.name, row.kind, JSON.parse(row.choices_json)]) !==
        fingerprint
      )
        fail('This save was already used for different details.', 'operation_conflict');
      const set = await this.set(input.companyId, input.setId);
      if (!set) fail('This option set was removed.', 'concurrent_update');
      return { set: set!, applied: [] };
    };
    const saved = await replay();
    if (saved) return saved;

    const name = input.name.trim();
    if (!name || name.length > 100) fail('Give the option set a name of up to 100 characters.');
    if (input.kind !== 'one' && input.kind !== 'addons') fail('Choose how the options are picked.');
    if (!input.choices.length || input.choices.length > 40) fail('Add between 1 and 40 choices.');
    if (input.kind === 'one' && input.choices.length < 2)
      fail('A "pick one" set needs at least two choices.');
    const ids = new Set(input.choices.map((c) => c.id)),
      names = new Set(input.choices.map((c) => c.name.trim().toLowerCase()));
    if (ids.size !== input.choices.length || names.size !== input.choices.length)
      fail('Each choice needs its own name.');
    const stock = new D1InventoryManagementService(this.db);
    for (const choice of input.choices) {
      if (!choice.name.trim() || choice.name.trim().length > 100)
        fail('Give every choice a name of up to 100 characters.');
      if (input.kind === 'one' && !choice.changes.length)
        fail('Each "pick one" choice must add an ingredient.');
      if (choice.changes.length) await stock.recipeAmounts(input.companyId, choice.changes, true);
    }
    if (await this.archived(input.companyId, input.setId))
      fail('This option set was removed.', 'concurrent_update');
    const existing = await this.set(input.companyId, input.setId);
    if ((existing?.revision ?? 0) !== input.expectedRevision)
      fail('This option set changed. Refresh before saving.', 'concurrent_update');
    // Generated modifier names are fixed per identity, as for any recipe modifier.
    for (const choice of input.choices) {
      const before = existing?.choices.find((c) => c.id === choice.id);
      if (before && before.name !== choice.name.trim())
        fail('Choice names are fixed once saved. Add a new choice to rename one.');
    }

    const now = this.now(),
      revision = input.expectedRevision + 1,
      choicesJson = JSON.stringify(
        input.choices.map((c) => ({ id: c.id, name: c.name.trim(), changes: c.changes })),
      );
    const write =
      input.expectedRevision === 0
        ? this.db
            .prepare(
              'INSERT INTO recipe_option_sets(company_id,id,revision,name,kind,choices_json,updated_by,updated_at) VALUES (?,?,1,?,?,?,?,?)',
            )
            .bind(input.companyId, input.setId, name, input.kind, choicesJson, input.actor, now)
        : this.db
            .prepare(
              'UPDATE recipe_option_sets SET revision=?,name=?,kind=?,choices_json=?,updated_by=?,updated_at=? WHERE company_id=? AND id=? AND revision=? AND archived_at IS NULL',
            )
            .bind(
              revision,
              name,
              input.kind,
              choicesJson,
              input.actor,
              now,
              input.companyId,
              input.setId,
              input.expectedRevision,
            );
    try {
      await this.db.batch([
        write,
        // Recorded only if this save produced the expected revision.
        this.db
          .prepare(
            `INSERT INTO recipe_option_set_revisions(company_id,set_id,revision,operation_id,name,kind,choices_json,created_by,created_at)
            SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM recipe_option_sets WHERE company_id=? AND id=? AND revision=? AND updated_at=? AND updated_by=?)`,
          )
          .bind(
            input.companyId,
            input.setId,
            revision,
            input.operationId,
            name,
            input.kind,
            choicesJson,
            input.actor,
            now,
            input.companyId,
            input.setId,
            revision,
            now,
            input.actor,
          ),
      ]);
    } catch (error) {
      const again = await replay();
      if (again) return again;
      if (String(error).includes('UNIQUE') || String(error).includes('PRIMARY'))
        fail('This option set changed. Refresh before saving.', 'concurrent_update');
      throw error;
    }
    const recorded = await replay();
    if (!recorded) fail('This option set changed. Refresh before saving.', 'concurrent_update');
    const recipes = await this.db
      .prepare(
        'SELECT DISTINCT recipe_id FROM recipe_option_links WHERE company_id=? AND set_id=? ORDER BY recipe_id',
      )
      .bind(input.companyId, input.setId)
      .all<{ recipe_id: string }>();
    const applied = [];
    for (const { recipe_id } of recipes.results)
      applied.push(await this.apply(input.companyId, recipe_id, input.actor));
    return { set: (await this.set(input.companyId, input.setId))!, applied };
  }

  async attach(input: AttachOptionSetsInput): Promise<OptionApplyResult> {
    if (input.links.length > 10) fail('Attach at most 10 option sets to one item.');
    if (new Set(input.links.map((l) => l.setId)).size !== input.links.length)
      fail('Attach each option set once.');
    const recipe = await this.db
      .prepare('SELECT 1 FROM recipe_lineages WHERE company_id=? AND id=?')
      .bind(input.companyId, input.recipeId)
      .first();
    if (!recipe) fail('Save the item’s recipe before adding option sets.');
    for (const link of input.links) {
      const set = await this.set(input.companyId, link.setId);
      if (!set) fail('Choose an existing option set.');
      for (const [choiceId, amount] of Object.entries(link.overrides)) {
        const choice = set!.choices.find((c) => c.id === choiceId);
        if (!choice || choice.changes.length !== 1)
          fail('Only a choice with one ingredient can have its amount changed for an item.');
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || /^0(?:\.0+)?$/.test(amount))
          fail('Enter a positive amount for each changed choice.');
      }
    }
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare('DELETE FROM recipe_option_links WHERE company_id=? AND recipe_id=?')
        .bind(input.companyId, input.recipeId),
      // A set removed since it was checked is not attached.
      ...input.links.map((link, position) =>
        this.db
          .prepare(
            `INSERT INTO recipe_option_links(company_id,recipe_id,set_id,position,overrides_json,applied_revision,linked_by,linked_at)
            SELECT ?,?,?,?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM recipe_option_sets WHERE company_id=? AND id=? AND archived_at IS NULL)`,
          )
          .bind(
            input.companyId,
            input.recipeId,
            link.setId,
            position,
            JSON.stringify(link.overrides),
            input.actor,
            now,
            input.companyId,
            link.setId,
          ),
      ),
    ]);
    return this.apply(input.companyId, input.recipeId, input.actor, true);
  }

  private async archived(companyId: string, setId: string) {
    return !!(await this.db
      .prepare(
        'SELECT 1 FROM recipe_option_sets WHERE company_id=? AND id=? AND archived_at IS NOT NULL',
      )
      .bind(companyId, setId)
      .first());
  }

  /**
   * Removes a set: hides it, keeps its revision history, detaches it from every
   * item and republishes those items without its choices. Repeating a removal
   * only republishes items that still carry the set's choices.
   */
  async removeSet(input: RemoveOptionSetInput): Promise<{ applied: OptionApplyResult[] }> {
    const row = await this.db
      .prepare('SELECT revision,archived_at FROM recipe_option_sets WHERE company_id=? AND id=?')
      .bind(input.companyId, input.setId)
      .first<{ revision: number; archived_at: string | null }>();
    if (!row) fail('Choose an existing option set.');
    if (!row!.archived_at) {
      if (row!.revision !== input.expectedRevision)
        fail('This option set changed. Refresh before removing it.', 'concurrent_update');
      const now = this.now();
      const [archive] = await this.db.batch([
        this.db
          .prepare(
            'UPDATE recipe_option_sets SET archived_by=?,archived_at=? WHERE company_id=? AND id=? AND revision=? AND archived_at IS NULL',
          )
          .bind(input.actor, now, input.companyId, input.setId, input.expectedRevision),
        this.db
          .prepare(
            'DELETE FROM recipe_option_links WHERE company_id=? AND set_id=? AND EXISTS(SELECT 1 FROM recipe_option_sets WHERE company_id=? AND id=? AND archived_at=? AND archived_by=?)',
          )
          .bind(input.companyId, input.setId, input.companyId, input.setId, now, input.actor),
      ]);
      if (archive.meta.changes !== 1)
        fail('This option set changed. Refresh before removing it.', 'concurrent_update');
    }
    // Option IDs contain only letters, digits and hyphens, so LIKE matches the prefix exactly.
    const carrying = await this.db
      .prepare(
        `SELECT DISTINCT m.recipe_id FROM recipe_modifier_versions m WHERE m.company_id=? AND m.status='active' AND m.modifier_id LIKE ?
        AND EXISTS(SELECT 1 FROM recipe_versions r WHERE r.company_id=m.company_id AND r.recipe_id=m.recipe_id AND r.status='active') ORDER BY m.recipe_id`,
      )
      .bind(input.companyId, optionModifierId(input.setId, '%'))
      .all<{ recipe_id: string }>();
    const applied = [];
    for (const { recipe_id } of carrying.results)
      applied.push(await this.apply(input.companyId, recipe_id, input.actor, true));
    return { applied };
  }

  /** Republishes one recipe with its own modifiers plus every attached set's choices. */
  async apply(
    companyId: string,
    recipeId: string,
    actor: string,
    force = false,
  ): Promise<OptionApplyResult> {
    try {
      const { sets, links } = await this.list(companyId);
      const attached = links.filter((l) => l.recipeId === recipeId);
      if (
        !force &&
        attached.every((l) => l.appliedRevision === sets.find((s) => s.id === l.setId)?.revision)
      )
        return { recipeId, status: 'unchanged' };
      const view = await new D1InventoryManagementService(this.db).read(companyId);
      const active = view.recipes.find((r) => r.recipeId === recipeId && r.status === 'active');
      if (!active) fail('Publish this item’s recipe before adding option sets.');
      const own = view.modifiers.filter(
        (m) => m.recipeId === recipeId && m.status === 'active' && !isOptionGenerated(m.modifierId),
      );
      const expected = view.modifiers.filter(
        (m) => m.recipeId === recipeId && m.status === 'active',
      );
      const modifiers: Array<{
        modifierId: string;
        versionId: string;
        name: string;
        deltas: Array<RecipeAmountInput & { signed: boolean }>;
      }> = own.map((m) => ({
        modifierId: m.modifierId,
        versionId: crypto.randomUUID(),
        name: m.name,
        deltas: modifierChanges(m).map(({ direction, ...c }) => ({
          ...c,
          signed: direction === 'remove',
        })),
      }));
      const choices: RecipeChoiceGroup[] = (active!.choices ?? []).filter(
        (g) => !isOptionGenerated(g.id),
      );
      for (const link of attached) {
        const set = sets.find((s) => s.id === link.setId);
        if (!set) continue;
        const ids = [];
        for (const choice of set.choices) {
          const modifierId = optionModifierId(set.id, choice.id);
          ids.push(modifierId);
          modifiers.push({
            modifierId,
            versionId: crypto.randomUUID(),
            name: choice.name,
            deltas: choice.changes.map((c) => ({
              ...c,
              amount: link.overrides[choice.id] ?? c.amount,
              signed: false,
            })),
          });
        }
        if (set.kind === 'one')
          choices.push({ id: optionGroupId(set.id), name: set.name, modifierIds: ids });
      }
      await publishRecipe(
        this.db,
        {
          companyId,
          actor,
          operationId: crypto.randomUUID(),
          recipeId,
          versionId: crypto.randomUUID(),
          name: active!.name,
          expectedActiveVersionId: active!.versionId,
          expectedModifiers: Object.fromEntries(expected.map((m) => [m.modifierId, m.versionId])),
          ingredients: active!.ingredients.map((i) =>
            CURATED_UNIT_IDS.some((id) => id === i.unitId)
              ? { productId: i.productId, amount: i.amount, unitId: i.unitId }
              : {
                  productId: i.productId,
                  amount: formatCanonical(i.quantity),
                  unitId: { mass: 'g', volume: 'mL', count: 'each' }[i.quantity.dimension],
                },
          ),
          choices,
          modifiers,
        },
        this.now(),
      );
      if (attached.length)
        await this.db.batch(
          attached.map((link) =>
            this.db
              .prepare(
                'UPDATE recipe_option_links SET applied_revision=? WHERE company_id=? AND recipe_id=? AND set_id=?',
              )
              .bind(
                sets.find((s) => s.id === link.setId)?.revision ?? null,
                companyId,
                recipeId,
                link.setId,
              ),
          ),
        );
      return { recipeId, status: 'applied' };
    } catch (error) {
      if (error instanceof InventoryManagementError)
        return { recipeId, status: 'failed', message: error.message };
      throw error;
    }
  }
}
