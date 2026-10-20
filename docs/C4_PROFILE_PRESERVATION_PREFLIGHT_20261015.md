# C4 historical-profile preservation preflight

Date: 2026-10-15. Workstream **C4**, one source-only safety improvement.
**Implemented and locally verified. Fresh browser acceptance remains blocked.**

## Plan and completion contract

The [display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md) passed
all twelve delayed jobs but failed strict artifact preservation: seventeen
cache/QuotaManager files changed in older profiles with unowned Chrome processes.
Its case result remains **not reproduced with display on; cause unresolved**.
Those failed audit records must remain evidence.

The selected next step was to prevent another bounded investigation or full gate
from consuming its invocation while historical profiles are active or their state
cannot be inspected reliably:

1. Inventory historical profile processes and locks using read-only operations.
2. Put a fail-closed preflight before pipeline loading, durable consumption,
   preview setup and browser execution in the three relevant entry points.
3. Verify filesystem/process races, privacy, safe refusal and compatibility with
   non-browser regressions, then run the complete six-command local pipeline.
4. Record the live blocker and verify source-only evidence/business preservation.

Completion means the guard works, the current blocker is reported privately, and
existing reports, carts, holds, budgets and consumed records remain preserved.
This task does not adopt or terminate legacy processes, reclaim/delete locks,
restore profiles, replay jobs, run a new gate, change power settings, contact a
supplier, purchase, deploy or use paid inference. No external credential is
needed. Clearing unowned legacy resources remains a separate scoped action.

## Implemented behavior

The [preflight helper](../scripts/po-cart-worker/profile-preservation-preflight.mjs)
reads the canonical historical browser-profile directory and takes process
snapshots before and after inspecting profile metadata. Exact profile references,
helpers, zombies, orphaned processes, unknown references inside the root, and
locks pointing to any live PID block execution. A process observed in either
snapshot blocks even if it exits during inspection. PID reuse retains both
observations; a live PID is not adopted as a cleanup target.

Missing process evidence, malformed locks, noncanonical/symlinked directories,
unknown directory entries or an interrupted reclamation guard fail closed.
Stale locks remain on disk and are counted separately. The helper does not expose
commands, lock targets, arbitrary paths or raw errors in reports. Private process
records contain only numeric IDs, identity hashes, known profile keys and fixed
classification fields.

The following entry points now call the guard after argument rejection and
before reading preparation evidence or creating an invocation:

- [Full offline gate](../scripts/po-cart-ai-gate.mjs).
- [Compatibility investigation](../scripts/po-cart-second-addition-check.mjs).
- [Display-on investigation](../scripts/po-cart-second-addition-display-on-check.mjs).

Their fixed roots, matrices, consumption rules and subsequent behavior remain.
The guard does not write to those historical roots when refusing execution.
Use `node scripts/po-cart-profile-preflight.mjs` for a standalone read-only check.
It accepts no options or cleanup actions, writes a fresh private UUID report,
returns zero for idle evidence, and returns one for blocked/unavailable evidence.
It creates no execution allowance or invocation record.

The final real-machine check returned the expected blocked result, observing
**27 profile processes and four live lock references**. This is successful
verification of refusal, not successful browser acceptance. Existing unowned
processes and profile files were left untouched.

This preflight is a point-in-time observation, not a global lock against other
applications. Run it before capturing a future strict baseline and again through
the guarded entry point. A successful preflight does not replace final artifact,
cart, database, credential or owned-resource audits. The historical seventeen
artifact exceptions are not excused, rewritten or reclassified as a pass.

## Local verification

The [new regression](../tests/po-cart-profile-preflight.mjs) exercises canonical
and space-containing paths, exact/sibling/unknown profile boundaries,
orphan/helper/zombie processes, live/stale locks, missing/unsafe evidence,
filesystem aliases and symlinks, snapshot races, PID reuse, private reports,
argument refusal and pre-consumption CLI ordering. It uses mocked process
snapshots and temporary files and sends no process signals or browser requests.

Seven focused suites passed: `po-cart-profile-preflight`,
`po-cart-display-on-investigation`, `po-cart-second-addition-compatibility`,
`po-cart-full-offline-gate`, `po-cart-preview-cleanup`, `po-cart-second-addition`
and `po-cart-second-addition-repair`. The final complete pipeline passed:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **96 suites** |
| `pnpm db:check` | Passed, 35 ordered migrations and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no pending local migrations |
| `pnpm test:local` | Passed, ordinary fictional loopback HTTP smoke |

Node 22.23.2 and pnpm 11.25.0 ran in this worktree. Final verification used
**552 source files**, SHA-256
`d5b5c787542b77bcd6dd121257d6a19377714ddcfc685f109d4a554c6c3e87e0`.
An earlier preparation stopped on a regression-fixture variable shadowing
Node's `process` object; its failed logs are retained. The fixture was corrected
before the seven-suite and complete successful reruns. No browser invocation
was attempted to verify the changed entry points.

## Evidence and preservation

Private evidence lives under
`.sites-runtime/po-cart-workers/profile-preflight-source-task-20261015/`:
source snapshots and inherited dirty diff/status, rollback manifest, historical
evidence/cart/database baselines, focused/preparation logs, actual preflight
inventory, read-only check, independent preservation audit and final handoff.
Files use 0600 and directories use 0700. Standalone reports live separately under
`.sites-runtime/po-cart-workers/profile-preservation-preflight/`.

This source-only baseline protects historical evidence and business state;
it makes no claim that live legacy Chrome cache files are frozen. Those profiles
explicitly block a future strict browser run. The retained display-on
`verification-summary.json` remains `passed: false` with seventeen artifact
exceptions, and its existing evidence references remain unchanged.

The independent source-only audit passed for **13,376 protected evidence files**,
all **494 historical carts** and **37,304 baseline business rows** across six
local databases. The preparation smoke added **16 ordinary fictional rows** and
changed one bookkeeping row state; zero served-cart rows, browser jobs or
invocations were added. Real reserved exposure remains **$0.921518**, and budget
fingerprints and consumed records are unchanged. Inherited source outside the
declared files is preserved. All milestone checkbox lines remain unchanged.

## Rollback, limits and next step

Use this task's `rollback-manifest.json`: restore only declared files from
`source-before/` and remove only declared new source files. Preserve all runtime
artifacts, credentials/events, consumed records, carts, reservations and holds.
Rollback does not close any process or restore browser caches. There is no
migration, public API or application authorization-contract change. Source
rollback invalidates this verification fingerprint.

The next C4 dependency is explicit review and disposition of the unowned legacy
profile processes and live lock references, followed by a fresh idle preflight
and baseline. A separately scoped fresh complete offline gate can then be
prepared on reviewed source. No gate or causal repair runs automatically;
screen-off causality remains unresolved, paid execution stays blocked, and
**C4/M8 remain open with all milestone checkboxes unchanged**.
