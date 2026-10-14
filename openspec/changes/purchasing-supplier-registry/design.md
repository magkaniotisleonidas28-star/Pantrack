# Design

## Context

See proposal.md. Foundation 0025 and fictional proposal v1/v2 remain untouched compatibility contracts. A owns exact inventory and replenishment. One C4 outcome; local additive schema only.

## Goals / Non-Goals

Deliver reusable supplier/account/location profiles and supplier-specific inventory packs usable in saved drafts. No recalculation, inventory changes, supplier contact, sending, approval or export.

## Decisions

- Store current supplier/mapping heads separately from immutable version JSON. Profiles include bounded stable-ID account/location lists with archive flags; old IDs cannot disappear or change parent. Separate mapping heads enforce one active SKU per supplier/account/location. Audit and actor/payload receipts accompany every mutation in a guarded D1 batch.
- Profile edits keep mappings linked by stable group IDs. Mapping eligibility checks active parent/children and the current inventory config; changes to config require a new reviewed mapping version. Archive is terminal for this slice; historical versions remain readable.
- Convert supplier pack amounts through existing curated or company/product custom unit definitions on the server; freeze entered input, resolved unit and exact canonical quantity. Config purchase size is not rewritten. Unknown estimates remain null.
- New registry-backed source uses PO draft v2; saved v1 and its manual/fictional command shapes remain supported. New commands reference expected supplier/mapping/config versions, with at-commit guards. Store full profile and mapping projections in the immutable PO snapshot, including estimates and warnings. Keep non-stock lines manual.
- Publish `pantrack.supplier-mapping.v1` with `manual_registry` provenance, current profile/group/mapping/config references and frozen exact pack. It is review-only, not an A proposal or verified supplier catalog. Production A proposal generation is a separate handoff.
- Manager/owner service identity and route guards; no employee pricing/account access. Default-off existing preview gate. APIs expose 20-record pages with explicit hasMore; UI follows pages and does not silently truncate choices. No new packages.

## Risks / Trade-offs

- Reported email acceptance is not verified supplier evidence → retain attribution, warnings and sending gate.
- Supplier-specific packs differ from item purchase packs → display both exact unit identities and reject dimension/stale config errors; never transform old proposals.
- Concurrent changes/lost responses → operation receipt plus fresh membership/version guards, exact request retry in UI.

## Migration Plan

Generate 0026 after current 0025 in this serial local worktree. Add immutable/version/audit triggers, inspect SQL/snapshot/journal and fresh/legacy tests. Do not migrate remote. Rollback disables preview/code; retain history and repair forward. Existing drafts are not backfilled.
