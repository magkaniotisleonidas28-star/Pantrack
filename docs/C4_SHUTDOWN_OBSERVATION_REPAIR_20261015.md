# C4 shutdown observation repair and offline replay — 2026-10-15

## Contract

This source-only C4 repair follows the [blocked isolated diagnosis](C4_SHUTDOWN_OBSERVATION_DIAGNOSIS_20261015.md).
Its reviewable outcome is diagnostic observation that can continue through the
retained real shutdown transition, while strict baseline and signal authorization
remain unchanged. The proof is offline replay, not a fresh real-browser result.

No browser is launched, signaled, closed or adopted by this task's diagnostic.
The consumed diagnostic and maintenance reports, invocation records and previous
failure statuses remain unchanged. No execution allowance, root override, resume,
lock archive, idle baseline, public API or schema change is added. **C4/M8 remain
open, and historical shutdown/timeout causes remain unestablished.**

## Behavior changed

The [diagnostic module](../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs)
now separates pure field analysis from collection and signal authorization.
The default `baseline` phase still requires matching identities, executable text,
profile references, topology and complete evidence. Only the explicit `shutdown`
phase records command/profile changes, changed or missing executable text and
zombies as findings while observation continues.

Changed start times, unexpected members, group changes and parent changes outside
the captured parent or permitted reparenting to PID 1 remain blockers. They receive
precise observation categories, without claiming PID reuse. Incomplete collection,
source changes, interruption, deadlines and write failures still stop execution.

The extracted polling loop uses the existing five-second deadline. It confirms
exit only when complete observations show every captured process absent. Missing
metadata or a zombie alone cannot establish exit. Its injected collection and
clock interface allows lifecycle replay without process control.

Signature detection uses per-PID fields independently of the unchanged verifier's
first reported PID. A matching helper must retain its recorded start time, change
command identity, lose its profile argument and be absent from both metadata and
final reads. Multiple matching helpers or observations still count as one case.

The [independent Python auditor](../scripts/po-cart-worker/shutdown-observation-audit.py)
recomputes findings and signatures. It attempts process, historical-resource,
business, signal-boundary and profile-drift checks even for an incomplete matrix.
It writes a structured blocked summary with the original diagnostic failure and
separate audit failures. Partial cases never qualify as successful reproduction.
CLI finalization rejects contradictory or incomplete audit success claims.

The existing signal-authorization, fixture-disposal and invocation-consumption
functions remain byte-for-byte unchanged, as do the fixed root, policy and
twelve-case matrix. Historical verification and cleanup modules are unchanged.

## Offline proof

The [portable regression fixture](../tests/fixtures/po-cart-shutdown-transition.json)
contains sanitized baseline and observation fields from the consumed
`SIGTERM-0-1` case, with provenance hashes. It contains no commands, credentials
or absolute paths, and tests do not depend on private runtime files or macOS.

Replay preserves the retained verifier refusal for leader 61492, records its
zombie and executable-text changes, and independently identifies helper **61598**.
The observer continues through that snapshot and confirms exit only after a
subsequent **simulated** complete absence snapshot. This supplied final snapshot
is modeled test input, never retroactive evidence that the consumed case completed.

The expanded `po-cart-shutdown-observation` suite verifies strict baseline defaults,
recorded transition findings, signature independence from verifier order,
JavaScript/Python agreement, start/topology/membership refusal, missing metadata,
incomplete collection, persistent-process timeout, late observation, interruption,
source/write failure and absence of observer signal calls. Existing strict
signal/disposal tests remain in place. Independent auditor tests cover complete
and partial synthetic matrices, false findings/signatures/classifications,
forbidden signal claims and preservation failures without primary-failure loss.

Five focused suites passed: `po-cart-shutdown-observation`,
`po-cart-legacy-verification`, `po-cart-remaining-profile-cleanup`,
`po-cart-legacy-profile-cleanup` and `po-cart-profile-preflight`.
The approved source-repair preparation passed:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **100 suites** |
| `pnpm build` | Passed |

`pnpm db:check`, `pnpm db:migrate:local` and `pnpm test:local` were not run:
this task changes no schema/API and exercises no application workflow. It makes
no full six-command pipeline or application-smoke claim.

Preparation and offline proof used **567 source files**, SHA-256
`6fb406db8909e063875d0a2e41b308dba62e9cd24e51c25cfb0a25c5a0bd1c2a`.
Independent replay agrees with the JavaScript findings and verifies the portable
fixture's provenance against the retained original bytes. Source snapshots,
rollback manifest, replay
proofs and verification logs live under
`.sites-runtime/po-cart-workers/shutdown-observation-repair-source-task-20261015/`.
They are separate from the consumed diagnostic evidence.

Final read-only preservation checks passed for **17,225 historical evidence
files**, **494 carts**, **37,368 baseline business rows** across six databases,
budgets and consumed records. No business or bookkeeping rows were added/changed;
reserved exposure remains **$0.921518**. All **46 worker locks** retain bytes,
inode, modification time and mode, and the nine historical process identities
and one live lock reference are unchanged. All inherited files outside the six
declared edits are preserved. The consumed diagnostic still records one attempted,
zero completed and eleven unstarted cases. The earlier seventeen-file failure and
both consumed maintenance attempts remain unchanged.

No browser invocation, real case, lock action or fresh baseline was created.
The preflight remains `historical_profiles_active`; this preservation audit makes
no claim that already-active profile caches are frozen. Offline behavior is
verified locally; a fresh real matrix remains unrun.

## Rollback and handoff

Rollback restores only the six declared existing source/test/status files and
removes the new regression fixture and this handoff. Preserve all runtime
evidence and consumed records; never reopen browsers, restore/reclaim locks or
resume an invocation. The ordinary test harnesses may manage their own temporary
Node/HTTP processes; this task performs no real browser operation.

The next task may separately scope a fresh twelve-case disposable-browser matrix
using this repair. No real-browser reliability or historical-cause claim follows
from offline replay, and historical cleanup remains separately scoped.
