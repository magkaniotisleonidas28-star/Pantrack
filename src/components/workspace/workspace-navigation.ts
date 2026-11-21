export const inventorySections = [
  { id: 'stock', label: 'Stock' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'plan', label: 'Purchasing plan' },
  { id: 'usage', label: 'Usage & accuracy' },
  { id: 'activity', label: 'Activity' },
] as const;
// Usage & accuracy (R1b) reads exact stock history, so the older stock mode does not offer it.
export const legacyInventorySections = inventorySections.filter((item) => item.id !== 'usage');
export const exactInventorySections = inventorySections;
export const supplierSections = [
  { id: 'vendors', label: 'Your suppliers' },
  { id: 'rules', label: 'Automation rules', soon: true },
  { id: 'activity', label: 'Suggested orders', soon: true },
  { id: 'schedule', label: 'Schedule', soon: true },
] as const;
export const salesSections = [
  { id: 'record', label: 'Record sales' },
  { id: 'history', label: 'Sales history' },
  { id: 'insights', label: 'Insights', soon: true },
] as const;

export type InventorySection = (typeof inventorySections)[number]['id'];

export type SupplierSection = (typeof supplierSections)[number]['id'];

export type SalesSection = (typeof salesSections)[number]['id'];

export type InventoryMode = 'legacy' | 'exact';
