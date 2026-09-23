import type {CuratedUnitId} from './inventory-quantities';
import type {ExactQuantity, UnitDimension} from './inventory-consumption-contract';

export type ManagedUnitInput =
  | {kind: 'curated'; id: CuratedUnitId}
  | {kind: 'custom'; id: string; label: string; dimension: UnitDimension; numerator: string; denominator: string};

export type ConfigureInventoryInput = {
  companyId: string;
  productId: string;
  operationId: string;
  actor: string;
  stockUnit: ManagedUnitInput;
  purchaseUnitLabel: string;
  purchaseAmount: string;
  openingAmount?: string;
  effectiveAt: string;
};

export type InventoryMovementInput = {
  companyId: string;
  productId: string;
  operationId: string;
  expectedVersion: number;
  actor: string;
  action: 'receive' | 'use' | 'waste' | 'incoming';
  amount: string;
  unitId: string;
  effectiveAt: string;
  note: string;
  fromIncoming?: boolean;
};

export type InventoryCountInput = {
  companyId: string;
  productId: string;
  operationId: string;
  expectedVersion: number;
  actor: string;
  amount: string;
  unitId: string;
  effectiveAt: string;
  note: string;
};

export type RecipeAmountInput = {
  productId: string;
  amount: string;
  unitId: string;
};

export type RecipeDraftInput = {
  companyId: string;
  recipeId: string;
  draftId: string;
  actor: string;
  name: string;
  ingredients: RecipeAmountInput[];
};

export type ModifierDraftInput = {
  companyId: string;
  recipeId: string;
  modifierId: string;
  draftId: string;
  actor: string;
  name: string;
  deltas: Array<RecipeAmountInput & {signed: boolean}>;
};

export type ActivationInput = {
  companyId: string;
  recipeId: string;
  versionId: string;
  actor: string;
  expectedActiveVersionId: string | null;
};

export type ArchiveInput = Omit<ActivationInput, 'expectedActiveVersionId'>;

export type ModifierActivationInput = ActivationInput & {
  modifierId: string;
};

export type ManagedInventoryRecord = {
  productId: string;
  configId: string;
  dimension: UnitDimension;
  stockUnitId: string;
  stockUnitLabel: string;
  onHand: ExactQuantity;
  incoming: ExactQuantity;
  estimatedUsed: ExactQuantity;
  version: number;
  latestCountEffectiveAt: string | null;
};

export type InventoryReconciliationView = {
  id: string;
  productId: string;
  measured: ExactQuantity;
  estimateBefore: ExactQuantity | null;
  variance: ExactQuantity | null;
  effectiveAt: string;
  recordedAt: string;
  actor: string;
  note: string;
  opening: boolean;
};

export type RecipeVersionView = {
  recipeId: string;
  versionId: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  name: string;
  activeFrom: string | null;
  activeTo: string | null;
  ingredients: Array<RecipeAmountInput & {quantity: ExactQuantity}>;
};

export type ModifierVersionView = {
  recipeId: string;
  modifierId: string;
  versionId: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  name: string;
  activeFrom: string | null;
  activeTo: string | null;
  deltas: Array<RecipeAmountInput & {quantity: ExactQuantity}>;
};

export type LegacyM3Review = {
  products: Array<{productId: string; changedSinceBackfill: boolean; needsOpeningCount: boolean}>;
  recipes: Array<{recipeId: string; changedSinceBackfill: boolean; needsReviewedVersion: boolean}>;
};

export type InventoryManagementView = {
  records: ManagedInventoryRecord[];
  reconciliations: InventoryReconciliationView[];
  legacyRecipeIds: string[];
  recipes: RecipeVersionView[];
  modifiers: ModifierVersionView[];
  legacyReview: LegacyM3Review;
};

export interface InventoryManagementService {
  configure(input: ConfigureInventoryInput): Promise<ManagedInventoryRecord>;
  recordMovement(input: InventoryMovementInput): Promise<ManagedInventoryRecord>;
  recordCount(input: InventoryCountInput): Promise<ManagedInventoryRecord>;
  saveRecipeDraft(input: RecipeDraftInput): Promise<RecipeVersionView>;
  activateRecipe(input: ActivationInput): Promise<RecipeVersionView>;
  archiveRecipe(input: ArchiveInput): Promise<RecipeVersionView>;
  saveModifierDraft(input: ModifierDraftInput): Promise<ModifierVersionView>;
  activateModifier(input: ModifierActivationInput): Promise<ModifierVersionView>;
  archiveModifier(input: ArchiveInput & {modifierId: string}): Promise<ModifierVersionView>;
  read(companyId: string): Promise<InventoryManagementView>;
}
