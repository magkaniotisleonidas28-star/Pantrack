# Screen-update review — 2026-10-27

Status: Completed locally. Workstream: C2 maintainability / screen lifecycle correctness.
Base: integration `6dca570`, containing main `5f9df85`.
Branch: `workstream-c/screen-update-lints-20261027`.

## Task contract

Review and resolve the 70 React screen-update findings (37 errors/33 warnings)
without changing UI styling, server authorization, API contracts, schemas,
purchasing gates or uncertain-save operation identities. Preserve unsaved inputs,
company/source isolation, cancellation and independent download/retry checks.
Each group is reviewed and verified before advancing. No rule-wide suppression,
live integration, deployment, paid inference, purchase, historical process/profile
operation, maintenance/full-gate run or publication is included.

## Sequential checklist

- [x] 1. Baseline/inventory and regression harness: reproduce relevant lifecycle
  defects using fake responses; retain the original report.
- [x] 2. Initialization, immutability and rendered retry state: lazy clocks,
  non-mutating data derivation, visible retry state, declaration ordering.
- [x] 3. Shell/company/theme and simple resource panels: correct initial loads,
  callback dependencies, unmount/identity response guards and persisted theme.
- [x] 4. Inventory, waste, sales and register: data/source refresh, recoverable
  entries, storage boundaries and event-driven updates.
- [x] 5. Purchasing, delivery, archive and weekly screens: protect unsaved
  forms, cancel stale reads, preserve same-operation retry and source checks.
- [x] 6. Polling and remaining dependency review: cart/job transitions,
  payment return flow, initial-load and active-screen refresh semantics.
- [x] 7. Frozen final verification: targeted rules at zero, affected/full suites,
  typecheck, database/build/local HTTP, diff review, inventory/handoff updates.

## Baseline

The five rules are `react-hooks/set-state-in-effect`, `exhaustive-deps`, `purity`,
`refs`, and `immutability`. The original machine-readable report is retained at
`.sites-runtime/screen-updates-20261027/lint-baseline.json` in this task worktree.
Dependencies are a local copy-on-write clone of the existing pinned installation;
no package installation or upgrade is included.

## Review and verification records

Group 1: the portable lifecycle-rule regression fails with the original 70
findings. A real React StrictMode/browser regression also fails: reverse-order
member-list responses replace the second company's screen with the first.
Both original failures are retained in this worktree's ignored task evidence.

Group 2: lazy initial clocks and a cleaned-up clock subscription remove render-
time reads; expiry/lease labels now update without requiring another user action.
The inventory section uses a local derived value instead of reassigning an input.
The receiving reason state is declared before its loader. These two declaration
findings were conservative compiler checks, not demonstrated runtime failures.
Rendered retry eligibility now uses React state while the same immutable pending
body remains the mutation identity. Server-time calibration still precedes menu
waste submission; its unused initial placeholder no longer reads wall time.

All four purity, four ref and two immutability findings are resolved. The isolated
actual-React clock and weekly exact-retry scenarios pass, as do six affected
existing suites and typecheck. Markup/classes, API paths, operation identities and
server behavior are retained. The remaining 60 effect/dependency findings are
reviewed in subsequent groups. Local fake-provider evidence is not live acceptance.


Group 3: scoped request generations reject obsolete results after identity changes,
newer reads and unmount/StrictMode replay. Stable promise loaders publish only
from their current read; user-triggered loading indicators remain explicit.
Company/member/operations/automation and workspace loads use this ownership.
The original reversed-company browser failure now passes. Theme hydration uses
an external browser-store snapshot and retains toggling when storage writes fail.
Workspace inventory mode normalization happens with its triggering action; dock
visibility is released with its observer and is only shown on the order page.
URL callback tabs retain a server-compatible hydration snapshot.

All group-3 findings are gone; 47 findings remain elsewhere. Typecheck, five
affected focused suites, the request-scope lifecycle suite and real React
StrictMode member/theme hydration/blocked-storage checks pass. The portable
request-scope test covers reversed success, unmount, replay and obsolete errors.


Group 4: inventory/register reads use stable scoped callbacks. Prop-driven refresh
loading is derived from the requested revision, while explicit user reloads keep
their loading indicators. Waste editors restore preferences and pending saves
once per company/user editor, after a server-compatible browser-ready boundary.
Recovery validation is independent of corrupt/unavailable preferences. The same
operation/body and visible fields survive recovery; changing the actor/company
remounts the editor. Requests and sold-item lookups reject stale completions.
Launch/section resets adjust their owning component state only when that input
changes, rather than resetting it in an effect after painting.

