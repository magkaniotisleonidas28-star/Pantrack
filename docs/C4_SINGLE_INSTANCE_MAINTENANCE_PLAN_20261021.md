# C4 single-instance maintenance plan — 2026-10-21

This C4/M8 planning task follows the [combined maintenance preparation](C4_MAINTENANCE_PARALLEL_INTEGRATION_20261016.md)
and the bounded operation proposed in the [historical shutdown review](C4_HISTORICAL_SHUTDOWN_REVIEW_20261016.md).
Its one reviewable outcome is a plan for the real one-instance/stale-lock
operation. That plan was to be based on freshly observed state. **C4/M8 remain
open; historical causes remain unresolved.**

No process was signaled. This task did not launch, connect to or adopt a browser.
It acquired no guard and archived no lock. It did not modify any profile, lock or
business state, and it consumed no invocation. The fixed execution root
`.sites-runtime/po-cart-workers/single-instance-maintenance-task-20261016/` remains
absent. There were no application, API, schema, migration, supplier, paid-model,
purchasing, deployment or power-setting changes. Read-only observations are
retained privately at
`.sites-runtime/po-cart-workers/single-instance-maintenance-plan-task-20261021/`.

## Fresh observation: the target instance is gone

Bracketed `ps` reads, a signal-0 existence probe (no signal delivered),
`pgrep` and two `historicalProfilesPreflight()` calls were taken at about
11:33–11:36 EDT. They agree:

| Check | Result |
| --- | --- |
| Boot time | 2026-08-06 14:08; no reboot since the October captures |
| Nine captured members under 30474 | **All absent** |
| PID 4303 | Absent |
| Processes referencing any historical profile | None |
| Preflight, both reads | **`idle`**: 1,434 profiles, 0 processes, 0 live locks, 48 stale references |
| All 46 worker locks against `worker-locks-before.json` (SHA-256 `84802b4c…`) | Exact match, including nanosecond mtime |
| Stale lock `e151abec….lock` | Bytes `4303`, unchanged |
| Active profile `803d991d…` singleton | Still `SingletonLock -> <host>-30474` |
| Profile writes since 2026-10-17 | Nine files, all in the profile already active initially; no inactive profile changed |

The last active-profile writes were `Local State` at 02:30 and `Default/Preferences` at 10:54. GPU/Dawn caches and `QuotaManager` followed at 11:01:23–24 on
2026-10-21. This is consistent with the instance running until about 11:01 today
and flushing at exit. The retained singleton shows that Chrome did not remove its
own reference. A unified-log search of 10:59:30–11:03 found no entry for the
browser or PID 30474. **The exit is unobserved and its cause is unknown.** This
session sent no signal, but that does not rule out another actor. No reuse,
crash or clean-shutdown finding is claimed.

These are ad hoc read-only observations by this planning task. They are not
collected acceptance evidence and grant no later action. The current source is
**590 files**, SHA-256 `93e8b668…c3c43271`. It differs from the 586-file combined
snapshot (`ae9a56da…`) because the F2–F8 fixes were merged into `main`.

## Consequences

1. **The fixed runner can no longer do its job.** `validateSingleTargets` and
   `revalidateSingle` require all nine captured identities to be live
   (`verifyPopulation(...).length===9`). They would refuse at target validation
   before guards or consumption. Running it only to record that refusal would
   create and spend its fixed root for no operational purpose. **Decision:
   `fixed-single-instance-maintenance-20261016` is retired unexecuted.** Leave its root
   absent, and never rebind it to other processes. The source and offline proofs
   remain historical evidence. Removing them is a separate source decision.
2. **No signal is needed.** The shutdown phase, SIGTERM/SIGKILL policy and
   strict signal authorization have no remaining target. Do not repurpose any
   signal path for later work.
3. **The idle gate is reachable without maintenance**, but it is not yet proven.
   The current `idle` reads are point observations. The planned baseline still
   requires collected, independently audited idle/stability/preservation gates.
