export const legacyInventorySections = [
  {id:'stock',label:'Stock & exceptions'}, {id:'recipes',label:'Recipes & sales'},
  {id:'plan',label:'Purchasing plan'}, {id:'activity',label:'Activity'},
] as const;
export const exactInventorySections = [
  {id:'stock',label:'Exact stock'}, {id:'recipes',label:'Recipe versions'},
  {id:'legacy',label:'Older-data review'},
  {id:'sales',label:'Sales & exceptions'}, {id:'plan',label:'Planning explanation'},
  {id:'history',label:'Count history'}, {id:'clover-plan',label:'Clover review'},
] as const;
export const supplierSections = [
  {id:'vendors',label:'Vendor connections'}, {id:'rules',label:'Automation rules'},
  {id:'activity',label:'Proposals & orders'}, {id:'schedule',label:'Schedule & setup'},
] as const;
export type InventorySection = typeof legacyInventorySections[number]['id'] | typeof exactInventorySections[number]['id'];
export type SupplierSection = typeof supplierSections[number]['id'];
export type InventoryMode = 'legacy' | 'exact';
