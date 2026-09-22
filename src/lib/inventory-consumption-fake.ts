// Preserve the published A2 fixture API while sharing the domain rules.
export {
  InventoryConsumptionEngine as FakeInventoryConsumptionPort,
  type InventoryConsumptionState as FakeInventoryConsumptionFixture,
  type InventoryBalance as FakeInventoryBalance,
  type RecipeIngredient as FakeRecipeIngredient,
  type RecipeVersion as FakeRecipeVersion,
  type ModifierVersion as FakeModifierVersion,
} from '@/lib/inventory-consumption-engine';
