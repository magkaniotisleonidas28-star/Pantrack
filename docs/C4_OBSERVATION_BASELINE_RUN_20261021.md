# C4 observation-baseline run — 2026-10-21

This is Task 2 of the [single-instance maintenance plan](C4_SINGLE_INSTANCE_MAINTENANCE_PLAN_20261021.md).
It is the one separately authorized invocation of the [signal-free observation
baseline](C4_OBSERVATION_BASELINE_SOURCE_20261021.md). **Result: PASS. A fresh
baseline is published. C4/M8 remain open; historical causes remain unresolved.**

No process was signaled. There was no guard acquisition, lock archival,
browser launch, application, API, schema, migration, supplier, paid-model,
purchasing, deployment or power-setting change. The run used `caffeinate -i` only
to prevent idle sleep. Private evidence is retained at
`.sites-runtime/po-cart-workers/observation-baseline-task-20261021/`.

## Preparation history

The first two preparations were never invoked. Each was moved aside unchanged
after it exposed a defect in the auditor's preservation scope; neither created
`report.json`, so no invocation was consumed. The two corrections are recorded
in the [source report](C4_OBSERVATION_BASELINE_SOURCE_20261021.md#database-inventory-correction).

| Preparation | Outcome | Retained at |
| --- | --- | --- |
| 1 | Pipeline passed; capture showed the database inventory missed `cart-review-state` | `observation-baseline-superseded-preparation-20261021/` |
| 2 | Pipeline passed; capture could not open five sidecar-less WAL copies | `observation-baseline-superseded-preparation-2-20261021/` |
| 3 | Pipeline and capture passed; invoked once | the fixed root |

The third preparation ran `typecheck`, `test` (**109 suites**) and `build` on the
frozen source: **594 files**, SHA-256 `bc94678e…6006b3c69`, from commit `102fc2b`.
The source was unchanged before and after each command. Before-images were then
captured:

- 24,564 protected evidence files;
- 494 carts;
- 118 databases, 46,678 business rows;
- the source list and an empty rollback manifest.

A read-only dry run of the full preservation audit passed against those images,
with zero database delta and reserved exposure `$0.921518`. Process, lock,
singleton and idle checks were repeated immediately before invoking.

## Result

`node scripts/po-cart-observation-baseline.mjs` ran once and printed `PASS`.
`report.json` is `complete`, with no failure, no audit failures and
`signalsSent: 0`.

| Group | Collected and independently verified |
| --- | --- |
| Processes | Bracketed reads (637 and 630 rows): all 27 historical PIDs, PID 4303, historical groups/descendants and any historical-profile reference absent |
| Preflight | `idle`, 1,434 profiles, before collection and before, between and after the stability fingerprints |
| Worker locks | All 46 exact, including integer-nanosecond mtimes and the PID-4303 stale lock bytes; no guards; zero archived |
| Singleton | The original 30474 reference is retained untouched |
| Stability | Two equal complete fingerprints of 353,361 entries, 6.83 s apart, SHA-256 `8ee75de7…2787c448` |
| Drift since 2026-10-16 | Eleven entries, all inside `803d991d…`; no inactive profile changed |
| Preservation | 24,564 evidence files, 494 carts and 46,678 business rows unchanged; zero additions or bookkeeping changes; reserved exposure `$0.921518`; no new consumption records; the seventeen-file failure stays failed |
| Final groups | Processes, locks, singleton, preservation and frozen source repeated and passed |

The independent audit published `fresh-baseline.json`. It binds the policy,
source and profile fingerprint. It is valid together with `report.json` status
`complete` and the passing `verification-summary.json`.

## Meaning and limits

This is collected local evidence that the historical browser population is gone
and that profiles are idle and stable. It also shows that locks and business
state are preserved. It does not establish why the 30474 instance exited at about
11:01 on 2026-10-21, or the earlier timeout, startup-refusal or seventeen-file
causes.

The baseline unblocks consideration of a separately scoped fresh full offline
acceptance gate. It does not close C4/M8 or authorize supplier access, paid
inference or a purchase. The invocation is consumed; a second run would need a
new fixed root and policy.

Committing this report and the status documents changes only `docs/`, which the
frozen-source snapshot excludes, so the baseline's source binding stays valid.
Rollback removes this report and restores the status/roadmap paragraphs. The
fixed root, both set-aside preparations and all runtime state remain retained.
