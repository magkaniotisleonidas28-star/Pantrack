import type {ExactQuantity, UnitDimension} from './inventory-consumption-contract';

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const MILLION = BigInt(1000000);
const MAX = BigInt('9223372036854775807');
const MIN = -MAX - ONE;

export const CURATED_UNIT_IDS = [
  'each','mg','g','kg','oz_mass','lb','mL','L','tsp_us','tbsp_us','fl_oz_us','cup_us','pint_us','quart_us','gallon_us',
] as const;
export type CuratedUnitId = typeof CURATED_UNIT_IDS[number];

type QuantityErrorCode = 'invalid_quantity' | 'invalid_unit' | 'unit_unclassified' | 'unit_incompatible';
export class QuantityError extends Error {
  constructor(public readonly code: QuantityErrorCode, message: string) {
    super(message);
    this.name = 'QuantityError';
  }
}

export type ProductScope = Readonly<{companyId: string; productId: string}>;
export type UnitDefinition = Readonly<{
  id: string;
  version: number;
  label: string;
  dimension: UnitDimension;
  /** Positive rational factor in canonical whole units (g, mL, each). */
  numerator: string;
  denominator: string;
} & ({kind: 'curated'} | ({kind: 'custom'} & ProductScope))>;

function dimension(value: unknown): value is UnitDimension {
  return value === 'count' || value === 'mass' || value === 'volume';
}

function bounded(value: bigint): bigint {
  if (value < MIN || value > MAX) throw new QuantityError('invalid_quantity', 'Quantity exceeds the signed 64-bit range.');
  return value;
}

function quantity(value: bigint, unitDimension: UnitDimension): ExactQuantity {
  return {dimension: unitDimension, minor: bounded(value).toString()};
}

/** Validate database/JSON canonical values before any arithmetic. */
export function readCanonical(value: ExactQuantity): bigint {
  if (!value || !dimension(value.dimension) || typeof value.minor !== 'string' ||
      value.minor.length > 20 || !/^-?(?:0|[1-9]\d*)$/.test(value.minor) || value.minor === '-0') {
    throw new QuantityError('invalid_quantity', 'Expected a canonical integer quantity with a supported dimension.');
  }
  return bounded(BigInt(value.minor));
}

export function formatCanonical(value: ExactQuantity): string {
  const minor = readCanonical(value);
  if (value.dimension === 'count') return minor.toString();
  const digits = (minor < ZERO ? -minor : minor).toString().padStart(7, '0');
  return `${minor < ZERO ? '-' : ''}${digits.slice(0, -6)}.${digits.slice(-6)}`;
}

function positiveFactor(value: string): bigint {
  if (typeof value !== 'string' || value.length > 128 || !/^[1-9]\d*$/.test(value)) {
    throw new QuantityError('invalid_unit', 'Conversion factors must be positive integer strings.');
  }
  return BigInt(value);
}

function curated(id: string, unitDimension: UnitDimension, numerator: string, denominator = '1'): UnitDefinition {
  return Object.freeze({kind: 'curated', id, version: 1, label: id, dimension: unitDimension, numerator, denominator});
}

// US volume factors derive from the A1 gallon: 3785.411784 mL exactly.
const units: Readonly<Record<string, UnitDefinition>> = Object.freeze(Object.fromEntries([
  curated('each', 'count', '1'),
  curated('mg', 'mass', '1', '1000'),
  curated('g', 'mass', '1'),
  curated('kg', 'mass', '1000'),
  curated('oz_mass', 'mass', '45359237', '1600000'),
  curated('lb', 'mass', '45359237', '100000'),
  curated('mL', 'volume', '1'),
  curated('L', 'volume', '1000'),
  ...([['tsp_us', 768], ['tbsp_us', 256], ['fl_oz_us', 128], ['cup_us', 16],
    ['pint_us', 8], ['quart_us', 4], ['gallon_us', 1]] as const)
    .map(([id, divisor]) => curated(id, 'volume', '3785411784', (MILLION * BigInt(divisor)).toString())),
].map(unit => [unit.id, unit])));

/** Only stable IDs are accepted: ambiguous legacy labels require classification. */
export function curatedUnit(id: string): UnitDefinition {
  if (!Object.hasOwn(units, id)) throw new QuantityError('unit_unclassified', 'Select an explicit supported unit or classify a product-specific unit.');
  return units[id];
}

export function customUnit(input: Omit<Extract<UnitDefinition, {kind: 'custom'}>, 'kind'>): UnitDefinition {
  if (!input || !dimension(input.dimension) ||
      !Number.isSafeInteger(input.version) || input.version < 1 ||
      [input.id, input.label, input.companyId, input.productId].some(value => typeof value !== 'string' || !value.trim() || value.length > 200)) {
    throw new QuantityError('invalid_unit', 'Custom units require a product scope, identity, dimension, and positive version.');
  }
  positiveFactor(input.numerator);
  positiveFactor(input.denominator);
  return Object.freeze({...input, kind: 'custom'});
}

