# C4 fresh disposable shutdown matrix — 2026-10-15

## Contract and boundaries

This bounded C4 task follows the [source-only observation repair](C4_SHUTDOWN_OBSERVATION_REPAIR_20261015.md).
Its reviewable outcome is one fresh twelve-case Chrome shutdown experiment with
independent observation, process, signal-boundary and preservation audits.

The [new entrypoint](../scripts/po-cart-shutdown-observation-matrix-check.mjs)
accepts no arguments, root override, filter or resume. Its fixed private root is
`.sites-runtime/po-cart-workers/shutdown-observation-matrix-task-20261015/`,
with policy `isolated-shutdown-observation-matrix-20261015`. Exclusive report
creation refuses concurrent/repeated attempts. The invocation record is created
exclusively and synchronized before any fixture browser launches.

The [independent adapter](../scripts/po-cart-worker/shutdown-observation-matrix-audit.py)
binds the existing Python auditor to this new root and independently verifies
the invocation policy, cases, source and historical reference. Preparation
evidence uses distinct filenames from invocation-time exclusive audit writes.
Partial cases and interruptions still reach final auditing; primary diagnostic
failures retain case/observation references separately from audit failures.

The existing observer, matrix, signal authorization, disposal code, original
entrypoint and consumed policies are unchanged. Each new profile runs the pinned
Chrome executable with inline fixture pages, minimal environment and deny-all
proxy. Cases run sequentially: SIGTERM then protocol close, each at 0/10/50 ms
first-observation delay, with two repetitions. Existing startup, stable-population,
five-second shutdown observation and bounded disposal limits apply.

The first incomplete case or unexpected condition stops the matrix. No repair,
retry, replacement case or browser restart is allowed. PID 4303 and all historical
PIDs are forbidden signal targets. No historical profile is opened or adopted.
No historical cleanup, lock archive, idle baseline, acceptance gate, paid model,
supplier access, purchasing, deployment or power-setting change is included.
There are no public API, schema or migration changes.

## Preparation and result

The fresh-wrapper suite and five existing focused suites passed. The approved
preparation passed on unchanged source:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **101 suites** |
| `pnpm build` | Passed |

The frozen snapshot contains **570 source files**, SHA-256
`27dd584ba0c7f6d7b3043cac55fc595f2765dc9e9d62786cbb3e1f8ea278f968`.
Database checks, local migrations and HTTP application smoke were not run:
this task changes no schema or application workflow. No full six-command
pipeline claim is made. The wrapper tests use isolated temporary roots and
synthetic dependencies; they need no private runtime evidence, browser or signals.

Before editing, preservation captured 17,344 historical evidence files, 494 carts,
six database row snapshots and 46 worker locks. Fresh process checks found nine
historical processes rooted at 30474 and one live singleton lock; PID 4303 was
absent. Historical profile fingerprints record concurrent changes only within
profiles already active at the initial snapshot. This is not an idle baseline.

Only twelve completed cases with passing independent audits qualify for a result:
at least two matching cases means **reproduced**, one means **observed once**, and
zero means **not reproduced within this matrix**. Incomplete or failed auditing
means **blocked**. The classification concerns the recorded diagnostic signature,
not the historical shutdown/timeout cause.

The single real invocation ran from **2026-10-16 00:09:05Z to 00:10:15Z**
(October 15 locally). It is **blocked and permanently consumed**: eight cases
attempted, seven completed and four unstarted.

| Case | Completed | Matching signature |
| --- | --- | --- |
| `SIGTERM-0-1` | Yes | Yes |
| `SIGTERM-0-2` | Yes | Yes |
| `SIGTERM-10-1` | Yes | Yes |
| `SIGTERM-10-2` | Yes | No |
| `SIGTERM-50-1` | Yes | No |
| `SIGTERM-50-2` | Yes | No |
| `protocol-0-1` | Yes | Yes |
| `protocol-0-2` | No | Not classified |

The eighth case stopped with **`fixture_baseline_unverified`**, retained at
`cases/protocol-0-2/result.json`. It never recorded a stable baseline or diagnostic
observation and never received its planned shutdown action. The current startup
checks do not retain the rejected process population/metadata, so this evidence
does not distinguish which baseline condition failed. No cause is established.
No repair, retry, replacement case or restart followed.

Four completed cases independently contain the signature, but a partial matrix
cannot receive the complete-matrix **reproduced** classification. The repaired
observer completed real shutdown observations in the first seven cases; this
does not turn the older consumed diagnostic into a pass.

## Independent final audits

All independent checks passed, with **zero audit failures**. The final matrix
status remains blocked because case eight is incomplete. Invocation binding
independently matches the new policy, fixed twelve cases, frozen source and
historical reference. The precise primary failure is preserved separately from
audit failures in `report.json` and `verification-summary.json`.

All eight fixture leaders and their observed members are absent; child exits
were observed and all eight deny proxies closed. Six planned individual SIGTERM
actions targeted only verified fixture leaders. One completed protocol case used
its owned CDP session. Disposal of every fixture was verified, including the
incomplete eighth case, with **no additional cleanup signals**. The proxies
recorded **112 denied requests**; no supplier page, model or purchasing action ran.

Final preservation retained all **17,344 evidence files**, **494 carts**,
**37,368 business rows** across six databases, prior consumed records and budgets.
There were zero business or bookkeeping changes/additions and zero ordinary
smoke additions. Reserved exposure remains **$0.921518**. All **46 worker locks**
retain original bytes and metadata, the nine historical process identities and
one live lock reference are unchanged, and PID 4303 remains absent and untouched.

The complete historical fingerprint recorded six concurrent changes, all within
the profile already active before execution. No inactive historical profile
changed. Preflight remains `historical_profiles_active`; no strict stability or
idle-baseline claim is made. The historical seventeen-file failed audit and both
consumed maintenance attempts retain their original failed/partial evidence.

## Handoff and rollback

**C4/M8 remain open.** The original seventeen-file failure, both consumed
maintenance attempts and the consumed earlier diagnosis must remain unchanged.
The next unblocked step is separately scoped read-only review of the retained
startup refusal and source checks, followed, if necessary, by source-only startup
evidence capture and offline regression work. Missing rejected-startup evidence
must not be supplied retrospectively or used to justify another execution.
Remaining historical browser disposition and a complete offline gate still
require separately scoped work; this result grants neither.

Rollback restores only this task's source/documentation. It must not reopen
browsers, delete retained profiles, restore an archived lock, remove consumption
records or reset this invocation. Private before-images, inherited-work snapshots,
source hashes, logs and audits live under the fixed task root.
