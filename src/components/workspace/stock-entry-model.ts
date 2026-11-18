import type { UnitDimension } from '@/lib/inventory-consumption-contract';
import type {
  ConfigureInventoryInput,
  InventoryCountInput,
  InventoryMovementInput,
  ManagedInventoryRecord,
  PackageQuantityInput,
  PackageStockInput,
} from '@/lib/inventory-management-contract';
import {
  curatedUnit,
  customUnit,
  formatCanonical,
  toCanonical,
  type CuratedUnitId,
  type UnitDefinition,
} from '@/lib/inventory-quantities';
import { formatInUnit, packageTotal } from '@/lib/stock-pack-quantities';
import {
  everydayUnit,
  fractionOfPack,
  guessPackaging,
  measureFactor,
  plural,
  shortUnitLabel,
  type MeasurementSystem,
} from '@/lib/unit-preferences';

export type StockEntryAction = 'receive' | 'count' | 'use' | 'incoming' | 'configure';
export type StockEntryBasis = 'packages' | 'measured';
export type OpenPart = '0' | '1' | '2' | '3' | 'exact';

const canonicalId = (dimension: UnitDimension): CuratedUnitId =>
  dimension === 'mass' ? 'g' : dimension === 'volume' ? 'mL' : 'each';

export function stockEntryGuess(name: string, system: MeasurementSystem) {
  const guess = guessPackaging(name);
  if (!guess) return null;
  return {
    pack: guess.container,
    dimension: guess.dimension,
    unit: everydayUnit(system, guess.dimension),
  };
}

type StockEntryDefaults = {
  measurement: UnitDefinition | null;
  unit: CuratedUnitId | '';
  pack: string;
  packAmount: string;
  contentUnitId: string;
  custom: boolean;
  customLabel: string;
  dimension: UnitDimension;
  measureUnitId: CuratedUnitId;
  packagingTouched: boolean;
};

export function stockEntryDefaults(
  record: ManagedInventoryRecord | undefined,
  productName: string,
  system: MeasurementSystem,
  editorUnitId: string,
): StockEntryDefaults {
  const guess = record ? null : stockEntryGuess(productName, system);
  const measurement = record?.measurementUnit ?? (guess ? curatedUnit(guess.unit) : null);
  const dimension = measurement?.dimension ?? 'volume';
  const purchase = record?.purchase;
  return {
    measurement,
    unit: measurement
      ? measurement.kind === 'curated'
        ? (measurement.id as CuratedUnitId)
        : canonicalId(dimension)
      : '',
    pack: purchase?.label ?? guess?.pack ?? '',
    packAmount: purchase?.enteredAmount ?? (purchase ? formatCanonical(purchase.quantity) : ''),
    contentUnitId:
      measurement?.kind === 'custom' && purchase?.enteredUnitId === measurement.id
        ? editorUnitId
        : (purchase?.enteredUnitId ??
          (record ? canonicalId(record.dimension) : (measurement?.id ?? ''))),
    custom: measurement?.kind === 'custom',
    customLabel: measurement?.kind === 'custom' ? measurement.label : 'pump',
    dimension,
    measureUnitId: everydayUnit(system, dimension),
    packagingTouched: !!record,
  };
}

/** The displayed editor value may round. Reconfiguration keeps the stored factor until edited. */
export function stockEntryMeasureText(measurement: UnitDefinition | null, unitId: CuratedUnitId) {
  if (measurement?.kind !== 'custom') return '';
  try {
    return formatInUnit(toCanonical('1', measurement, measurement), curatedUnit(unitId), 3);
  } catch {
    return '';
  }
}

export type StockEntryDraft = {
  companyId: string;
  productId: string;
  record?: ManagedInventoryRecord;
  identity: { product: string; operation: string; unit: string };
  system: MeasurementSystem;
  action: StockEntryAction;
  basis: StockEntryBasis;
  unit: CuratedUnitId | '';
  pack: string;
  packAmount: string;
  contentUnitId: string;
  custom: boolean;
  customLabel: string;
  dimension: UnitDimension;
  measureAmount: string;
  measureUnitId: CuratedUnitId;
  measureEdited: boolean;
  packages: string;
  remainder: string;
  openPart: OpenPart;
  amount: string;
  name: string;
  supplier: string;
  sku: string;
  time: string;
  note: string;
  fromIncoming: boolean;
};

