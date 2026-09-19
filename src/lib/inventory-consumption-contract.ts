export const INVENTORY_CONSUMPTION_CONTRACT = 'pantrack.inventory-consumption.v1' as const;

export type UnitDimension = 'count' | 'mass' | 'volume';

export type ExactQuantity = {
  dimension: UnitDimension;
  /** Canonical signed fixed-point integer encoded in base 10. */
  minor: string;
};

export type ConsumptionModifier = {
  modifierId: string;
  /** Positive whole number of modifier occurrences. */
  quantity: string;
};

export type ConsumptionLine = {
  lineId: string;
  recipeId: string;
  /** Positive whole number of menu items represented by this line. */
  quantity: string;
  modifiers: ConsumptionModifier[];
};

export type InventoryConsumptionRequest = {
  contract: typeof INVENTORY_CONSUMPTION_CONTRACT;
  companyId: string;
  /** Stable company-scoped identity supplied by the ingestion service. */
  idempotencyKey: string;
  /** RFC 3339 time at which the sale occurred, including its UTC offset. */
  occurredAt: string;
  lines: ConsumptionLine[];
};

export type ConsumptionHoldCode =
  | 'opening_count_required'
  | 'before_count_cutoff'
  | 'inventory_not_configured'
  | 'unit_unclassified'
  | 'unit_incompatible'
  | 'recipe_version_not_found'
  | 'modifier_version_not_found'
  | 'negative_modifier_result';

export type ConsumptionRejectCode =
  | 'invalid_contract'
  | 'invalid_request'
  | 'invalid_occurrence_time'
  | 'invalid_quantity'
  | 'idempotency_conflict';

export type ConsumptionIssue = {
  code: ConsumptionHoldCode | ConsumptionRejectCode;
  message: string;
  lineId?: string;
  recipeId?: string;
  modifierId?: string;
  productId?: string;
};

export type SelectedModifierVersion = {
  modifierId: string;
  modifierVersionId: string;
  quantity: string;
};

export type SelectedRecipeVersion = {
  lineId: string;
  recipeId: string;
  recipeVersionId: string;
  quantity: string;
  modifiers: SelectedModifierVersion[];
};

export type InventoryConsumptionChange = {
  productId: string;
  consumed: ExactQuantity;
  balanceBefore: ExactQuantity;
  balanceAfter: ExactQuantity;
  versionBefore: number;
  versionAfter: number;
};

type ConsumptionResultBase = {
  contract: typeof INVENTORY_CONSUMPTION_CONTRACT;
  companyId: string;
  idempotencyKey: string;
  /** True only when returning the previously applied result for the same input. */
  replayed: boolean;
};

export type InventoryConsumptionApplied = ConsumptionResultBase & {
  status: 'applied';
  occurredAt: string;
  selectedVersions: SelectedRecipeVersion[];
  changes: InventoryConsumptionChange[];
};

export type InventoryConsumptionHeld = ConsumptionResultBase & {
  status: 'held';
  issues: ConsumptionIssue[];
};

export type InventoryConsumptionRejected = ConsumptionResultBase & {
  status: 'rejected';
  issues: ConsumptionIssue[];
};

export type InventoryConsumptionResult =
  | InventoryConsumptionApplied
  | InventoryConsumptionHeld
  | InventoryConsumptionRejected;

/**
 * Company authorization and provider authentication happen before this port.
 * An implementation must apply every returned change atomically or apply none.
 *
 * An applied request permanently claims its company-scoped idempotency key.
 * Repeating the same semantic input returns the original application with
 * `replayed: true`; changing the input returns `idempotency_conflict`. Held and
 * rejected requests claim no key and may be retried after mappings or inventory
 * configuration are repaired.
 */
export interface InventoryConsumptionPort {
  consume(request: InventoryConsumptionRequest): Promise<InventoryConsumptionResult>;
}
