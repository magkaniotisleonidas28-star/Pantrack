# C4 browser lifecycle source review and offline hardening — 2026-10-15

## Contract

This source-only C4 task follows the [blocked disposable matrix](C4_SHUTDOWN_OBSERVATION_MATRIX_20261015.md).
Its reviewable outcome is full-trial offline coverage and precise persisted
failure evidence across startup, shutdown, disposal and auditing. The selected
policy preserves refusal conditions, startup polling/stabilization, deadline
boundaries and strict signal authorization. No startup settling policy is added.

No browser launch, diagnostic OS signal, execution allowance, historical cleanup,
lock archive, idle baseline, paid inference, supplier access, purchase, deployment
or power-setting change is included. There are no public API, schema or migration
changes. **C4/M8 remain open.** Historical causes are unestablished.

## Changes and evidence contract

The [actual trial](../scripts/po-cart-worker/shutdown-observation-diagnosis.mjs)
now injects resource dependencies for executable lookup, proxy/port setup, spawn,
CDP, canonical-path lookup, deadlines and persistence. Production defaults retain
the pinned Chrome executable, launch arguments, minimal environment, deny proxy,
20-second startup window, two equal populations at least 250 ms apart, five-second
shutdown observation and existing bounded disposal/child/proxy limits. Test
injection adds no CLI or environment override.

The [lifecycle evidence helper](../scripts/po-cart-worker/shutdown-lifecycle-evidence.mjs)
records ordered version-two phases and startup samples before evaluating the
existing conditions. Refusals keep their original top-level category and add
stage, condition, PID when known, and a successfully persisted evidence reference.
New case records label injected proof `simulated` and default collection
`collected`. Samples contain only relevant process identifiers, topology, hashes, state,
profile-match and executable-policy evidence. Unrelated command text, full
executable paths, credentials and environment contents are excluded.

Baseline conditions distinguish insufficient members, zombie members, missing
profile arguments, missing metadata, metadata identity mismatch, disallowed
executables, noncanonical executables and path-resolution errors. Identity and
metadata collection failures retain their exact collection stage. Existing
leader/CDP readiness and population-stability waits are recorded separately.

Primary failures survive disposal, child-exit, proxy-close and evidence-write
failures. An exclusive synchronized `failure-result.json` retains the structured
case if normal result persistence fails. If both writes fail, the case returns
blocked to the controller with both failures and no claimed result reference.
Report finalization checks interruption/source state before and after persistence.
Timed-out page initialization cannot resume issuing further CDP commands; an
already-issued command may still settle. Late protocol callbacks cannot mutate
a finalized result.

The strict signal verifier, disposal primitive and consumption function retain
their original bodies. Partial startup records the exact captures already owned
by that verifier before disposal; independent signal auditing can validate a
permitted leader cleanup even when no full stable baseline was admitted. This
does not authorize additional processes or broaden any signal check.

The [independent lifecycle auditor](../scripts/po-cart-worker/shutdown-lifecycle-audit.py)
recomputes startup decisions, population hashes, stabilization intervals and
baseline correspondence. It verifies ordered references, phase timing, primary
and secondary failure evidence, disposal capture ownership, durable case/report
agreement and completion obligations. Version-two reports reject missing or
downgraded case evidence. Existing version-one reports remain readable without
any claim that they contain version-two startup proof.

## Lifecycle coverage

The [offline suite](../tests/po-cart-browser-lifecycle.mjs) exercises the actual
trial, observer, strict verifier and disposal; it replaces only external resource
dependencies with simulated processes, CDP objects and clocks. It also drives
the actual controller through complete and partial synthetic matrices and the
independent Python case/signal auditor. Existing wrapper tests retain invocation,
concurrency and preparation coverage.

| Phase | Failure/wait scenarios and retained evidence | Disposal or completion obligation |
| --- | --- | --- |
| Executable lookup | Unavailable binary; phase/refusal record | No spawn or signal |
| Proxy setup | Setup failure; ready/failure records | Close a proxy only if acquired |
| Port allocation | Allocation failure; phase record | Close already-acquired proxy |
| Spawn | Missing/forbidden PID, child error/early exit; spawn phase and event | Never signal forbidden or unverified ownership |
| Leader/CDP readiness | Delayed/unowned leader, delayed/unavailable CDP; scoped leader samples and wait records | Deadline remains bounded; cleanup uses only existing captures |
| Page initialization | Failure, timeout, late completion; initialization milestones | Owned handle disposal; no commands resumed after timeout |
| Population admission | Every named refusal, malformed reads, changing/never-stable population; persisted samples and independent decisions | No shutdown action before admitted and strictly verified baseline |
| Baseline verification | Proxy arguments, baseline/observation writes, strict verification; durable baseline reference | In-memory candidate is not claimed as persisted proof |
| Shutdown/observation | Both methods/all delays, retained-transition replay, missing data, changed start/topology, new members, incomplete reads, timeout | Complete absence required; no signal authority derived from findings |
| Disposal | Partial startup, disconnected CDP, bounded escalation, PID reuse, forbidden targets; exact captures and individual signal intents | No adoption, group signals or policy relaxation |
| Child exit/proxy close | Missing exit callback, close failure/timeout, proxy-evidence failure | Each failure blocks completion and remains separate from primary failure |
| Report/audit | Interruption/source/write faults before and after every phase, fallback failure, false decisions/stability/cleanup, missing/reordered/version-downgraded evidence | No false success; preserve original failure and attempt independent audits |

