import type { ModifierVersionView, RecipeAmountInput } from './inventory-management-contract';
import { CURATED_UNIT_IDS, formatCanonical } from './inventory-quantities';

export type ModifierChange = RecipeAmountInput & { direction: 'add' | 'remove' };

export type ModifierDraftIdentity = { modifierId: string; draftId: string };

/** Keep amounts as entered in standard units, such as 10 fl oz. Otherwise use the
 * stored canonical quantity, not an old custom unit whose conversion may have
 * changed. A copy has its own rows and never carries source IDs. */
export function modifierChanges(version: ModifierVersionView): ModifierChange[] {
  return version.deltas.map((delta) => {
    const entered = CURATED_UNIT_IDS.some((id) => id === delta.unitId);
    return {
      productId: delta.productId,
      amount: entered
        ? delta.amount.replace(/^-/, '')
        : formatCanonical(delta.quantity).replace(/^-/, ''),
      unitId: entered
        ? delta.unitId
        : { mass: 'g', volume: 'mL', count: 'each' }[delta.quantity.dimension],
      direction: delta.quantity.minor.startsWith('-') ? 'remove' : 'add',
    };
  });
}

export function modifierDraftRequest(
  companyId: string,
  recipeId: string,
  identity: ModifierDraftIdentity,
  name: string,
  changes: ModifierChange[],
) {
  if (!name.trim() || name.trim().length > 100)
    throw new Error('Enter a modifier name of up to 100 characters.');
  if (!changes.length || changes.length > 50)
    throw new Error('Add between 1 and 50 ingredient changes.');
  if (new Set(changes.map((change) => change.productId)).size !== changes.length)
    throw new Error(
      'Use one change per ingredient. Combine additions and removals into its final amount.',
    );
  for (const change of changes) {
    if (!change.productId || !change.unitId)
      throw new Error('Choose a configured ingredient and unit for every change.');
    if (
      change.amount.length > 128 ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(change.amount) ||
      /^0(?:\.0+)?$/.test(change.amount)
    )
      throw new Error(
        'Enter a positive quantity with up to six decimal places. Choose Remove to subtract it.',
      );
  }
  return {
    action: 'saveModifierDraftExact' as const,
    companyId,
    recipeId,
    modifierId: identity.modifierId,
    draftId: identity.draftId,
    name: name.trim(),
    deltas: changes.map(({ direction, ...change }) => ({
      ...change,
      signed: direction === 'remove',
    })),
  };
}
