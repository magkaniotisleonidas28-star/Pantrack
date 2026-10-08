# Proposal

## Why

Pantrack needs a durable purchase-order record before implementing email ordering, exports and delivery reconciliation. Approved supplier APIs are not a prerequisite for the first reviewed purchasing pilot.

## What Changes

- Revise M8–M12 for reviewed email POs and add post-launch M13 APIs and M14 automation.
- Add a company-isolated, manager-only D1 PO draft foundation with immutable supplier/delivery snapshots, exact inventory/non-stock lines, proposal references, operation receipts and draft history.
- Provide a default-off manager preview for creating and inspecting saved drafts. No submission, approval, receiving, reservation or inventory mutation is introduced in this slice.
- Preserve legacy orders and the existing fictional supplier demonstration.

## Capabilities

### New Capabilities

- `purchase-order-drafts`: Durable review-only manual/proposal PO creation, cancellation, history and authorization.

### Modified Capabilities

None.

## Impact

One additive local migration, focused C-owned service/API/component/tests, and coordinated roadmap/status edits. No external accounts, new packages, deployment or remote migration. The complete email/PDF/XLSX/receiving rollout is documented as subsequent separately reviewable outcomes, consistent with AGENTS.md.
