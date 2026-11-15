import type { RecipeAmountInput } from './inventory-management-contract';

/** A choice with no changes has no stock effect, such as "extra hot". */
export type OptionChoice = { id: string; name: string; changes: RecipeAmountInput[] };

/**
 * "one": the customer must pick exactly one (milk), published as a choice group.
 * "addons": optional, several may apply (syrups, ice), published as plain modifiers.
 */
export type OptionSetKind = 'one' | 'addons';

export type OptionSetView = {
  id: string;
  revision: number;
  name: string;
  kind: OptionSetKind;
  choices: OptionChoice[];
  updatedAt: string;
};

export type OptionLinkView = {
  recipeId: string;
  setId: string;
  position: number;
  /** Choice ID to an amount replacing that choice's single change on this item. */
  overrides: Record<string, string>;
  /** The set revision last published onto this item, or null when not yet applied. */
  appliedRevision: number | null;
};

export type OptionSetsView = { sets: OptionSetView[]; links: OptionLinkView[] };

export type OptionApplyResult = {
  recipeId: string;
  status: 'applied' | 'unchanged' | 'failed';
  message?: string;
};

/** Generated modifier and choice-group identities stay stable across set revisions. */
export const optionModifierId = (setId: string, choiceId: string) => `opt-${setId}-${choiceId}`;
export const optionGroupId = (setId: string) => `opt-${setId}`;
export const isOptionGenerated = (id: string) => id.startsWith('opt-');
