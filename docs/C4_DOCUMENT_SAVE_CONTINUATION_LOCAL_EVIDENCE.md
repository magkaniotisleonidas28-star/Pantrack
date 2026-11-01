# C4 original-request document-save continuation — local evidence

Recorded: 2026-11-01. Workstream/checklist: C4. One reviewable outcome: a current
owner/manager can recover the exact document-save request they originally started
from the server, then continue it through the existing guarded save lifecycle.
This implements the next slice in the [recovery policy](C4_DOCUMENT_RECOVERY_POLICY_20261101.md).
It remains confined to the existing local archive-preview gate.

## Behavior and safety contract

Review offers **Continue original save** only for an unissued save belonging to
the current viewer. An active save remains visibly waiting and its control is
disabled. Other current owners/managers can still review the recorded outcome,
but cannot take over the original actor's request. Employee, anonymous and
wrong-company requests fail on the server.

The new GET view, `view=continuation`, retrieves only the original strict command,
document ID and viewer ID. Its [D1 reader](../src/lib/d1-document-archive-continuation.ts)
checks company, current membership, original actor, exact source scope, operation,
template and request fingerprint. It repeats the guarded read after parsing and
digest work, and the route checks session identity again before returning data.
Issued requests are refused here; their copies remain available in Saved copies.
The lookup performs no R2 calls, lease claims, rendering or writes.

The [existing browser client](../src/lib/purchase-order-archive-client.ts) persists
the returned command and expected document ID before dispatch. It sends that
unchanged command through the existing CSRF-protected POST. It never creates an
operation ID or captures a fresh history snapshot for continuation. History
retains its original criteria/fingerprint even if the current screen filters
have changed. A different pending request in the parent's existing storage slot
blocks continuation and ordinary new saves. Stop, lost replies and reloads retain
the same command; retry needs no new lookup or identity.

The POST keeps the existing journal's actor, membership, lease, source and
publication guards. A prepared manifest can only read/check its existing object;
it cannot render or put again. An expired save without a manifest may generate
once under the original identity only while its original source still matches.
Concurrent attempts remain fenced. Missing, corrupt, unavailable, edited or
canceled-source outcomes stay held, with observations retained before refusal.
Before displaying success, continuation verifies the exact returned document ID
and rechecks current authorized metadata. No automatic download occurs.

## Files, contracts and data effects

- [Continuation DTOs](../src/lib/document-archive-continuation-contract.ts) define
  the strict read query/result and a browser-only versioned recovery envelope.
  The server's save command and operation fingerprint are unchanged.
- [The archive route](../src/app/api/purchase-order-documents/route.ts) adds the
  guarded read view before the bucket requirement. A lookup therefore also works
  when R2 is unavailable. Existing save/download routes keep their contracts.
- [Review projection](../src/lib/d1-document-archive-review.ts) supplies an optional
  `canContinue` detail capability. [The review DTO](../src/lib/document-archive-review-contract.ts)
  accepts older responses without it. It conveys no original actor ID or token.
- [Review controls](../src/components/workspace/document-archive-review.tsx) use
  [the existing archive workspace](../src/components/workspace/purchase-order-archives.tsx)
  and its one pending client. A successful save closes review and refreshes the
  catalog; an uncertain save keeps its existing Retry this save control.

No new schema, migration, dependency or hosted configuration is added. Lookup
preserves every application and archive row. Continuing may change existing
archive intents/leases/observations and create an object only if preparation had
not completed. Business rows, approvals, inventory, spending, supplier state and
already-prepared object bytes are preserved. Only fictional local test databases
are exercised. Root/hosted databases, providers, suppliers and purchasing remain
untouched; C4/C5/M8 stay open.

## Verification

Evidence root (absolute, outside the worktree):
`C:/Users/Leo/Project/Pantrack/.sites-runtime/c4-save-continuation-20261101`.

Baseline archive/review client suites passed before editing. Focused client,
native D1/R2 API, type and screen-rule checks passed during implementation.
All six commands passed on staged Git tree
`fe35c6af856d7e8dd40fda8273325c41b199e1ea`, based on `b26ca678` and main
`5ffc088`. Intended additions were staged before checking. Disk and Git's source
inventory remained unchanged until the pipeline ended; only documentation was
completed afterward. `frozen-source.json` and `checks.json` retain provenance.

