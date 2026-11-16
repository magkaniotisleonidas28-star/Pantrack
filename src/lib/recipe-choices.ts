import type { RecipeChoiceGroup } from './inventory-management-contract';
import type { ConsumptionIssue, ConsumptionLine } from './inventory-consumption-contract';

/** Choice options are ordinary ingredient modifiers; one occurrence per item. */
export function choiceIssues(
  groups: RecipeChoiceGroup[],
  line: ConsumptionLine,
): ConsumptionIssue[] {
  return groups.flatMap((group) => {
    const selected = line.modifiers.filter((modifier) =>
      group.modifierIds.includes(modifier.modifierId),
    );
    if (selected.length !== 1 || selected[0].quantity !== line.quantity)
      return [
        {
          code: 'required_choice_missing' as const,
          lineId: line.lineId,
          recipeId: line.recipeId,
          message: `Choose exactly one ${group.name.toLowerCase()} for each item. Split different choices into separate lines.`,
        },
      ];
    return [];
  });
}

const HUNDRED = BigInt(100);

/** The extra a "more of the picked choice" modifier adds for one picked change:
 * `percent` of it per occurrence, rounded half away from zero to a whole minor unit. */
export function choiceExtraMinor(minor: bigint, percent: number, occurrences: bigint): bigint {
  const scaled = minor * BigInt(percent) * occurrences;
  const negative = scaled < BigInt(0);
  const absolute = negative ? -scaled : scaled;
  const rounded = (absolute + HUNDRED / BigInt(2)) / HUNDRED;
  return negative ? -rounded : rounded;
}
