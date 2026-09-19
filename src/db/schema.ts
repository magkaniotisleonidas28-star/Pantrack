import {text,integer,sqliteTable,primaryKey,foreignKey,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const products=sqliteTable('products',{owner:text('owner').notNull(),id:text('id').notNull(),data:text('data').notNull()},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const orders=sqliteTable('orders',{owner:text('owner').notNull(),id:text('id').notNull(),data:text('data').notNull(),created:text('created').notNull()},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const companies=sqliteTable('companies',{id:text('id').primaryKey(),name:text('name').notNull(),created:text('created').notNull()});
export const memberships=sqliteTable('memberships',{userId:text('user_id').notNull(),companyId:text('company_id').notNull().references(()=>companies.id),role:text('role').notNull()},t=>[primaryKey({columns:[t.userId,t.companyId]})]);
export const removedOrders=sqliteTable('removed_orders',{companyId:text('company_id').notNull(),orderId:text('order_id').notNull(),removedBy:text('removed_by').notNull(),removedAt:text('removed_at').notNull()},t=>[primaryKey({columns:[t.companyId,t.orderId]})]);
export const paymentCustomers=sqliteTable('payment_customers',{companyId:text('company_id').notNull(),providerScope:text('provider_scope').notNull(),customerId:text('customer_id').notNull()},t=>[primaryKey({columns:[t.companyId,t.providerScope]})]);
export const inventory=sqliteTable('inventory',{companyId:text('company_id').notNull(),productId:text('product_id').notNull(),data:text('data').notNull(),version:integer('version').notNull()},t=>[primaryKey({columns:[t.companyId,t.productId]})]);
export const inventoryEvents=sqliteTable('inventory_events',{companyId:text('company_id').notNull(),id:text('id').notNull(),productId:text('product_id').notNull(),data:text('data').notNull(),created:text('created').notNull()},t=>[primaryKey({columns:[t.companyId,t.id]})]);
export const recipes=sqliteTable('recipes',{companyId:text('company_id').notNull(),id:text('id').notNull(),data:text('data').notNull()},t=>[primaryKey({columns:[t.companyId,t.id]})]);
export const salesImports=sqliteTable('sales_imports',{companyId:text('company_id').notNull(),reference:text('reference').notNull(),data:text('data').notNull(),created:text('created').notNull()},t=>[primaryKey({columns:[t.companyId,t.reference]})]);
export const vendorConnections=sqliteTable('vendor_connections',{companyId:text('company_id').notNull(),id:text('id').notNull(),data:text('data').notNull(),secret:text('secret').notNull().default('')},t=>[primaryKey({columns:[t.companyId,t.id]})]);
export const automationSettings=sqliteTable('automation_settings',{companyId:text('company_id').primaryKey(),data:text('data').notNull(),lastRun:text('last_run'),schedulerHash:text('scheduler_hash'),leaseUntil:text('lease_until')});
export const purchasingJobs=sqliteTable('purchasing_jobs',{companyId:text('company_id').notNull(),id:text('id').notNull(),fingerprint:text('fingerprint').notNull(),status:text('status').notNull(),spendDay:text('spend_day'),amount:integer('amount').notNull(),data:text('data').notNull(),created:text('created').notNull()},t=>[primaryKey({columns:[t.companyId,t.fingerprint]})]);

export const registerMappings=sqliteTable('register_mappings',{companyId:text('company_id').notNull(),externalKey:text('external_key').notNull(),data:text('data').notNull()},t=>[primaryKey({columns:[t.companyId,t.externalKey]})]);

export const cloverConnections=sqliteTable('clover_connections',{companyId:text('company_id').primaryKey(),merchantId:text('merchant_id').notNull(),environment:text('environment').notNull(),secret:text('secret').notNull(),connected:text('connected').notNull(),lastChecked:text('last_checked'),leaseUntil:integer('lease_until').notNull().default(0)});
export const cloverOauthStates=sqliteTable('clover_oauth_states',{stateHash:text('state_hash').primaryKey(),companyId:text('company_id').notNull(),userId:text('user_id').notNull(),environment:text('environment').notNull(),expires:integer('expires').notNull()});

export const registerSettings=sqliteTable('register_settings',{companyId:text('company_id').primaryKey(),data:text('data').notNull(),tokenHash:text('token_hash'),lastReceived:text('last_received')});

export const authUsers=sqliteTable('auth_users',{id:text('id').primaryKey(),email:text('email').notNull(),verifiedAt:integer('verified_at').notNull()});
export const authSessions=sqliteTable('auth_sessions',{hash:text('hash').primaryKey(),userId:text('user_id').notNull().references(()=>authUsers.id),token:text('token').notNull(),expires:integer('expires').notNull(),reauthenticatedAt:integer('reauthenticated_at').notNull(),recovery:integer('recovery').notNull()});
export const companyInvitations=sqliteTable('company_invitations',{id:text('id').primaryKey(),companyId:text('company_id').notNull().references(()=>companies.id),email:text('email').notNull(),role:text('role').notNull(),tokenHash:text('token_hash').notNull(),invitedBy:text('invited_by').notNull(),expires:integer('expires').notNull(),consumedBy:text('consumed_by'),consumedAt:integer('consumed_at'),revokedAt:integer('revoked_at')});
export const ownershipTransfers=sqliteTable('ownership_transfers',{id:text('id').primaryKey(),companyId:text('company_id').notNull().references(()=>companies.id),fromUser:text('from_user').notNull(),toUser:text('to_user').notNull(),expires:integer('expires').notNull(),acceptedAt:integer('accepted_at'),canceledAt:integer('canceled_at')});
export const securityAudit=sqliteTable('security_audit',{id:text('id').primaryKey(),companyId:text('company_id'),actor:text('actor').notNull(),action:text('action').notNull(),target:text('target').notNull(),created:integer('created').notNull()});

export const productUnitVersions=sqliteTable('product_unit_versions',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 productId:text('product_id').notNull(),
 unitId:text('unit_id').notNull(),
 version:integer('version').notNull(),
 kind:text('kind').notNull(),
 dimension:text('dimension'),
 label:text('label').notNull(),
 numerator:text('numerator'),
 denominator:text('denominator'),
 createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),
 retiredAt:text('retired_at'),
},t=>[
 primaryKey({columns:[t.companyId,t.productId,t.unitId,t.version]}),
 foreignKey({columns:[t.companyId,t.productId],foreignColumns:[products.owner,products.id]}),
]);

export const inventoryConfigVersions=sqliteTable('inventory_config_versions',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 productId:text('product_id').notNull(),
 id:text('id').notNull(),
 version:integer('version').notNull(),
 status:text('status').notNull(),
 stockUnitId:text('stock_unit_id').notNull(),
 stockUnitVersion:integer('stock_unit_version').notNull(),
 purchaseUnitLabel:text('purchase_unit_label').notNull(),
 purchaseQuantityMinor:text('purchase_quantity_minor'),
 legacyUnitsPerPack:text('legacy_units_per_pack'),
 effectiveFrom:text('effective_from').notNull(),
 replacedAt:text('replaced_at'),
 createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.productId,t.id]}),
 uniqueIndex('inventory_config_company_product_version').on(t.companyId,t.productId,t.version),
 index('inventory_config_effective_lookup').on(t.companyId,t.productId,t.effectiveFrom),
 foreignKey({columns:[t.companyId,t.productId],foreignColumns:[products.owner,products.id]}),
 foreignKey({columns:[t.companyId,t.productId,t.stockUnitId,t.stockUnitVersion],foreignColumns:[productUnitVersions.companyId,productUnitVersions.productId,productUnitVersions.unitId,productUnitVersions.version]}),
]);

