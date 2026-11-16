import type { ExactQuantity, UnitDimension } from './inventory-consumption-contract';
import {
  curatedUnit,
  readCanonical,
  type CuratedUnitId,
  type UnitDefinition,
} from './inventory-quantities';
import { formatInUnit } from './stock-pack-quantities';

/** The café-wide choice of everyday units. Stored amounts never change with it. */
export type MeasurementSystem = 'us' | 'metric';
export const DEFAULT_MEASUREMENT_SYSTEM: MeasurementSystem = 'us';

const preferred: Record<MeasurementSystem, Record<UnitDimension, CuratedUnitId[]>> = {
  us: {
    volume: ['fl_oz_us', 'tsp_us', 'tbsp_us', 'cup_us', 'quart_us', 'gallon_us'],
    mass: ['oz_mass', 'lb'],
    count: ['each'],
  },
  metric: { volume: ['mL', 'L'], mass: ['g', 'kg'], count: ['each'] },
};

/** Everyday units for a dimension, most useful first. */
export function preferredUnits(system: MeasurementSystem, dimension: UnitDimension) {
  return preferred[system][dimension];
}

/** The unit a recipe or count uses by default for a dimension. */
export function everydayUnit(system: MeasurementSystem, dimension: UnitDimension): CuratedUnitId {
  return preferred[system][dimension][0];
}

const shortLabels: Record<string, string> = {
  oz_mass: 'oz',
  fl_oz_us: 'fl oz',
  tsp_us: 'tsp',
  tbsp_us: 'tbsp',
  cup_us: 'cup',
  pint_us: 'pint',
  quart_us: 'quart',
  gallon_us: 'gallon',
};

/** Short names for everyday use; mass oz and fluid oz stay distinct ("oz" and "fl oz"). */
export function shortUnitLabel(unit: string | UnitDefinition): string {
  if (typeof unit !== 'string')
    return unit.kind === 'custom' ? unit.label : shortUnitLabel(unit.id);
  return shortLabels[unit] ?? unit;
}

/** A stock amount in the café's everyday unit, switching to the larger unit for big amounts. */
export function formatEveryday(q: ExactQuantity, system: MeasurementSystem): string {
  const units = preferred[system][q.dimension];
  const big: CuratedUnitId | undefined =
    q.dimension === 'mass'
      ? units[1]
      : system === 'metric' && q.dimension === 'volume'
        ? 'L'
        : undefined;
  const unit = big && Math.abs(Number(formatInUnit(q, curatedUnit(big)))) >= 1 ? big : units[0];
  return `${formatInUnit(q, curatedUnit(unit), 2)} ${shortUnitLabel(unit)}`;
}

/** A container label in the plural, for user-entered names such as "carton" or "box". */
export function plural(label: string, count: number): string {
  if (count === 1 || !label) return label;
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + 'es';
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + 'ies';
  return label + 's';
}

const quarters = ['', '¼', '½', '¾'];

/** A quantity as containers, rounded to the nearest quarter: "about 4½ cartons". */
export function friendlyContainers(q: ExactQuantity, pack: ExactQuantity, label: string): string {
  const amount = readCanonical(q),
    size = readCanonical(pack);
  if (size <= BigInt(0)) return '';
  if (amount <= BigInt(0)) return `0 ${plural(label, 0)}`;
  const quartersCount = Number((amount * BigInt(4) + size / BigInt(2)) / size);
  if (quartersCount === 0) return `less than ¼ ${label}`;
  const whole = Math.floor(quartersCount / 4),
    part = quarters[quartersCount % 4];
  const text = whole ? `${whole}${part}` : part;
  // Within one smallest stored unit counts as exact, as a counted share may round by that much.
  const gap = amount * BigInt(4) - BigInt(quartersCount) * size;
  const exact = gap >= BigInt(-4) && gap <= BigInt(4);
  return `${exact ? '' : 'about '}${text} ${plural(label, quartersCount === 4 ? 1 : 2)}`;
}

/** A partly used container as a canonical remainder, for counts like "half a carton left". */
export function fractionOfPack(pack: ExactQuantity, quartersLeft: number): ExactQuantity {
  const size = readCanonical(pack);
  return {
    dimension: pack.dimension,
    minor: ((size * BigInt(quartersLeft) + BigInt(2)) / BigInt(4)).toString(),
  };
}

/** How a recipe amount relates to what is bought: "about 6 per carton". */
export function perContainer(amount: ExactQuantity, pack: ExactQuantity, label: string): string {
  const used = readCanonical(amount),
    size = readCanonical(pack);
  if (used <= BigInt(0) || size <= BigInt(0) || amount.dimension !== pack.dimension) return '';
  if (used <= size) {
    const count = Number(size / used);
    return `about ${count} per ${label}`;
  }
  const tenths = Number((used * BigInt(10) + size / BigInt(2)) / size) / 10;
  return `about ${tenths} ${plural(label, tenths)} each`;
}

/**
 * The fixed factor for a product's own measure, such as "1 pump = 0.5 fl oz":
 * canonical whole units (g, mL, each) per measure, as a reduced fraction.
 */
export function measureFactor(amount: string, unitId: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || /^0(?:\.0+)?$/.test(amount))
    throw new Error('Enter how much one measure holds, such as 0.5.');
  const unit = curatedUnit(unitId);
  const [whole, fraction = ''] = amount.split('.');
  let numerator = BigInt(whole + fraction) * BigInt(unit.numerator);
  let denominator = BigInt(10) ** BigInt(fraction.length) * BigInt(unit.denominator);
  let a = numerator,
    b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  if (unit.dimension === 'count' && denominator !== BigInt(1))
    throw new Error('A measure of items must hold a whole number of them.');
  return {
    dimension: unit.dimension,
    numerator: numerator.toString(),
    denominator: denominator.toString(),
  };
}

type PackagingGuess = { container: string; dimension: UnitDimension };

const guesses: Array<[RegExp, PackagingGuess]> = [
  [
    /biscoff|cookie butter|spread|nutella|peanut butter|jam|honey/i,
    { container: 'jar', dimension: 'mass' },
  ],
  [/butter/i, { container: 'box', dimension: 'mass' }],
  [
    /milk|cream|half.?and.?half|half & half|juice|oat|almond|soy/i,
    { container: 'carton', dimension: 'volume' },
  ],
  [/syrup|sauce|vanilla|caramel|extract/i, { container: 'bottle', dimension: 'volume' }],
  [
    /espresso|coffee|bean|blend|decaf|tea|matcha|cocoa|chocolate|sugar|flour|powder/i,
    { container: 'bag', dimension: 'mass' },
  ],
  [/cup|lid|sleeve|straw/i, { container: 'sleeve', dimension: 'count' }],
  [/napkin|bag|stirrer|towel/i, { container: 'pack', dimension: 'count' }],
];

/** A starting guess from a product's name; the person always confirms or changes it. */
export function guessPackaging(name: string): PackagingGuess | null {
  return guesses.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export const CONTAINER_SUGGESTIONS = [
  'carton',
  'jug',
  'bottle',
  'jar',
  'bag',
  'box',
  'case',
  'sleeve',
  'pack',
  'tub',
  'can',
];