export function stockEntryMode(
  productId: string,
  record: ManagedInventoryRecord | undefined,
  action: StockEntryAction,
) {
  const isNew = productId === 'new';
  const setup = isNew || (!!productId && !record) || action === 'configure';
  return { isNew, setup, opening: setup && !record };
}

function customFactor(draft: StockEntryDraft) {
  const saved = draft.record?.measurementUnit;
  if (!draft.measureEdited && saved?.kind === 'custom') {
    return { numerator: saved.numerator, denominator: saved.denominator };
  }
  const { numerator, denominator } = measureFactor(draft.measureAmount, draft.measureUnitId);
  return { numerator, denominator };
}

export function stockEntryPreview(draft: StockEntryDraft) {
  const {
    companyId,
    productId,
    record,
    identity,
    system,
    action,
    basis,
    unit,
    pack,
    packAmount,
    contentUnitId,
    custom,
    customLabel,
    dimension,
    packages,
    remainder,
    openPart,
    amount,
  } = draft;
  const { isNew, setup, opening } = stockEntryMode(productId, record, action);
  const scope = { companyId, productId: isNew ? identity.product : productId };
  let measurement: UnitDefinition | null = null;
  let preview = '',
    packagePreview = '';
  let remainderInput = { remainder: '0', remainderUnitId: '' };

  try {
    measurement = setup
      ? custom
        ? customUnit({
            ...scope,
            id: identity.unit,
            version: 1,
            label: customLabel,
            dimension,
            ...customFactor(draft),
          })
        : curatedUnit(unit)
      : (record?.measurementUnit ?? null);
    if (measurement) {
      const packQuantity = setup
        ? toCanonical(
            packAmount,
            contentUnitId === measurement.id || contentUnitId === identity.unit
              ? measurement
              : curatedUnit(contentUnitId),
            scope,
            { dimension: measurement.dimension },
          )
        : (record?.purchase?.quantity ?? null);

      // Use the entered container unit for the package description when it is a curated unit.
      const packEveryday =
        packQuantity &&
        curatedUnit(
          setup &&
            contentUnitId &&
            contentUnitId !== identity.unit &&
            curatedUnit(contentUnitId).dimension === packQuantity.dimension
            ? contentUnitId
            : everydayUnit(system, packQuantity.dimension),
        );
      if (packQuantity && packEveryday && BigInt(packQuantity.minor) > BigInt(0)) {
        const label = (setup ? pack : record?.purchase?.label) || 'container';
        const size = formatInUnit(packQuantity, packEveryday, 2);
        const customSize =
          measurement.kind === 'custom'
            ? `, about ${formatInUnit(packQuantity, measurement, 0)} ${plural(measurement.label, 2)}`
            : '';
        packagePreview = `One ${label} holds ${size} ${shortUnitLabel(packEveryday)}${customSize}.`;
      }

      remainderInput =
        measurement.dimension === 'count' || openPart === 'exact'
          ? {
              remainder: remainder || '0',
              remainderUnitId:
                measurement.dimension === 'count'
                  ? measurement.id
                  : everydayUnit(system, measurement.dimension),
            }
          : {
              remainder: packQuantity
                ? formatCanonical(fractionOfPack(packQuantity, Number(openPart)))
                : '0',
              remainderUnitId: canonicalId(measurement.dimension),
            };

      if ((opening || !setup) && productId) {
        const total =
          basis === 'packages' && action !== 'use' && packQuantity
            ? packageTotal(
                packQuantity,
                {
                  packages,
                  ...(opening || action === 'count'
                    ? remainderInput
                    : { remainder: '0', remainderUnitId: measurement.id }),
                },
                measurement,
                scope,
              )
            : toCanonical(amount, measurement, scope);
        const everyday = curatedUnit(everydayUnit(system, total.dimension));
        const label = opening
          ? 'Opening stock'
          : action === 'count'
            ? 'New physical total'
            : action === 'incoming'
              ? 'Expected incoming'
              : action === 'use'
                ? 'Stock used'
                : 'Stock increase';
        preview = `${label}: ${formatInUnit(total, everyday, 2)} ${shortUnitLabel(everyday)}`;
      }
    }
  } catch {
    // Incomplete fields have no calculation preview. The save validates its inputs separately.
  }

  return { measurement, preview, packagePreview, remainderInput };
}

