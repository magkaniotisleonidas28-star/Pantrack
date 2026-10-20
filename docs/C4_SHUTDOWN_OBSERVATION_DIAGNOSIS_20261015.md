# C4 isolated Chrome shutdown diagnosis — 2026-10-15

## Contract

This diagnosis-only C4 task follows the [stopped remaining-profile maintenance](C4_REMAINING_PROFILE_CLEANUP_20261015.md).
Its outcome is a bounded real-browser comparison with the unchanged process
verifier, identifying whether disposable Chrome shutdown can reproduce the
retained observation: a captured helper has a changed command-derived identity,
loses its exact profile argument, and disappears before the metadata/final read.

No existing verifier or cleanup policy changes. The nine historical processes
rooted at 30474, all historical profiles/locks, failed audits and consumed
maintenance attempts remain untouched. There is no maintenance retry, lock
archive or idle baseline. **C4/M8 remain open.** Original timeout and historical
shutdown causes remain unresolved.

## Implementation

The [standalone CLI](../scripts/po-cart-shutdown-observation-check.mjs) accepts no
arguments, overrides or resume. It uses the sole private root
`.sites-runtime/po-cart-workers/shutdown-observation-diagnosis-task-20261015/`
with an exclusive report and durable `diagnosis.json` invocation. Diagnostic
profiles live within that root, outside historical `browser-profiles`. There is
no new maintenance or acceptance-gate invocation.

The [diagnostic module](../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs)
launches the installed Chromium 1228 / Chrome for Testing 149 executable directly
as a recorded child. Each case gets a new profile, headless browser, loopback CDP
and two inline HTML pages. A deny-all local proxy rejects HTTP and CONNECT;
only the CDP connection bypasses it. Actual process arguments verify that proxy
configuration. The child environment excludes application/provider credentials.
No SDK, Stagehand, storefront fixture, cart job or application database is loaded.

The fixed sequential matrix contains twelve cases: SIGTERM and browser-protocol
close, first-observation delays of 0/10/50 milliseconds, two repetitions each.
Startup/stabilization is bounded to twenty seconds, with two matching captured
populations at least 250 milliseconds apart. Shutdown observations use the
unchanged verifier during a five-second window. Each records separate command,
start-time and executable hashes, parent/group IDs, process state and profile
matches; unrelated commands and executable paths are excluded from reports.

A verifier refusal is an observed result, never signal authorization. Fixture
disposal first uses the owned browser handle; fallback SIGTERM/SIGKILL is limited
to individually verified captured fixture PIDs, with bounded waits. No process
groups, historical PIDs, PID 4303 or new members can be signaled. Cleanup, source,
collection, ownership or evidence failures stop the matrix without replacement
cases or automatic retries; profiles and partial evidence remain retained.

The independent read-only auditor checks actual fixture-process absence,
historical identities and locks, evidence, carts, business rows, budgets and
consumed records. It recomputes case signatures and classification from referenced
observations. Concurrent drift inside the already-active historical profile is
recorded separately, with no strict frozen-profile claim.

## Verification and results

The `po-cart-shutdown-observation` simulated suite covers command-change/exit,
unchanged exit, changed start/executable, zombie and parent transitions, missing
metadata, incomplete snapshots, transient members, PID reuse, fixed order,
classification, interruption, frozen preparation, invocation exclusion,
evidence-write failures, fixture cleanup bounds/races, proxy rejection and
independent false-success checks. Existing safety expectations remain unchanged.

Five focused suites passed: `po-cart-shutdown-observation`,
`po-cart-legacy-verification`, `po-cart-remaining-profile-cleanup`,
`po-cart-legacy-profile-cleanup` and `po-cart-profile-preflight`. The approved
preparation passed `pnpm typecheck`, `pnpm test` (**100 suites**) and `pnpm build`.
No schema check, migration apply or application HTTP smoke ran in this task;
there is no schema/API change or application-workflow acceptance claim.

Preparation and execution used **566 source files**, SHA-256
`fe25965520cada2400f2e737c0f6eb94a5d8bfa082d6771352b8037db580745f`.
Existing verifier and cleanup source remains byte-for-byte unchanged.

Classification is `reproduced` for signatures in at least two complete
cases, `observed once` for one, `not reproduced within this matrix` for zero across
twelve complete cases, or `blocked` for incomplete/unverified execution.
Matching signatures support an explanation but cannot establish the historical
cause, prove PID-reuse safety or authorize a policy relaxation.

The sole diagnostic invocation was consumed at `2026-10-15T22:53:22.560Z`.
The first case (`SIGTERM-0-1`) launched leader **61492** and captured a stable
nine-process baseline. At `22:53:24.906Z` it recorded the verified SIGTERM action.
The next observation retained a command/executable-metadata transition, then the
diagnostic's additional metadata comparison stopped the case with category
`process_instance_changed`. **The matrix is blocked: one attempted case, zero
completed cases, eleven unstarted.** No retry, replacement or resume followed.

The precise reference is `cases/SIGTERM-0-1/observation-0002.json`:

- Leader 61492 retained its start time, parent and group. Its executable-text
  hash changed during the middle read; the final snapshot showed state `Z`, lost
  profile arguments and command text whose hash equals `<defunct>`. The owned
  child's exit event was subsequently observed.
- Helper 61598 retained its recorded start time while its command-derived
  identity changed and profile arguments disappeared; it was absent from both
  metadata and final reads. This resembles the retained historical helper
  observation, but the unchanged verifier reported the leader's earlier failure.
- Other captured helpers also changed executable-text hashes while their start
  times remained unchanged. The diagnostic's `process_instance_changed` label
  overstates what those metadata changes establish. The error is in the
  diagnostic classification; it does not establish PID reuse or a new product bug.

The unchanged verifier retains its strict refusal. Its interpretation
and possible repair remain separately scoped. This incomplete case cannot earn
the matrix's `observed once` or `reproduced` classifications, and the historical
cause remains unestablished. The main runner report is unchanged; the independent
partial audit retains the field-level comparison and failure references.

Fixture disposal passed without any additional signals. Independent process
checks confirm all nine fixture PIDs are gone and the deny-all proxy is closed;
fifteen browser requests were denied. The nine historical process identities and
all **46 worker locks** are unchanged. Preservation passed for **16,935 evidence
files**, **494 carts**, **37,368 baseline business rows** across six databases,
budgets and historical consumed records. No business or bookkeeping rows were
added/changed. Reserved exposure remains **$0.921518**. Both consumed maintenance
attempts and the historical seventeen-file failure retain their original bytes.
Six changed entries in the already-active 30474 profile are recorded as concurrent
drift; no inactive historical profile changed and no idle baseline exists.

This repeats the earlier mistake of treating mutable shutdown metadata as
process-instance evidence. Following the repository's repeated-mistake rule,
[AGENTS.md](../AGENTS.md) now requires diagnostic observation to remain separate
from signal authorization; changed command/executable text alone does not prove
PID reuse. No existing executable policy was relaxed or repaired.

## Rollback and handoff

The private rollback manifest restores only `AGENTS.md` and the two status/roadmap
documents, and removes this task's five new files. Preserve all runtime evidence and disposable
profiles; never reopen browsers, restore/reclaim historical locks or retry a
consumed invocation. There are no public API, schema, supplier, paid-inference,
purchasing, deployment, power-setting or acceptance-gate changes.

The next task is an evidence-backed repair of the diagnostic classification and
regression fixtures using this retained transition, preserving strict signal
ownership checks. A new isolated matrix would need its own explicit scope; this
consumed invocation cannot resume. Historical verifier repair and another
historical cleanup attempt remain excluded and separately scoped.
