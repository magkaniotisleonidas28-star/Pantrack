export const inventorySections = [
  {id:'stock',label:'Stock'}, {id:'recipes',label:'Recipes & sales'},
  {id:'plan',label:'Purchasing plan'}, {id:'activity',label:'Activity'},
] as const;
export const legacyInventorySections = inventorySections;
export const exactInventorySections = inventorySections;
export const supplierSections = [
  {id:'vendors',label:'Vendor connections'}, {id:'rules',label:'Automation rules'},
  {id:'activity',label:'Proposals & orders'}, {id:'schedule',label:'Schedule & setup'},
] as const;
export type InventorySection = typeof inventorySections[number]['id'];
export type SupplierSection = typeof supplierSections[number]['id'];
export type InventoryMode = 'legacy' | 'exact';
