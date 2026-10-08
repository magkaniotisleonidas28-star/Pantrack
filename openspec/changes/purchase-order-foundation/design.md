# Design

## Context

See proposal.md. Existing orders are prototype JSON records; existing C4 simulation and v1/v2 A handoffs are fictional and network-free. AGENTS.md requires one reviewable task outcome, no complete milestone in a task, company isolation, and additive serialized migrations.

## Goals / Non-Goals

This C4 slice provides a durable local draft, its line records and history, a gated manager interface and the adopted roadmap. It does not implement all M8 gates. Supplier profiles/mappings, draft editing/approval, issued PDFs, XLSX, email dispatch, confirmations and inventory receiving are subsequent outcomes in the rollout document.

## Decisions

- Store header, immutable snapshot, normalized line identities, append-only audit events and operation receipts in separate D1 tables. Use UUID-based PO references to avoid a cross-company/global numbering race. Leave legacy orders untouched.
- Commands accept manual fields or saved proposal IDs/revisions, never client-trusted A handoffs. Read A origins/state/events without calling the lifecycle getter, which can invalidate proposal history. Reconstruct immutable v1/v2 handoffs and check current inventory/config/settings/sales sources inside the final transaction. Do not relabel fictional mappings as production evidence.
- Manual stock lines use an explicitly selected company product and active config ID/version. Resolve exact conversion on the server. Manual non-stock lines have no stock fields. Each draft has one supplier/account/location, USD, a delivery address, whole-pack quantities, optional estimated prices and a proposed spending cap; none is an approval or reservation.
- Use strict bounded schemas, BigInt arithmetic and a guarded D1 batch with immutable operation receipts. Check individual sources in separate statements to stay within D1's parameter limit. Mutation guards include fresh membership and expected revision. Replay is authorized and fingerprinted by actor and original command.
- Expose GET list/detail and POST create/cancel behind PANTRACK_PO_DRAFT_PREVIEW=enabled. Default off without new cloud configuration. Manager preview is additive to the existing workspace navigation. No send/approve/receive control.

## Risks / Trade-offs

- Current proposal mappings are fictional → show this in saved warnings; production A→C mapping handoff is an explicit later gate.
- Supplier details are initially frozen per draft → durable supplier registry and versioned mappings are the next C4 outcome, not silently inferred from prototype vendor connections.
- Drafts do not reserve quantity or spending → multiple drafts are permitted; future approval must claim commitments atomically and reject duplicates.
- No edit operation in this foundation → cancel with reason and create a replacement; approval/editing is a subsequent outcome.

## Migration Plan

Generate the next additive migration from current schema/journal, append reviewed audit/guard triggers, test fresh apply and compatibility with existing records. Local only. Rollback: disable preview and revert service/UI code, retain all purchasing tables/history; use a forward repair for schema corrections. No destructive down migration or remote migration is authorized.

## Subsequent rollout

The repository rollout document retains the full adopted plan, sequencing, export/email defaults, A-owned atomic confirmation/receiving port, external gates and M13/M14 deferred integrations. Completion of this change proves the foundation only, not completion of that rollout.
