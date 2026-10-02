import {cloverSyncEnabled} from './clover-sync';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import type {ReviewSupplierFixture} from './d1-replenishment-review';

// Development limit accepted by the owner on 2026-09-30 (decision 0004).
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