The seven completed cases and incomplete eighth case from the prior real matrix
remain unchanged. No rejected startup population is reconstructed for case eight;
new startup scenarios are explicitly simulated and do not identify its cause.

## Verification and preservation

The new lifecycle suite and six existing focused suites passed. The lifecycle
suite covers **130 standalone simulated trials**, plus **28 cases** through the
actual controller and independent Python auditor: a complete twelve-case matrix,
an eight-case partial matrix and an eight-case partial matrix with preservation
audit failure. These are offline test scenarios, never new real-browser attempts.
Ten mutated-evidence scenarios independently reject false success, and whole
report tests reject downgraded versions, forbidden signal claims and false
preservation. Intact partial evidence is independently auditable while the case
and matrix remain blocked; missing/corrupt evidence is rejected.

One frozen preparation pass completed successfully:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **102 suites** |
| `pnpm build` | Passed |

The snapshot contains **573 source files**, SHA-256
`8b01ad3749f921bdf5c687818dede72297adc174c821bbe5f8747a7977c23f8c`.
`pnpm db:check`, `pnpm db:migrate:local` and `pnpm test:local` were not run:
this task changes no schema/API and exercises no application workflow. No full
six-command pipeline or real-browser validation is claimed.

Seven representative simulated proofs are retained privately, including the
startup refusal, shutdown signature, result-write fallback, strict PID-reuse
refusal and failure of both result writes. Independent Python auditing accepts
the intact evidence and rejects the expected missing durable result. The
original real matrix is still readable as legacy evidence: eight attempted,
seven completed, four signature cases and a blocked status. It is not rewritten
or reclassified, and its missing startup evidence remains missing.

Before editing, the private snapshot captured **18,769 evidence files**, **494
carts**, six database row snapshots and **46 worker locks**. The source review
root is `.sites-runtime/po-cart-workers/browser-lifecycle-source-review-task-20261015/`.
It retains inherited-work snapshots, before-images, rollback manifest, source
verification logs and simulated proof artifacts; it grants no diagnostic invocation.

Independent final preservation passed for all **18,769 evidence files**, **494
carts**, **37,368 business rows** across six databases and every prior consumed
record. There were zero business/bookkeeping changes or additions, zero ordinary
smoke additions and no budget change; reserved exposure remains **$0.921518**.
All **46 worker locks** retain original bytes and metadata. Nine historical
process identities under 30474 and one live lock reference are unchanged;
PID 4303 remains absent and untouched. Preflight remains
`historical_profiles_active`; no historical profile stability or idle baseline
is claimed. The seventeen-file failed audit and all consumed diagnostic and
maintenance attempts retain their original bytes/statuses.

Before-image comparison confirms that `verifySignalTarget`, `disposeFixture`,
`consumeDiagnosis` and the deadline helper remain byte-for-byte unchanged.
Diff, relative-link and checkbox-preservation checks passed. The durable
repository instruction now requires actual-lifecycle tests and persistence of
refusal inputs before evaluation.

## Limits and handoff

An unowned leader cannot be automatically signaled if startup never captures it
and no owned CDP handle exists. Tests require a bounded blocked result and no
signal in that situation. Changing this disposition requires a separate policy
decision. A stdio-close error after spawn now retains the child PID/listeners
before reporting the failure; unverified captures still cannot be signaled.
Disk failure that prevents both normal and emergency evidence writes
also remains blocked; the implementation cannot claim durable evidence then.

The unchanged disposal policy treats driver transport closure as best effort
within one second. Verified process absence, observed child exit and proxy
closure remain mandatory; a transport-close error alone is not a new completion
gate. A retained simulated policy check confirms that behavior without changing
signal authority or disguising a process-cleanup failure.

These limits do not admit a success path or require a change to refusal policy.
The source-only review cannot guarantee that future macOS/Chrome runs reveal no
new timing behavior. A fresh real validation requires a separately scoped new
attempt after reviewing this offline proof and its limits. Historical disposition
and the full offline acceptance gate remain separate dependencies.

Rollback restores only this task's source/documentation from the private
before-images and removes newly added source files. Never remove consumed
records, reopen browsers, delete retained profiles, restore an archived lock or
rewrite prior failure reports. No acceptance checkbox is advanced.