4. **Stale-lock archival is now optional.** It is not needed for preflight
   `idle`. The PID-4303 lock and the retained 30474 singleton fail closed. If
   either PID is reused, preflight reports `historical_profiles_active`, and
   signal ownership still requires full identity. Archival is a file mutation
   with its own race checks. **Decision: it is excluded** unless a later gate
   demonstrably needs it.

## Revised plan

The plan has two separately scoped tasks, neither of which sends a signal.

### Task 1 — source-only observation baseline (next unblocked item)

Workstream **C4/M8**; one outcome: a fixed, argument-free observation-baseline
entrypoint and independent auditor, tested offline.

- Reuse existing read-only primitives: the profile preflight, complete profile
  fingerprinting, exact 46-lock metadata reads, process snapshots and
  `legacy-profile-audit.py` preservation checks. Do not import or call any signal,
  guard, consumption or archive primitive. A focused test must prove that they are
  unreachable.
- Bind a fresh private root and policy. Require frozen
  `typecheck`/`test`/`build` logs on the then-current source. Refuse arguments,
  root overrides, concurrency and reuse. Persist every read before evaluating it.
- Require bracketed complete process reads showing all nine 30474 identities, the
  eighteen earlier PIDs and PID 4303 absent. No process may reference a historical
  profile. Treat any appearance or incomplete read as blocking, with no retry.
- Require exact matching of all 46 lock records and the unchanged 30474 singleton
  reference. Record that singleton as Chrome's own, left untouched, and do not
  infer an exit cause from it.
- Require idle preflight before, between and after two equal complete profile
  fingerprints. The second capture must start at least five seconds after the
  first finishes. Compare against the 2026-10-16 profile snapshot. Allow drift only
  inside `803d991d…`, record it explicitly and treat it as observational. Any
  inactive-profile change blocks.
- Audit zero database additions/changes (including bookkeeping) and unchanged
  protected evidence, carts, budgets, consumed records and failed reports. The
  seventeen-file failure stays failed. Publish `fresh-baseline.json` only after
  every independent group passes.
- Test the actual entrypoint lifecycle with injected reads. Cover reappearance,
  PID reuse with a changed start time, a live-lock flip, inactive drift, unequal
  fingerprints, a short interval, write/audit failures, interruption and
  primary-failure preservation.

### Task 2 — one real observation-baseline run

This step is separately authorized. Immediately before invoking, repeat the
read-only checks above. If any historical identity reappears, preflight is not
`idle` or any lock differs, stop and return to planning. Do not adapt the run.
The run makes one invocation with no retry. A failure retains a blocked report
and grants no second invocation.

A passing baseline would unblock consideration of a separately scoped fresh
complete offline acceptance gate. It would not close C4/M8, explain the earlier
timeout, startup-refusal or seventeen-file preservation failures, or authorize
supplier access, paid inference or a purchase.

## Owner decisions — 2026-10-21

The owner accepted both recommendations after reviewing this plan:

- **Retired:** the fixed single-instance runner, policy
  `fixed-single-instance-maintenance-20261016`, will not be invoked. Its execution
  root must stay absent. Its source and offline proofs remain historical
  evidence; deleting that source is a separate, optional cleanup.
- **Excluded:** stale-lock archival is out of scope for the baseline tasks. A later
  file-only archival step needs its own scope and a demonstrated need.

## Verification and handoff

Documentation only, plus private read-only observation files. `git diff --check`
and the changed relative links were checked. No test suite, type check, build,
migration or HTTP smoke was run, so no pipeline result is claimed. No milestone
checkbox changes.

The owner decisions above change no runtime
state. Rollback removes this report and restores the two status/roadmap paragraphs.
The private observation folder may be kept or deleted. All runtime evidence,
consumed attempts, profiles, locks, carts, business rows and budgets remain
untouched.