Five focused suites, typecheck, portable recovery/calibrated-time cases and both
actual React menu/ingredient recovery-and-exact-retry scenarios pass. The shared
timestamp calculation retains the previous server calibration formula and is
called only by new-entry submit handlers. Two additional purity reports exposed
by removing earlier compiler failures are resolved with that explicit helper;
no lint suppression was added. Group-4 rules are clear; 31 findings remain in
purchasing/delivery/archive/polling screens.


Group 5: supplier/profile, mapping, draft/history and receiving reads have complete
stable dependencies and current-source ownership. Metadata is cleared only when
its product/source changes. Background weekly reads stop publishing once a form
is open or a save is pending. Delivery line resets follow confirmation identity;
equivalent parent data retains the typed count. Archive source changes remount
and dispose their client, while catalog readiness is rendered from state rather
than a mutable ref. Unsaved supplier baselines also use state. Exact-save retry
bodies, read integrity checks and authorization remain unchanged.

Seven focused purchasing/receiving/archive/schedule suites and typecheck pass.
Actual React StrictMode checks prove typed delivery values survive equivalent
parent data, another confirmation resets its count, and obsolete archive reads
are aborted and cannot replace the new source with an error. Eight findings
remain in the final polling/dependency group. These are local fake-response
checks, not provider or operational-gate evidence.


Group 6: polling depends on stable job identities and derived activity flags;
owned timers still stop on terminal states. Durable intent recovery happens once
per actor/company/order after the browser boundary, and the original stored
operation remains the retry identity. Complete callbacks and scoped status reads
replace missing dependencies. Spending-limit refreshes stop publishing while an
edit, confirmation or uncertain save is active. Payment callback verification and
URL cleanup retain their company/session binding. Cart source changes reset only
the owning source component.

All five targeted rules now have zero findings. Seven focused suites and typecheck
pass. Actual React spending-limit edit protection, reversed payment reads,
payment-return verification/URL cleanup and exact uncertain cart recovery pass.
The final run also checks that active carts poll and canceled carts release the
timer. Final project-wide results are recorded below after the frozen run.


## Retained failures and verification limits

The original `initial-rules-failure.log` and `members-race-before.log` retain the
failing-before evidence. The first frozen attempt found two missing manager-view
fields in the new polling fixture; the fixture was corrected without changing
application behavior. Its log is `attempt1-final-typecheck.log`.

A later full run stopped at the unchanged `tests/menu-waste.mjs:156` privacy
assertion (`attempt2-final-test.log`). This assertion searches all serialized
values for `99999`, including valid configuration UUIDs. An isolated diagnostic
copy with valid deterministic UUIDs containing that sequence reproduces the same
failure with no price/supplier/on-hand fields in the response
(`menu-privacy-probe.log`). The original failed response was not retained, so its
specific cause cannot be proved; UUID collision is a supported explanation. The
unchanged focused suite and subsequent full suite pass. The inherited test is
left unchanged; a separate follow-up should check explicit forbidden fields and
values without rejecting otherwise valid identifiers.

All seven pipeline checks also passed before a final compiler-guarded formatting
normalization of `waste-recorder.tsx` (`preformat-results.json`). The full final
pipeline is repeated against the newly frozen final source. Earlier logs and
source inventories remain retained. Full lint still fails on unrelated inherited
rules; the five targeted rules have zero findings. No rule suppression or
existing test assertion was removed/weakened.

Real React development StrictMode checks use an explicitly launched disposable
headless browser, inline HTML, fake fetch, denied network routes and fresh owned
contexts. The browser is closed in `finally`. No app server/provider endpoint,
existing browser/profile, historical worker lock/evidence or maintenance CLI is
used. These fourteen scenarios are local component evidence; they are not a full
visual, accessibility, provider or pilot acceptance review. The portable default
suite includes request ownership, recovery and the five-rule regression; the
browser scenarios require a separately available local Playwright browser.


## Final verification and handoff

