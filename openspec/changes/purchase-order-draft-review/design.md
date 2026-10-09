# Design

## Context

See proposal.md. Foundation snapshots/lines and operation receipts are immutable; only draft-to-canceled is currently supported. Real approval must eventually claim quantity and spending atomically. User selected editing/review only and allows any owner/manager to review their own drafts.

## Goals / Non-Goals

Goals: one C4 outcome with editable drafts and traceable review. Non-goals: real approval, commitments, transport, documents, receiving and hosted release.

## Decisions

- Keep the original header snapshot and original lines unchanged. Add an immutable snapshot for every aggregate revision, linked to its existing audit event; backfill create/cancel snapshots from immutable legacy headers. This avoids rewriting legacy evidence. The current snapshot is loaded by head revision.
- Extend actions with edit/review, expectedRevision and actor-bound idempotency. Atomic batch guards validate current head, membership and changed sources. All transitions write a revision, event and receipt in one transaction.
- Edits return reviewed heads to draft. Review records the exact content revision, reviewer and time; canceled drafts cannot transition. No second-person rule or approval semantics.
- Source/group identity is fixed. Manual fields/lines are editable; registry profiles are frozen, existing mapping selections may remain frozen while explicit replacements resolve current versions. Proposal lines and references are frozen; only supplier contact/address, notes and cap are editable. No silent source refresh.
- Editing a registry draft checks the saved profile remains current/active; changed profiles require a replacement draft rather than silently adopting new details. Retained mappings are checked at save/review; replacements require explicit selection. Review validates frozen sources and pack versions; changed proposal sources reject review but existing history remains readable.
- UI uses existing tokens/components: compact list, one editor, line rows and desktop summary rail. Mobile stacks the summary below lines. Unsaved changes and uncertain saves protect entered content; history shows selected revision and field differences.

## Risks / Trade-offs

- Review can be confused with approval → labels explicitly say not approved/sent; all ordering gates stay disabled.
- Legacy direct SQL writes → forward triggers validate transitions, snapshot identity and receipt/event agreement; full transactions roll back on guard failure.
- Old clients → original create/cancel remain; new UI handles reviewed cancellation and revision guards.

## Migration Plan

Generate the next additive migration on current main, then add forward guards/backfill. Verify fresh and populated upgrades and preserve all preexisting data. Keep the preview off for rollback; do not remove revision data or deploy older mutation handlers after editing begins. Forward-repair through a new migration. No hosted rollout in this task.
