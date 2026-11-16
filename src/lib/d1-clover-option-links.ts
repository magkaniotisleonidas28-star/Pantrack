import { UserFacingError } from './user-facing-error';
import { optionModifierId, type OptionChoice } from './recipe-option-sets-contract';

/** The Clover merchant a link belongs to, as recorded on the connection. */
export type CloverScope = { companyId: string; environment: string; merchantId: string };

export type CloverOptionLinkView = {
  modifierId: string;
  modifierName: string;
  setId: string;
  choiceId: string;
};

/**
 * Clover options linked once to option-set choices (decision 0009 step 4).
 * Links are not copied into per-item mappings: a sale resolves them against the
 * mapped item's recipe, so items attached to a set later are covered too.
 */
export class D1CloverOptionLinks {
  constructor(
    private readonly db: D1Database,
    private readonly options: { clock?: { now(): Date } } = {},
  ) {}

  async list(scope: CloverScope): Promise<CloverOptionLinkView[]> {
    const rows = await this.db
      .prepare(
        `SELECT modifier_id,modifier_name,set_id,choice_id FROM clover_option_links
        WHERE company_id=? AND environment=? AND merchant_id=? ORDER BY set_id,choice_id,modifier_name`,
      )
      .bind(scope.companyId, scope.environment, scope.merchantId)
      .all<{ modifier_id: string; modifier_name: string; set_id: string; choice_id: string }>();
    return rows.results.map((r) => ({
      modifierId: r.modifier_id,
      modifierName: r.modifier_name,
      setId: r.set_id,
      choiceId: r.choice_id,
    }));
  }

  /** Links a Clover modifier to one choice of a set, replacing its earlier choice in that set. */
  async link(
    input: CloverScope & {
      actor: string;
      setId: string;
      choiceId: string;
      modifierId: string;
      modifierName: string;
    },
  ) {
    const name = input.modifierName.trim();
    if (!name || name.length > 200) throw new UserFacingError('Choose a Clover option.');
    const set = await this.db
      .prepare(
        'SELECT choices_json FROM recipe_option_sets WHERE company_id=? AND id=? AND archived_at IS NULL',
      )
      .bind(input.companyId, input.setId)
      .first<{ choices_json: string }>();
    if (!set) throw new UserFacingError('Choose an existing option set.');
    if (!(JSON.parse(set.choices_json) as OptionChoice[]).some((c) => c.id === input.choiceId))
      throw new UserFacingError('Choose a choice from this option set.');
    // A set removed since the check is not linked.
    const result = await this.db
      .prepare(
        `INSERT INTO clover_option_links(company_id,environment,merchant_id,modifier_id,set_id,choice_id,modifier_name,linked_by,linked_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM recipe_option_sets WHERE company_id=? AND id=? AND archived_at IS NULL)
        ON CONFLICT(company_id,environment,merchant_id,modifier_id,set_id) DO UPDATE SET
        choice_id=excluded.choice_id,modifier_name=excluded.modifier_name,linked_by=excluded.linked_by,linked_at=excluded.linked_at`,
      )
      .bind(
        input.companyId,
        input.environment,
        input.merchantId,
        input.modifierId,
        input.setId,
        input.choiceId,
        name,
        input.actor,
        (this.options.clock?.now() ?? new Date()).toISOString(),
        input.companyId,
        input.setId,
      )
      .run();
    if (result.meta.changes !== 1) throw new UserFacingError('This option set was removed.');
  }

  async unlink(input: CloverScope & { setId: string; modifierId: string }) {
    await this.db
      .prepare(
        'DELETE FROM clover_option_links WHERE company_id=? AND environment=? AND merchant_id=? AND modifier_id=? AND set_id=?',
      )
      .bind(input.companyId, input.environment, input.merchantId, input.modifierId, input.setId)
      .run();
  }

  /**
   * The recipe modifier a linked Clover option means on this recipe, or null.
   * Only choices the recipe has carried count; if several sets match, the one
   * the recipe carries now wins, and anything still ambiguous is held.
   */
  async resolve(scope: CloverScope, recipeId: string, modifierId: string) {
    const links = await this.db
      .prepare(
        `SELECT l.set_id,l.choice_id FROM clover_option_links l JOIN recipe_option_sets s
        ON s.company_id=l.company_id AND s.id=l.set_id AND s.archived_at IS NULL
        WHERE l.company_id=? AND l.environment=? AND l.merchant_id=? AND l.modifier_id=?`,
      )
      .bind(scope.companyId, scope.environment, scope.merchantId, modifierId)
      .all<{ set_id: string; choice_id: string }>();
    const candidates: Array<{ id: string; active: boolean }> = [];
    for (const link of links.results) {
      const id = optionModifierId(link.set_id, link.choice_id);
      const row = await this.db
        .prepare(
          `SELECT EXISTS(SELECT 1 FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND status='active') AS active
          FROM recipe_modifier_lineages WHERE company_id=? AND recipe_id=? AND id=?`,
        )
        .bind(scope.companyId, recipeId, id, scope.companyId, recipeId, id)
        .first<{ active: number }>();
      if (row) candidates.push({ id, active: row.active === 1 });
    }
    if (candidates.length === 1) return candidates[0].id;
    const active = candidates.filter((c) => c.active);
    return active.length === 1 ? active[0].id : null;
  }
}
