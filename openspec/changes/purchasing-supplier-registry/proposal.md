# Proposal

## Why

Managers currently repeat supplier details on each PO and inventory items expose only one purchasing pack. Saved versioned supplier profiles and supplier-specific mappings provide accurate reusable draft inputs without enabling ordering.

## What Changes

- Add company-owned supplier profiles, accounts, delivery locations, reported email acceptance, ordering rules, immutable versions and archive/history.
- Add exact versioned inventory mappings with supplier-specific packs and optional USD estimates.
- Add manager-only gated registry APIs/UI and registry-backed PO drafts with frozen profile/mapping snapshots.
- Publish a separate mapping projection for a later A/C replenishment integration; preserve fictional proposal contracts and existing drafts.

## Capabilities

### New Capabilities

- `purchasing-supplier-registry`: Authorized versioned suppliers/mappings, exact registry-backed drafts and immutable audit/replay.

### Modified Capabilities

None. The completed but unarchived PO foundation remains a compatibility contract.

## Impact

One additive local migration after 0025, C-owned service/API/UI/tests and evidence. No packages, deployment, supplier contact, external credentials, inventory/proposal writes, approvals, PDF/XLSX or sending.
