# C4 purchase-order draft editing and review — local evidence

Date: 2026-10-08. Outcome: complete locally on `workstream-c/c4-po-draft-review`.
This is one C4 slice of the [PO-first rollout](PURCHASE_ORDER_ROLLOUT.md).
C4/M8 acceptance remains open.

## Behavior and contracts

Owners/managers can edit saved drafts with a reason and review their own or
another manager's current draft after acknowledging its warnings. Review records
actor, time and content revision. A saved edit requires another review; canceled
drafts remain read-only. Reviewed drafts can also be canceled without deleting
history. No purchase approval or external effects are enabled.

`POST /api/purchase-orders` adds `edit` and `review`, requiring `operationId` and
`expectedRevision`. Edits require source-appropriate content and a 4–500 character
reason; review requires `acknowledgeWarnings: true`. `GET` accepts `orderId` plus
optional positive `revision`. Views add `reviewed` status and review metadata.
Existing create/cancel, server authorization, CSRF and default-off gating remain.

Manual fields/lines are editable. Registry supplier profiles/groups stay frozen;
changed mappings require explicit selection. Proposal lines/quantities stay
frozen while contact/address, cap and notes are editable. Sources are checked at
save/review and guarded again at commit. Unknown prices stay null and caps must
cover the known subtotal. New registry snapshots retain exact account/location
IDs because display references can repeat. Older snapshots use saved mappings or
a unique saved profile group; ambiguous groups require a replacement draft.

## Migration and rollback

Additive `0027_purchase_order_draft_review.sql` adds immutable snapshots linked
to audit events. Legacy create/cancel snapshots are backfilled from unchanged
original headers. Existing headers' original snapshots, lines, receipts and
events are preserved. SQL guards enforce transitions, identity and receipt/audit
agreement; each event inserts its revision in the same atomic D1 transaction.

Generated on main `d65a947`, which still matched remote main at final inspection;
used migrations were not changed. Fresh apply, populated-main upgrade, legacy
draft/cancel preservation, subsequent legacy editing, FKs and integrity pass.
A consistent private backup preceded ordinary local D1 migration; the isolated
preview D1 was also migrated. No remote migration occurred. Private backups are
in ignored `.sites-runtime/po-review-backups/`.

Rollback by keeping the preview disabled. Preserve revision history and repair
through a new migration. Do not restore old initial-snapshot mutation handlers
after edits have been recorded.

## Verification

- PASS — `pnpm typecheck`; `pnpm test` (50 suites); `pnpm db:check` (28 ordered
  migrations, 83 tables, fresh apply and no drift); `pnpm build`.
- PASS — `pnpm db:migrate:local`; `pnpm test:local`. Its first attempt encountered
  the existing dev-server lock; stopping that server, rerunning successfully and
  restarting the ordinary preview resolved it.
- PASS — `node scripts/purchase-order-review-local-check.mjs` against
  `pnpm dev:purchase-orders`: served D1 edit/review/invalidation, replay, history,
  stale/company guards and unchanged inventory.
- PASS — isolated Chromium desktop (1440 px) and mobile (390 px): creation,
  own review, edit invalidation, readable differences, inline validation/focus,
  discard protection and no runtime errors. Mobile had no horizontal overflow;
  the summary followed the main content.
- PASS — served browser stale/lost-response recovery: values survive 409,
  loading latest requires explicit discard, uncertain saves lock changes and
  draft navigation, and retry uses the identical request for one committed revision.
  Zero-cap validation exposes its linked inline error.
- PASS — Impeccable detector returned no findings; strict OpenSpec validation;
  `git diff --check` and changed relative-link validation.

Browser inspection found and fixed value clearing caused by validation-state
updates during input capture, plus spacing inherited from older fieldset rules.
Browser tooling, screenshots and results remain ignored local artifacts; no
application dependency or lockfile change was introduced.

## Limits and handoff

All evidence is local and fictional. No hosted CI, deployment, supplier contact,
real ordering, budget/quantity reservation, proposal change or stock/incoming
change is claimed. Ordinary/hosted purchasing remains default-off. No A/B domain
source or shared workspace navigation was changed.

Next C4 handoff: A/C atomic quantity commitments, duplicate-source prevention
and owner-configured spending controls before true purchase approval. PDF/XLSX,
email dispatch and confirmation/receiving remain separate outcomes.
