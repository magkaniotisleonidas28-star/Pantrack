import type { ExactQuantity, UnitDimension } from './inventory-consumption-contract';
import type { ProductUsage } from './stock-usage';

/**
 * R1e (decision 0011): a suggested level for each product, from measured everyday use, the
 * supplier's delivery schedule and spare stock sized by how much daily use varies.
 *
 *   level = everyday use × days to cover + caution factor × daily variation × √(days to cover)
 *
 * Days to cover = delivery days + days between orders. A run-out report in the last 4 weeks
 * raises the caution one step for that product. Suggestions are never applied on their own.
 */

export type Caution = 'lean' | 'balanced' | 'cautious';
export const CAUTION_FACTORS: Readonly<Record<Caution, number>> = {
  lean: 1.04,
  balanced: 1.65,
  cautious: 2.33,
};
const STEP_UP: Readonly<Record<Caution, Caution>> = {
  lean: 'balanced',
  balanced: 'cautious',
  cautious: 'cautious',
};
export const RUN_OUT_WINDOW_DAYS = 28;
export const DEFAULT_COUNT_EVERY_DAYS = 7;

export type SupplierSchedule = Readonly<{
  supplierId: string;
  supplierName: string;
  orderEveryDays: number;
  deliveryDays: number;
}>;

export type LevelInput = Readonly<{
  usage: ProductUsage;
  /** Recorded use for each day of the variation window, oldest first, in minor units (>= 0). */
  dailyRecordedUse: readonly number[];
  /** Suppliers the product is mapped to, with schedules where set. */
  suppliers: readonly Readonly<{
    supplierId: string;
    supplierName: string;
    schedule: SupplierSchedule | null;
  }>[];
  runOutReports: number;
  currentTarget: ExactQuantity | null;
  caution: Caution;
}>;

export type LevelStatus =
  'suggested' | 'needs_history' | 'no_use' | 'needs_supplier' | 'needs_schedule';

export type LevelSuggestion = Readonly<{
  productId: string;
  dimension: UnitDimension;
  status: LevelStatus;
  current: ExactQuantity | null;
  level: ExactQuantity | null;
  perDay: ExactQuantity | null;
  coverDays: number | null;
  spare: ExactQuantity | null;
  /** The supplier whose schedule was used (the longest to cover, when there are several). */
  supplier: SupplierSchedule | null;
  supplierCount: number;
  caution: Caution;
  /** The caution actually used, one step higher after a recent run-out. */
  appliedCaution: Caution;
  runOutReports: number;
  unrecordedPercent: number | null;
}>;

const STEP: Readonly<Record<UnitDimension, number>> = {
  count: 1,
  mass: 1_000_000,
  volume: 1_000_000,
};

/** Sample standard deviation; zero with fewer than two days. */
export function dailyVariation(days: readonly number[]): number {
  if (days.length < 2) return 0;
  const mean = days.reduce((a, b) => a + b, 0) / days.length;
  const squares = days.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squares / (days.length - 1));
}

function exact(dimension: UnitDimension, minor: number): ExactQuantity {
  if (!Number.isFinite(minor) || minor < 0 || minor > Number.MAX_SAFE_INTEGER)
    throw new Error('Suggested level is outside the exact range.');
  return { dimension, minor: String(Math.round(minor)) };
}

export function suggestLevel(input: LevelInput): LevelSuggestion {
  const { usage, caution } = input;
  const scheduled = input.suppliers
    .map((s) => s.schedule)
    .filter((s): s is SupplierSchedule => s !== null)
    .sort(
      (a, b) =>
        b.deliveryDays + b.orderEveryDays - (a.deliveryDays + a.orderEveryDays) ||
        a.supplierName.localeCompare(b.supplierName),
    );
  const appliedCaution = input.runOutReports > 0 ? STEP_UP[caution] : caution;
  const base = {
    productId: usage.productId,
    dimension: usage.dimension,
    current: input.currentTarget,
    supplierCount: input.suppliers.length,
    caution,
    appliedCaution,
    runOutReports: input.runOutReports,
    unrecordedPercent: usage.unrecordedPercent,
  };
  const none = (
    status: LevelStatus,
    supplier: SupplierSchedule | null = null,
  ): LevelSuggestion => ({
    ...base,
    status,
    level: null,
    perDay: null,
    coverDays: null,
    spare: null,
    supplier,
  });
  if (usage.status !== 'enough' || !usage.measuredPerDay) return none('needs_history');
  const perDay = Number(usage.measuredPerDay.minor);
  if (!(perDay > 0)) return none('no_use');
  if (!input.suppliers.length) return none('needs_supplier');
  const supplier = scheduled[0];
  if (!supplier) return none('needs_schedule');
  const coverDays = supplier.deliveryDays + supplier.orderEveryDays;
  // Recorded days are scaled up by the measured gap, so unrecorded use also widens the spare.
  const recorded = usage.recordedPerDay ? Number(usage.recordedPerDay.minor) : 0;
  const scale = recorded > 0 ? perDay / recorded : 1;
  const variation = dailyVariation(input.dailyRecordedUse) * scale;
  const spare = CAUTION_FACTORS[appliedCaution] * variation * Math.sqrt(coverDays);
  const step = STEP[usage.dimension];
  const level = Math.ceil((perDay * coverDays + spare) / step) * step;
  return {
    ...base,
    status: 'suggested',
    level: exact(usage.dimension, level),
    perDay: usage.measuredPerDay,
    coverDays,
    spare: exact(usage.dimension, Math.max(0, level - perDay * coverDays)),
    supplier,
  };
}
