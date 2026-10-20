# C4 parallel maintenance preparation — 2026-10-16

This packet splits the next C4 maintenance preparation into two source-only
implementation lanes. The [maintenance observation refinement](C4_MAINTENANCE_OBSERVATION_REFINEMENT_20261016.md)
is complete locally. The [historical review](C4_HISTORICAL_SHUTDOWN_REVIEW_20261016.md)
defines the later one-instance/stale-lock operation. **C4/M8 remain open.**

Neither lane may execute real maintenance, acquire historical guards, archive
locks, consume an invocation, publish an idle baseline, launch a browser, run
paid inference, access suppliers, deploy or change power settings. This packet
does not create an execution allowance. All lifecycle tests use temporary
resources and injected process reads/signals/clocks.

## Ownership and integration

| Lane | Reviewable outcome | Files owned |
| --- | --- | --- |
| A — primary agent | Prepare the fixed single-instance runner, target binding, fixed audit adapter and their offline integration | New `scripts/po-cart-single-instance-maintenance.mjs`, `scripts/po-cart-worker/single-instance-maintenance.mjs`, `scripts/po-cart-worker/single-instance-maintenance-audit.py`, `tests/po-cart-single-instance-maintenance.mjs`; integration documentation and shared status documents |
| B — other agent | Independently challenge and, where needed, harden the existing maintenance lifecycle auditor without changing its input contract | `scripts/po-cart-worker/maintenance-observation-audit.py`; new `tests/po-cart-maintenance-audit.mjs`; new fixtures only under `tests/fixtures/po-cart-maintenance-audit/` |

Lane A is the merge owner. Lane B must not edit Lane A files, existing JavaScript
collectors/controllers, existing tests, package/CI files, AGENTS.md, status or
roadmap documents. Lane A must not edit Lane B files until its handoff is
integrated. If an issue requires an unowned file or a contract change, report
the exact issue and proposed interface; do not silently broaden ownership.

Each lane uses a separate worktree. Lane A remains in
`~/Desktop/Pantrack`, branch
`workstream-c/c4-full-offline-gate-20261014`. Lane B uses
`~/Desktop/Pantrack-c4-maintenance-audit-20261016`, branch
`workstream-c/c4-maintenance-audit-20261016`, seeded with the current Git-enumerated
tracked and untracked source, rather than only HEAD. The source seed excludes
ignored runtime evidence, secrets, databases and dependencies. Missing private
evidence in that worktree is intentional; Lane B's tests must be hermetic.

The Lane B worktree contains inherited changes. Its baseline manifest lives at
the path returned, from that worktree, by:

```sh
git rev-parse --git-path c4-audit-handoff-baseline.json
```

Use that manifest and explicit file ownership to distinguish new edits from
inherited work. Do not reset, clean, stash, broadly stage or commit inherited
changes. Do not switch branches in Lane A's checkout. Lane B should leave its
owned diff for selective integration; no commit is necessary.

Focused offline checks may run in separate worktrees concurrently. Source freeze,
the combined full pipeline and any later real operation are serialized by Lane A.
Do not claim an unchanged frozen source while either lane is still editing it.

## Stable interface between lanes

Lane B preserves these Python APIs and current return shapes:

```python
decision(sample)
audit_maintenance(root, require_collected=False)
```

`root` remains an offline proof directory, not permission to run maintenance.
Existing report/timeline/version-two observation formats remain unchanged.
Conservative rejection of malformed or contradictory proof is allowed. Do not
rename fields, require a new schema version, add a CLI/root override to production
entrypoints, relax signal authority or infer missing historical evidence.

Lane A consumes the existing version-two proof format and calls
`audit_maintenance(root, require_collected=True)` for a real-success gate. Lane A
separately owns fixed policy/source/history/root binding, preservation, lock
archive disposition and independent idle/stability checks. Passing the generic
proof auditor alone cannot authorize a fresh baseline.

The existing `runMaintenanceScenario(root, mode)` export from
`tests/po-cart-maintenance-lifecycle.mjs` may be imported read-only to generate
actual simulated lifecycle proof. Importing that module does not run its suite.
Reuse it rather than duplicating the production decision algorithm in tests.
Temporary test profiles, locks and guards must stay under a fresh temporary root.

Synthetic proofs retain `evidenceOrigin: simulated`. They must fail
`require_collected=True`; never relabel one as collected to manufacture a positive
real-maintenance test. The five retained collected transition samples can be
replayed as observations, but are not a complete real historical-maintenance run.

## Context both lanes must preserve

- The real disposable matrix is finished and permanently consumed:
  twelve completed cases, four narrow signatures, zero independent audit
  failures; see [the collected report](C4_BROWSER_LIFECYCLE_VALIDATION_20261015.md).
  Do not rerun it.
- Both older historical maintenance attempts are permanently consumed. The old
  27/18-member runners cannot be resumed or broadened to nine members.
- Last verified remaining original members were 30474, 30480, 30481, 30482,
  30484, 30487, 30488, 30493 and 30528, under leader/group 30474.
- Last verified active profile was
  `803d991d176c8396e146ef8b95f5553373130034ff92d08aade5c847b597d571`.
