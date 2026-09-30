import {cloverSyncEnabled} from './clover-sync';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import type {ReviewSupplierFixture} from './d1-replenishment-review';

// Provisional development review limit. M7 acceptance must record a reviewed policy.
export function a8ReviewPolicy(): CloverReviewPolicy {
  return {syncEnabled: cloverSyncEnabled(), maxLagMs: 10 * 60_000};
}

export function a8UnverifiedSupplier(companyId: string): ReviewSupplierFixture {
  return {
    companyId, source: 'fictional_fixture', mappingId: 'a8-preview-unmapped',
    mappingVersion: 1, supplierId: 'unverified', accountId: 'unverified',
    locationId: 'unverified', sku: 'unmapped',
  };
}