/** Round once after rational conversion. Count conversions must be exact. */
export function toCanonical(
  amount: string,
  unit: UnitDefinition,
  scope: ProductScope,
  options: {signed?: boolean; dimension?: UnitDimension} = {},
): ExactQuantity {
  // Revalidate loaded definitions as well as ones returned by the factories.
  if (!unit || (unit.kind !== 'custom' && unit.kind !== 'curated')) {
    throw new QuantityError('unit_unclassified', 'The unit has not been classified.');
  }
  const resolved = unit.kind === 'custom' ? customUnit(unit) : curatedUnit(unit.id);
  if (resolved.kind === 'custom' && (resolved.companyId !== scope.companyId || resolved.productId !== scope.productId)) {
    throw new QuantityError('unit_incompatible', 'This custom unit belongs to a different company or product.');
  }
  if (options.dimension !== undefined && resolved.dimension !== options.dimension) {
    throw new QuantityError('unit_incompatible', 'Cross-dimensional conversions are unsupported.');
  }
  if (typeof amount !== 'string' || amount.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) {
    throw new QuantityError('invalid_quantity', 'Enter plain decimal text with no more than six decimal places.');
  }
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const raw = BigInt(whole + fraction);
  if ((negative && (raw === ZERO || !options.signed)) || (resolved.dimension === 'count' && fraction.length > 0)) {
    throw new QuantityError('invalid_quantity', 'Negative values require a signed operation; counts require whole numbers.');
  }
  const scale = resolved.dimension === 'count' ? ONE : MILLION;
  const numerator = raw * positiveFactor(resolved.numerator) * scale;
  const denominator = positiveFactor(resolved.denominator) * (BigInt(10) ** BigInt(fraction.length));
  const remainder = numerator % denominator;
  if (resolved.dimension === 'count' && remainder !== ZERO) {
    throw new QuantityError('invalid_quantity', 'A count conversion must produce a whole number of each.');
  }
  const rounded = numerator / denominator + (remainder * TWO >= denominator ? ONE : ZERO);
  return quantity(negative ? -rounded : rounded, resolved.dimension);
}

export type TargetInput = {
  target: ExactQuantity;
  onHand: ExactQuantity;
  incoming: ExactQuantity;
  pack: ExactQuantity;
  capacity: ExactQuantity | null;
  /** Maximum total stock usable within shelf life, computed from reviewed usage. */
  shelfLimit: ExactQuantity | null;
  hasOpeningCount: boolean;
  stale: boolean;
};

/** Pure target arithmetic, not an order approval or an M7 proposal policy. */
export function calculateTarget(input: TargetInput) {
  const unitDimension = input.target.dimension;
  const nonnegative = (value: ExactQuantity): bigint => {
    const minor = readCanonical(value);
    if (value.dimension !== unitDimension) throw new QuantityError('unit_incompatible', 'Target inputs must have the same dimension.');
    if (minor < ZERO) throw new QuantityError('invalid_quantity', 'Target calculation inputs must be nonnegative.');
    return minor;
  };
  const target = nonnegative(input.target);
  const position = bounded(nonnegative(input.onHand) + nonnegative(input.incoming));
  const pack = nonnegative(input.pack);
  if (pack === ZERO) throw new QuantityError('invalid_quantity', 'Purchase pack quantity must be positive.');
  const shortfall = target > position ? target - position : ZERO;
  const wanted = shortfall / pack + (shortfall % pack === ZERO ? ZERO : ONE);
  let packs = wanted;
  const limitedBy: ('capacity' | 'shelf_life')[] = [];
  for (const [reason, limit] of [['capacity', input.capacity], ['shelf_life', input.shelfLimit]] as const) {
    if (limit === null) continue;
    const ceiling = nonnegative(limit);
    const maxPacks = ceiling > position ? (ceiling - position) / pack : ZERO;
    if (maxPacks < wanted) limitedBy.push(reason);
    if (maxPacks < packs) packs = maxPacks;
  }
  const reviewReasons: ('opening_count_required' | 'stale_count')[] = [];
  if (!input.hasOpeningCount) {
    packs = ZERO;
    reviewReasons.push('opening_count_required');
  } else if (input.stale) {
    reviewReasons.push('stale_count');
  }
  return {
    position: quantity(position, unitDimension),
    shortfall: quantity(shortfall, unitDimension),
    wantedPacks: wanted.toString(),
    packs: packs.toString(),
    limitedBy,
    reviewReasons,
  };
}