type ConfigurationRequest = Omit<ConfigureInventoryInput, 'actor'>;
export type StockEntryRequest =
  | (ConfigurationRequest & { action: 'configureExact' })
  | (ConfigurationRequest & {
      action: 'createStockExact';
      name: string;
      supplier: string;
      sku: string;
    })
  | (Omit<PackageStockInput, 'actor' | 'action'> & {
      action: 'packageStockExact';
      movement: PackageStockInput['action'];
    })
  | (Omit<InventoryCountInput, 'actor'> & { action: 'countExact' })
  | (Omit<InventoryMovementInput, 'actor' | 'action' | 'wasteReason'> & {
      action: 'movementExact';
      movement: 'receive' | 'use' | 'incoming';
    });

/** The editor calls this on first submit and retains the request for uncertain retries. */
export function buildStockEntryRequest(
  draft: StockEntryDraft,
  remainderInput: Omit<PackageQuantityInput, 'packages'>,
): StockEntryRequest {
  const {
    companyId,
    productId,
    record,
    identity,
    action,
    basis,
    unit,
    pack,
    packAmount,
    contentUnitId,
    custom,
    customLabel,
    dimension,
    packages,
    amount,
    time,
    name,
    supplier,
    sku,
    note,
    fromIncoming,
  } = draft;
  const isNew = productId === 'new';
  const common = {
    companyId,
    productId: isNew ? identity.product : productId,
    operationId: identity.operation,
    effectiveAt: new Date(time).toISOString(),
  };

  if (isNew || (!!productId && !record) || action === 'configure') {
    if (!unit && !custom) throw new Error('Choose what one container holds, such as 64 fl oz.');
    const stockUnit = custom
      ? {
          kind: 'custom' as const,
          id: identity.unit,
          label: customLabel.trim(),
          dimension,
          ...customFactor(draft),
        }
      : { kind: 'curated' as const, id: unit as CuratedUnitId };
    const config = {
      stockUnit,
      purchaseUnitLabel: pack.trim(),
      purchaseAmount: packAmount,
      purchaseContentUnitId: contentUnitId,
      ...(record
        ? { expectedConfigId: record.configId }
        : basis === 'packages'
          ? { openingPackages: { packages, ...remainderInput } }
          : { openingAmount: amount }),
    };
    return isNew
      ? { ...common, action: 'createStockExact', name, supplier, sku, ...config }
      : { ...common, action: 'configureExact', ...config };
  }
  if (basis === 'packages' && action !== 'use' && record?.purchase) {
    return {
      ...common,
      action: 'packageStockExact',
      configId: record.configId,
      expectedVersion: record.version,
      movement: action,
      quantity: {
        packages,
        ...(action === 'count'
          ? remainderInput
          : { remainder: '0', remainderUnitId: record.stockUnitId }),
      },
      note,
      ...(action === 'receive' ? { fromIncoming } : {}),
    };
  }
  if (action === 'count') {
    return {
      ...common,
      action: 'countExact',
      amount,
      unitId: record!.stockUnitId,
      expectedVersion: record!.version,
      note,
    };
  }
  return {
    ...common,
    action: 'movementExact',
    movement: action,
    fromIncoming,
    amount,
    unitId: record!.stockUnitId,
    expectedVersion: record!.version,
    note,
  };
}
