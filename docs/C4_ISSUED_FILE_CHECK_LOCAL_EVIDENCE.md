# C4 explicit issued-file checks — local evidence

Recorded: 2026-11-01. Workstream/checklist: C4, one bounded document-recovery
outcome. Current company owners/managers can explicitly check an issued PDF or
Excel copy and retrieve that check's recorded result after an interrupted reply.
This implements the first slice in the
[recovery policy](C4_DOCUMENT_RECOVERY_POLICY_20261101.md).

## Contract and behavior

- **Check file now** reads the exact immutable issued object through the same
  bounded, audited reader used for downloads. It records verified, missing,
  damaged or unavailable with the actual observation time. It cannot render,
  write, publish, replace, delete or continue an unissued save.
- The strict POST command binds company, document and check operation identity.
  Current owner/manager access and CSRF are enforced at the route; current
  membership and immutable artifact identity are checked again in committing SQL.
  The viewer header is an identity precondition, never a role or authorization.
- The browser stores the exact command before dispatch. Stop waiting, a lost
  response and reopening review retain that command. Retrying returns its one
  durable receipt without another object read; a deliberate new check gets a
  new operation ID. Concurrent duplicates may read more than once, but settle on
  one receipt. Another actor/document or a non-check observation cannot reuse it.
- Inputs to the outcome are durably appended before evaluation. Receipt metadata
  points to that observation and immutable manifest. Audit acknowledgments may
  recover from committed state; missing audit evidence fails closed.
- A receipt's insertion time never makes it a newer physical file observation.
  Review excludes replay receipts from its diagnostic projection/history, so a
  delayed old healthy receipt cannot hide a newer damaged check. Earlier failures
  remain retained. Refresh reads the journal and performs no file check.
- The client checks current metadata/access before displaying a receipt and owns
  cancellation through response-body consumption. Selection changes/unmounts
  dispose obsolete work. Saved copies stay checkable after later edits/cancellation.

No migration, schema, package, binding or deployed configuration change is added.
Only existing `document_archive_observations` rows may append. Business rows,
immutable manifests/intents, attempts and object bytes remain unchanged. The
existing archive preview flag keeps ordinary and hosted configurations off.
Root/hosted databases and live suppliers/models are untouched.

## Implementation and affected contracts

The [new route](../src/app/api/purchase-order-documents/check/route.ts),
[service](../src/lib/issued-file-check.ts),
[D1 receipts](../src/lib/d1-issued-file-checks.ts) and
[strict command/result](../src/lib/issued-file-check-contract.ts) reuse the
[shared archive reader](../src/lib/purchase-order-document-archive.ts).
`observeRead` now optionally returns its durable observation ID/time; existing
void-returning test adapters remain compatible. The native D1 adapter supplies
that proof, required for a check receipt. This adds no supplier/inventory contract.

The [client](../src/lib/issued-file-check-client.ts) and
[control](../src/components/workspace/issued-file-check.tsx) join existing review.
Every issued entry offers Review saved PDF/Excel, including healthy copies that
do not appear in the attention list. Existing save/download controls remain.

## Verification and integration

Evidence root (absolute, outside the worktree):
`C:/Users/Leo/Project/Pantrack/.sites-runtime/c4-issued-file-check-20261101`.
Native route/resource cases are in
[issued checks](../tests/helpers/issued-file-check-api.mjs) and the existing
[archive API harness](../tests/document-archive-api.mjs). Client lifetime cases
are in [the focused suite](../tests/issued-file-check-client.mjs).
The [signed-in browser walkthrough](../scripts/issued-file-check-ui-check.mjs)
uses isolated fictional local D1/R2 and blocks other network origins.

Verification of the final source is pending. Preliminary focused tests and two
signed-in walkthroughs passed before integration; those results alone do not
prove the updated combined source. The final command results and browser root
will be recorded here before publication.

Our draft PR stack was rebased onto main `6b21274`, including the other
contributor's readability, screen-lifecycle and G7 changes. Archive selection
remounting, scoped catalog results, obsolete-read disposal and rendered readiness
were preserved while adding review/check controls. Only our branches changed;
main and the gate's runtime were not merged or altered. The original pre-rebase
commits/evidence remain available through local backup branches.

G6 passed its functional steps but failed preservation after a preview advanced
the protected cart-review schema; [G7 rebinding](C4_FULL_OFFLINE_GATE_RUN_20261027.md#rebinding-for-g7)
is merged. G7 preparation/run status remains an operator dependency. Keep this
stack draft and out of main during the documented preparation-to-paid-run freeze.
This feature's local checks do not substitute for that operational gate.

## Handoff, rollback and next slice

C4/C5/M8 remain open; hosted release and purchasing remain paused. No hosted
privacy, supplier, real-model, pilot or production acceptance is claimed.
Formal replacement authority (owner only versus owner/manager) remains an
unanswered product choice and does not block this existing read permission.

Rollback reverts this feature's source/UI commit; retain append-only observations
and receipts. Receipt kinds use existing observation shapes, so older readers
still parse them, but without the new filter an old reader can display redundant
receipt entries or misorder late receipts. Prefer keeping the projection filter
when disabling the control; never delete audit rows to roll back.

Next unblocked document slice: separately scope server-assisted continuation of
an interrupted save for its original actor, using the exact retained command.
Replacement lineage/authority and inspection of prepared unissued objects remain
separate. Hosted release refresh and G7/paid execution need their own authorization.