All six sequential review groups and the final review are complete locally.
The frozen inventory covers 977 files plus the three declared mutable outcome
records, for 980 tracked files. Source was staged before checks and retained
identical bytes/inventory through the final checks. Canonical frozen-map SHA-256:
`434c350bec9066b4934a354a0076fabdc115830df7a8f2371158c03a75a90446`.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm typecheck` | 0 | Final source and component fixtures typecheck. |
| `pnpm test` | 0 | All 161 suites executed on this Mac; no platform skips. |
| `pnpm db:check` | 0 | All 45 ordered migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | 0 | Final Worker/client build passes. |
| `pnpm local:setup` | 0 | Fictional variables confined to this worktree. |
| `pnpm db:migrate:local` | 0 | Worktree-local state is current; 45 migrations applied in the earlier fresh run. |
| `pnpm test:local` | 0 | Local home, anonymous/forged-header rejection, sign-in, company/catalog, tenant isolation and sign-out pass. |
| `node tests/browser/screen-updates.mjs` | 0 | All 14 real React StrictMode scenarios pass with fake responses/denied network. |
| `pnpm lint` | 1 | 53 errors/59 warnings remain; all five targeted rules are zero. |
| `pnpm exec eslint . --ignore-pattern dist --ignore-pattern .next --format json` | 1 | Machine-readable counterpart of the full lint result. |
| `python3 .sites-runtime/screen-updates-20261027/compare-lint.py` | 0 | Remaining 112 diagnostics match the inherited baseline by file/severity/rule/message (stylish's terminal punctuation normalized). |
| `python3 .sites-runtime/screen-updates-20261027/check-format.py` | 0 | All 19 supported S01–S13/S15–S20 format selections pass. |
| `node .sites-runtime/screen-updates-20261027/review-ui.mjs` | 0 | Static JSX text and styling attributes match the base in all 22 changed TSX components. |
| `python3 .sites-runtime/screen-updates-20261027/check-links.py` | 0 | All changed-document relative links resolve. |
| `git diff --cached --check` | 0 | No whitespace errors. |

Focused commands all exited 0 before advancing their group:

- `pnpm test inventory-sales menu-waste m2-security sales-recovery-runtime po-draft-schedules po-cart-over-cap-approval` — 6 suites.
- `pnpm test m2-security local-auth spending-limits-screen purchasing-safety screen-request-scope` — 5 suites.
- `pnpm test screen-waste-recovery waste-recording menu-waste inventory-sales register-bridge` — 5 suites.
- `pnpm test purchasing-suppliers purchasing-suppliers-api po-cart-deliveries po-cart-deliveries-api document-archive-client po-draft-schedules po-draft-schedules-api` — 7 suites.
- `pnpm test screen-update-rules po-cart-manager-client spending-limits-screen po-cart-spending-limits-api clover-connection m2-security local-auth` — 7 suites.

The 14 browser cases cover a ticking clock, exact weekly retry, reversed company
responses, stored-theme hydration, denied storage, both waste recovery/retry
paths, delivery input retention/reset, archive cancellation/source binding,
spending-limit edit protection, reversed payment reads, payment callback binding,
exact durable-cart recovery and active/terminal polling disposal.

Changes are limited to the 23 workspace lifecycle modules, five new focused
hooks/helpers, the existing calibrated-time helper module, five new test/fixture
files and four progress/inventory documents. The manifest lists exact paths and
per-file follow-up hashes, while retaining prior cleanup/hold evidence. The
full diff was reviewed for scope, static UI, tenant boundaries, external effects
and completion claims. No existing test assertions are changed. No API route,
server authorization, business service, dependency, schema, migration, CSS,
workflow, gate binding or deployed configuration changes. Earlier formatting
holds stay open; this task does not certify a complete visual review.

Raw receipts and retained failures live only under this task worktree's ignored
`.sites-runtime/screen-updates-20261027/`. Commands/durations/log hashes and source
hashes are recorded in the manifest's `screenUpdateTask`. The owner's main
checkout remains clean at `5f9df85`; the integration and original cleanup
checkouts are preserved. No push, PR or merge into main occurred. No Windows/
Ubuntu CI, live integration, pilot, purchase or operational gate was run.
C4/M8 and A8/M7 remain open.

Compatibility: UI styling/text, API/security/schema contracts and exact pending
operations remain intact; async publication and subscription/recovery ownership
are the scoped behavior fixes. Rollback reverts only this branch's source/tests/
documentation commits in reverse order. There is no migration rollback or remote
state to repair; local HTTP smoke leaves fictional data only in this worktree.

Next unblocked review: the remaining lint groups (type precision, unused code,
text/navigation and declaration rules) need separate scoped fixes. The inherited
menu-waste substring assertion and earlier JSX/visual/source-pin formatting holds
are recorded follow-ups. Publication/merge and remote CI are separate actions.


Scoped source commits (the final regression/verification record is a separate
commit on the same local branch):

- `20c2dcd` — fix(ui): own screen reads and recover pending browser drafts.
- `d73715d` — fix(ui): preserve purchasing edits and dispose obsolete archive reads.
- `0f44a63` — fix(ui): stabilize cart polling and protect payment and limit refreshes.