export const inventoryBalancesExact=sqliteTable('inventory_balances_exact',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 productId:text('product_id').notNull(),
 configId:text('config_id').notNull(),
 dimension:text('dimension').notNull(),
 onHandMinor:text('on_hand_minor').notNull(),
 incomingMinor:text('incoming_minor').notNull(),
 estimatedUsedMinor:text('estimated_used_minor').notNull(),
 version:integer('version').notNull(),
 latestCountEffectiveAt:text('latest_count_effective_at'),
 updatedAt:text('updated_at').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.productId]}),
 foreignKey({columns:[t.companyId,t.productId,t.configId],foreignColumns:[inventoryConfigVersions.companyId,inventoryConfigVersions.productId,inventoryConfigVersions.id]}),
]);

export const inventoryConsumptionApplications=sqliteTable('inventory_consumption_applications',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 idempotencyKey:text('idempotency_key').notNull(),
 contract:text('contract').notNull(),
 requestFingerprint:text('request_fingerprint').notNull(),
 occurredAt:text('occurred_at').notNull(),
 resultJson:text('result_json').notNull(),
 appliedAt:text('applied_at').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.idempotencyKey]}),
]);

export const inventoryEventsExact=sqliteTable('inventory_events_exact',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 id:text('id').notNull(),
 productId:text('product_id').notNull(),
 configId:text('config_id').notNull(),
 action:text('action').notNull(),
 dimension:text('dimension').notNull(),
 quantityMinor:text('quantity_minor'),
 enteredAmount:text('entered_amount'),
 enteredUnitId:text('entered_unit_id'),
 balanceVersionBefore:integer('balance_version_before').notNull(),
 balanceVersionAfter:integer('balance_version_after').notNull(),
 effectiveAt:text('effective_at').notNull(),
 recordedAt:text('recorded_at').notNull(),
 actor:text('actor').notNull(),
 note:text('note').notNull(),
 consumptionKey:text('consumption_key'),
},t=>[
 primaryKey({columns:[t.companyId,t.id]}),
 index('inventory_events_exact_product_time').on(t.companyId,t.productId,t.effectiveAt),
 foreignKey({columns:[t.companyId,t.productId,t.configId],foreignColumns:[inventoryConfigVersions.companyId,inventoryConfigVersions.productId,inventoryConfigVersions.id]}),
 foreignKey({columns:[t.companyId,t.consumptionKey],foreignColumns:[inventoryConsumptionApplications.companyId,inventoryConsumptionApplications.idempotencyKey]}),
]);

