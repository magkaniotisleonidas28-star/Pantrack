export const inventorySections = [
  { id: 'stock', label: 'Stock' },
  { id: 'recipes', label: 'Recipes & sales' },
  { id: 'plan', label: 'Purchasing plan' },
  { id: 'activity', label: 'Activity' },
] as const;
export const legacyInventorySections = inventorySections;
export const exactInventorySections = inventorySections;
export const supplierSections = [
  { id: 'vendors', label: 'Your suppliers' },
  { id: 'rules', label: 'Automation rules', soon: true },
  { id: 'activity', label: 'Suggested orders', soon: true },
  { id: 'schedule', label: 'Schedule', soon: true },
] as const;

export type InventorySection = (typeof inventorySections)[number]['id'];

export type SupplierSection = (typeof supplierSections)[number]['id'];

export type InventoryMode = 'legacy' | 'exact';
