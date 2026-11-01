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

Frozen combined source: `820e1d32f4d89fa809b8e25b142605f70abf740d`, Git tree
`2cdbd1f946dee23ab131714afe2a3633057831f7`. Intended additions were committed
before checking; the source/index stayed unchanged throughout. Only documentation
was completed afterward. `frozen-source.json` and `checks.json` retain provenance.

| Command | Current-worktree result and evidence |
| --- | --- |
| `pnpm typecheck` | Passed; `pipeline-1.log`. |
| `pnpm test` | Failed twice; `pipeline-2.log` and `pipeline-2-repeat.log`. See the caveat below. |
| `pnpm db:check` | Passed; all 45 ordered migrations match the schema and apply fresh; `pipeline-3.log`. |
| `pnpm build` | Passed; `pipeline-4.log`. |
| `pnpm db:migrate:local` | Passed; all 45 existing migrations applied only to this worktree's isolated database; `pipeline-5.log`. |
| `pnpm test:local` | Passed; sign-in, tenant isolation, ordinary default-off guards including the new POST, and sign-out; `pipeline-6.log`. |

**Full-suite caveat:** the first run stopped at `po-cart-worker-processes` when
neither competing worker exited successfully. Its exact cause is unknown.
The repeat stopped at `po-cart-human-browser-client` with Windows `EPERM` while
atomically renaming a temporary journal over its previous file. Both existing
suites passed standalone on unchanged source (`worker-process-recheck.log` and
`human-client-recheck.log`). Do not infer the first failure's cause from the second,
or claim an underlying worker/file-lock defect was fixed. No worker/journal
implementation was changed to force a pass.

The continuation ran the 51 suites after the first stop successfully
(`remaining-suites.log`). `aggregate-tests.json` maps every suite to its completed
run: **163 selected, 151 passed across recorded runs, 12 Windows POSIX skips**.
This is aggregate completion evidence, **not a successful full `pnpm test`
invocation**. Clean-machine Windows/Linux CI remains pending and is required
before integration. Native new-feature route/client/resource cases passed in
both the focused work and the frozen-source runs before those unrelated stops.

The integrated signed-in browser walkthrough passed at
`C:/Users/Leo/Project/Pantrack/work/c4-issued-file-check-20261101/.sites-runtime/issued-check-browser/run-8f7ab8ac-b14f-4894-8c2c-bc20ec01071e`.
It created seven durable check receipts and proved new versus replay identity,
lost HTTP reply/reopen, stop/retry, PDF/Excel checks, final role-loss refusal,
journal-only Refresh, later edit/cancellation, unchanged business/archive rows,
no page errors, keyboard access and desktop/390px layout without overflow.
Both screenshots were inspected. The owned browser and preview were closed;
port 5179 was confirmed free. `final-browser-result.json` retains its result.

The actual React archive-switch regression also passed using installed headless
Edge (`archive-switch-edge.log`), preserving main's obsolete-request protections.
The unmodified generic browser script first requested an unavailable downloaded
Chromium; an external launcher selected Edge without changing project source.
An initial app walkthrough started before Vite was ready and refused the local
connection; the recorded passing attempt followed its readiness message.

During integration, screen rules caught three effect dependencies/cleanup
findings. Selection-bound remounting and owned cancellation corrected them;
the focused rule/recovery rerun and final 51-suite continuation passed. Locked
offline installation lacked registry policy metadata; normal frozen-lockfile
installation passed. All preliminary failures remain in the evidence root.
Whitespace, relative links, section targets and unchanged A/B/C acceptance
checkboxes are checked again with the completed documentation before publishing.

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