export const recipeLineages=sqliteTable('recipe_lineages',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 id:text('id').notNull(),
 createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.companyId,t.id]})]);

export const recipeVersions=sqliteTable('recipe_versions',{
 companyId:text('company_id').notNull(),
 recipeId:text('recipe_id').notNull(),
 id:text('id').notNull(),
 version:integer('version').notNull(),
 status:text('status').notNull(),
 name:text('name').notNull(),
 activeFrom:text('active_from'),
 activeTo:text('active_to'),
 legacy:integer('legacy').notNull().default(0),
 createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.recipeId,t.id]}),
 uniqueIndex('recipe_version_company_recipe_number').on(t.companyId,t.recipeId,t.version),
 index('recipe_version_active_lookup').on(t.companyId,t.recipeId,t.activeFrom,t.activeTo),
 foreignKey({columns:[t.companyId,t.recipeId],foreignColumns:[recipeLineages.companyId,recipeLineages.id]}),
]);

export const recipeVersionIngredients=sqliteTable('recipe_version_ingredients',{
 companyId:text('company_id').notNull(),
 recipeId:text('recipe_id').notNull(),
 versionId:text('version_id').notNull(),
 position:integer('position').notNull(),
 productId:text('product_id').notNull(),
 unitId:text('unit_id'),
 unitVersion:integer('unit_version'),
 dimension:text('dimension'),
 quantityMinor:text('quantity_minor'),
 enteredAmount:text('entered_amount').notNull(),
 enteredUnitId:text('entered_unit_id'),
 legacyUnitLabel:text('legacy_unit_label'),
},t=>[
 primaryKey({columns:[t.companyId,t.recipeId,t.versionId,t.position]}),
 foreignKey({columns:[t.companyId,t.recipeId,t.versionId],foreignColumns:[recipeVersions.companyId,recipeVersions.recipeId,recipeVersions.id]}),
 foreignKey({columns:[t.companyId,t.productId],foreignColumns:[products.owner,products.id]}),
 foreignKey({columns:[t.companyId,t.productId,t.unitId,t.unitVersion],foreignColumns:[productUnitVersions.companyId,productUnitVersions.productId,productUnitVersions.unitId,productUnitVersions.version]}),
]);