- PID 4303 was absent and remains a forbidden signal target. The one proposed
  stale lock is
  `e151abec389352a225974f0bb7057ad3df9b6f2b30f6c4fdd16bba2a55a06bcf.lock`,
  with retained bytes `4303`. All 46 worker locks remain unarchived.
- These are historical observations, not current ownership or signal authority.
- The earlier helper-30095 sample lacks transition-time separate start/command
  evidence. Neither PID reuse nor a benign text-only cause is established.
- Earlier cart timeouts, startup refusal and seventeen-file preservation failure
  remain unresolved. Later tests must not retroactively repair their reports.

The latest completed source task recorded 581 source files, SHA-256
`637d00c651bb6e58dd516cec8d9494cf6abef4c61b5b88b7b365f884b1633547`.
It passed 32 simulated actual lifecycles, nine focused suites, type checking,
104 full suites and build. These are prior results, not checks for the parallel
changes. No complete six-command pipeline or new real-browser run is claimed.

## Lane B task and acceptance

Read AGENTS.md, current status, the C4 roadmap section and AI development
instructions, then the latest source handoff and historical review. Inspect the
current auditor, collector and lifecycle test before editing. State the C4 task
contract and record the focused baseline.

Independently assess whether the auditor rejects contradictory or forged proof
across report, timeline, samples, decisions, signal events, final absence and
primary failure. Prioritize substantive missing checks rather than duplicating
the nine existing mutated-proof scenarios.

Use actual generated simulated lifecycle proofs as the starting point. Keep valid
graceful/terminal-transition/escalation/blocked proofs accepted where the existing
contract permits them. Challenge, as applicable:

- Inconsistent completion/status/failure claims and empty, truncated or reordered
  evidence; distinguish valid partial failure proof from a false success.
- Changed admission/profile/topology/start claims and unproved baseline enrichment.
- Missing, duplicate, dangling or inconsistent signal intents/results; incorrect
  targets or kinds; lost fresh strict verification before and after intent.
- Reappearance, missing final absence and closure-event inconsistencies.
- Version/origin downgrades, missing or unsafe observation references, and
  mismatched sample/decision origin or analysis.
- Replacement or loss of the primary failure when later write/audit failures occur.
- Sensitive data accidentally included in new fixtures or failure output.

Each production change needs an acceptance-oriented failing case that demonstrates
the gap, followed by the narrow fix. If the existing auditor already enforces a
requirement, retain the evidence and avoid unrelated refactoring. Do not make the
auditor lenient just to keep an invalid fixture passing.

Run, in Lane B's own worktree:

```sh
pnpm test po-cart-maintenance-audit po-cart-maintenance-lifecycle
git diff --check
```

Run additional focused checks only when a finding justifies them. Do not run the
full build/pipeline, migrations, HTTP smoke, browser checks or any maintenance CLI.
The merge owner will run the combined frozen-source verification after integration.

Deliver the owned-file diff, exact command results, concrete gaps fixed or verified,
compatibility notes, unresolved findings outside ownership and rollback for your
owned source/test files. Do not update C4/M8 checkboxes. Do not claim collected
maintenance acceptance from synthetic tests.

## Lane A task and final integration

Lane A prepares a fresh fixed runner and independent binding adapter for only
the original nine-member instance and one verified stale lock. Source-only
implementation does not launch the runner or create its runtime root, allowance,
guards, consumed records or baseline. Real execution stays separately scoped.

The implementation must preserve strict admission and individual signal checks,
existing five-second/five-second limits, exclusive durable invocation semantics,
no retries or adoption, precise version-two refusal evidence and primary-failure
preservation. All independent final audits must be attempted after partial
failure. Fresh baseline publication requires complete process absence, exact
archive/guard disposition, preservation and idle checks around two equal complete
profile fingerprints, the second starting at least five seconds after the first
finishes. The historical review supplies the full later-operation requirements.

After Lane B hands off, integrate only its owned files and rerun both new suites
plus affected existing focused suites. Then freeze the combined source and run
type checking, full tests and build with source-bound logs. Explain any excluded
normal pipeline commands rather than claiming they ran. Update shared documents
once, as merge owner, distinguishing source readiness from real execution.

A source-only pass prepares a concrete executable maintenance proposal. A later
successful real maintenance would unblock consideration of a fresh full offline
gate; neither outcome closes C4/M8 or authorizes paid/hosted/supplier acceptance.

## Lane A handoff

The [Lane A implementation report](C4_SINGLE_INSTANCE_MAINTENANCE_PREPARATION_20261016.md)
records completed source-only runner/binding/adapter work, ten focused suites,
type checking, 105 suites and build. The generic Python APIs and Lane B-owned
files in the primary checkout were unchanged at that handoff. The subsequent
[combined integration](C4_MAINTENANCE_PARALLEL_INTEGRATION_20261016.md) selectively
integrates Lane B's two assigned files and records eleven focused suites, type
checking, 106 suites and build on the combined source. Both source lanes are now
integrated. Neither lane's offline proof authorizes real maintenance or closes
C4/M8; the one-instance/stale-lock operation remains separately scoped.