| Command | Result / evidence under the evidence root |
| --- | --- |
| `pnpm typecheck` | Passed; `pipeline-1.log`. |
| `pnpm test` | Passed in one full invocation: 165 selected suites, 153 executed and 12 existing Windows POSIX skips; `pipeline-2.log`. |
| `pnpm db:check` | Passed; all 45 ordered migrations match the schema and apply fresh; `pipeline-3.log`. |
| `pnpm build` | Passed; `pipeline-4.log`. |
| `pnpm db:migrate:local` | Passed; all 45 existing migrations applied only to the isolated worktree database; `pipeline-5.log`. |
| `pnpm test:local` | Passed; sign-in, authorization/company isolation, archive/continuation default-off guards and sign-out; `pipeline-6.log`. |

The previous task's two local worker-suite failures did not recur in this full
run. This does not establish their original cause or claim a journal repair.
The focused four-suite run, both baseline suites, typecheck and workspace screen
rules also passed. Whitespace and all changed relative links/section targets are
verified again after completing this record; acceptance checkboxes stay unchanged.
Clean-machine CI is pending at publication and remains required before integration.

The [native API cases](../tests/helpers/document-archive-continuation.mjs), invoked
through [the actual route harness](../tests/document-archive-api.mjs), cover both
formats and sources, original versus different actors, current roles/CSRF,
source/query binding, read-only lookup without R2, active/expired lease races,
prepared write-ack recovery without another put, lost HTTP reply and real client
restart, role/session loss between actual SQL boundaries, final metadata refusal,
missing/damaged/unavailable files, and edited/canceled-source byte preservation.

[Client lifecycle checks](../tests/document-archive-continuation-client.mjs) use
actual Response/ReadableStream objects and injected fetch/storage. They prove
document/request/viewer binding, persistence before POST, no new UUID/snapshot,
storage failure/conflicts, current pending-slot ownership, final access refusal,
late response disposal and preservation of canceled POST recovery.

The [signed-in walkthrough](../scripts/document-save-continuation-ui-check.mjs)
passed in installed headless Edge. Reservations were seeded through the production
journal over the isolated preview's actual SQLite database; browser continuation
then used actual Worker D1/R2/GET/POST and download endpoints. This does not claim
an HTTP-originated crash fixture or hosted evidence. Its four issued copies keep
their original IDs and exact downloaded hashes. It verifies other-actor/active
refusal, PDF/Excel, lost reply/reload, stop/retry, a different save blocked by the
pending slot, role loss after lookup, unchanged business rows, no page errors,
desktop/390px layout and keyboard focus. Both screenshots were inspected.

Browser root:
`C:/Users/Leo/Project/Pantrack/work/c4-save-continuation-20261101/.sites-runtime/continuation-browser/run-28c92ef5-2ba9-4a2a-bb31-99cee24bca37`.
The owned browser and preview have been closed. No shared runtime was stopped.

## Integration, rollback and next slice

This branch follows draft PR #32. The predecessor stack was rebased onto main
`5ffc088`, including the other contributor's [G8 rebinding](C4_FULL_OFFLINE_GATE_RUN_20261031.md).
That source change touches its paid-build/gate lane; our feature changes none of
those files. G7 passed all functional steps/audits, and the first paid attempt
stopped before any provider request. G8 preparation/run status is an operator
dependency. Keep drafts out of main during the preparation-to-paid-run freeze.
No gate, paid run, hosted action or new execution authorization follows here.

Rollback removes this UI/read view and restores its client together. Existing
archive records/objects remain retained. Older clients safely refuse the new
browser recovery envelope; do not delete or reinterpret an uncertain request to
enable a new save. Re-enable the matching client or recover it through the server
after the exact guards pass. The POST command and journal schema need no rollback.

Next unblocked document slice: separately scope read-only inspection of prepared
but unissued evidence. Formal linked replacements still need the pending
owner-only versus owner/manager authority choice and their lineage contract.
Continuation does not authorize either action or a hosted release.