export const recipeModifierLineages=sqliteTable('recipe_modifier_lineages',{
 companyId:text('company_id').notNull(),
 recipeId:text('recipe_id').notNull(),
 id:text('id').notNull(),
 name:text('name').notNull(),
 createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.recipeId,t.id]}),
 foreignKey({columns:[t.companyId,t.recipeId],foreignColumns:[recipeLineages.companyId,recipeLineages.id]}),
]);

export const recipeModifierVersions=sqliteTable('recipe_modifier_versions',{
 companyId:text('company_id').notNull(),
 recipeId:text('recipe_id').notNull(),
 modifierId:text('modifier_id').notNull(),
 id:text('id').notNull(),
 version:integer('version').notNull(),
 status:text('status').notNull(),
 activeFrom:text('active_from'),
 activeTo:text('active_to'),
 createdBy:text('created_by').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.recipeId,t.modifierId,t.id]}),
 uniqueIndex('modifier_version_company_recipe_modifier_number').on(t.companyId,t.recipeId,t.modifierId,t.version),
 index('modifier_version_active_lookup').on(t.companyId,t.recipeId,t.modifierId,t.activeFrom,t.activeTo),
 foreignKey({columns:[t.companyId,t.recipeId,t.modifierId],foreignColumns:[recipeModifierLineages.companyId,recipeModifierLineages.recipeId,recipeModifierLineages.id]}),
]);

export const recipeModifierDeltas=sqliteTable('recipe_modifier_deltas',{
 companyId:text('company_id').notNull(),
 recipeId:text('recipe_id').notNull(),
 modifierId:text('modifier_id').notNull(),
 versionId:text('version_id').notNull(),
 position:integer('position').notNull(),
 productId:text('product_id').notNull(),
 unitId:text('unit_id').notNull(),
 unitVersion:integer('unit_version').notNull(),
 dimension:text('dimension').notNull(),
 quantityMinor:text('quantity_minor').notNull(),
 enteredAmount:text('entered_amount').notNull(),
 enteredUnitId:text('entered_unit_id').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.recipeId,t.modifierId,t.versionId,t.position]}),
 foreignKey({columns:[t.companyId,t.recipeId,t.modifierId,t.versionId],foreignColumns:[recipeModifierVersions.companyId,recipeModifierVersions.recipeId,recipeModifierVersions.modifierId,recipeModifierVersions.id]}),
 foreignKey({columns:[t.companyId,t.productId],foreignColumns:[products.owner,products.id]}),
 foreignKey({columns:[t.companyId,t.productId,t.unitId,t.unitVersion],foreignColumns:[productUnitVersions.companyId,productUnitVersions.productId,productUnitVersions.unitId,productUnitVersions.version]}),
]);

export const inventoryReconciliations=sqliteTable('inventory_reconciliations',{
 companyId:text('company_id').notNull().references(()=>companies.id),
 id:text('id').notNull(),
 productId:text('product_id').notNull(),
 configId:text('config_id').notNull(),
 dimension:text('dimension'),
 measuredMinor:text('measured_minor'),
 enteredAmount:text('entered_amount').notNull(),
 enteredUnitId:text('entered_unit_id'),
 legacyUnitLabel:text('legacy_unit_label'),
 estimateBeforeMinor:text('estimate_before_minor'),
 varianceMinor:text('variance_minor'),
 effectiveAt:text('effective_at').notNull(),
 recordedAt:text('recorded_at').notNull(),
 actor:text('actor').notNull(),
 note:text('note').notNull(),
 opening:integer('opening').notNull(),
},t=>[
 primaryKey({columns:[t.companyId,t.id]}),
 index('inventory_reconciliation_product_time').on(t.companyId,t.productId,t.effectiveAt),
 foreignKey({columns:[t.companyId,t.productId,t.configId],foreignColumns:[inventoryConfigVersions.companyId,inventoryConfigVersions.productId,inventoryConfigVersions.id]}),
]);
