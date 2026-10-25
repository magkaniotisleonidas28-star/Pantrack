# C4 fresh full offline gate scope — 2026-10-21

This planning task follows the [passing observation baseline](C4_OBSERVATION_BASELINE_RUN_20261021.md).
Its one reviewable outcome is a scope for a fresh complete offline acceptance
gate on reviewed source. It is documentation and read-only inspection only. No
gate, browser, preview, model, supplier, migration or invocation ran. **C4/M8
remain open; historical causes remain unresolved.**

## Why a fresh gate is now considerable

| Earlier blocker | Current position |
| --- | --- |
| Historical browsers kept preflight `historical_profiles_active` | Gone. The [baseline](C4_OBSERVATION_BASELINE_RUN_20261021.md) published idle, stable profiles and exact locks with zero signals |
| Final credential audit updated already-revoked credentials | Repaired and tested in the [credential-audit repair](C4_CREDENTIAL_AUDIT_REPAIR_20261015.md) |
| Reliability job 5 stopped at the second addition 16 s after the display turned off | The [display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md) passed 12/12 with the display held on. Correlation only; **the cause is unresolved** |

## Why the existing gate cannot simply be rerun

The [runner](../scripts/po-cart-ai-gate.mjs) and
[gate module](../scripts/po-cart-worker/acceptance-gate.mjs) fix their root to
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014/`. That
root's `task.json` records two consumed steps, and its `pipeline-final.json`
binds the 543-file source of October 14. `pnpm cart:browser-worker:gate:ai` would
refuse at preparation validation, because the source has changed. That
invocation is permanently consumed and must stay retained and unrepaired.

The independent [gate preservation audit](../scripts/po-cart-worker/full-gate-audit.py)
has the two defects the baseline just exposed:

- It opens databases with plain `mode=ro`, which cannot open the five
  sidecar-less WAL copies.
- It audits only the databases captured by a hand-written preparation (six on
  October 14). That inventory missed most local review state.

Its preparation and capture were also ad hoc private scripts. The
display-on power guard is not wired into this runner.

## Proposed tasks

### G1 — source-only gate rebinding (next unblocked item)

Workstream **C4/M8**; one outcome: a fresh fixed gate binding with corrected
preservation, tested offline.

- Bind a new fixed root and policy. The 21 steps, their order, every
  `inspectGateStep` threshold, the stop rule, credential handling and network
  boundaries stay unchanged. Keep the October 14 root and policy as historical
  constants or remove only their executable binding, so no code can write to the
  consumed root.
- Make the gate preservation audit use `legacy-profile-audit.py`'s
  `open_readonly` helper. Capture every `*.sqlite` under `.wrangler/state` and
  `.sites-runtime`. Keep the existing rule that historical rows may never be
  removed or changed. Expected additions stay explicitly classified:
  fictional served-cart rows, ordinary-local smoke rows, the
  credential-event sequence and `_cf_METADATA` bookkeeping.
- Hold the existing task-owned `caffeinate -di -w <runner PID>` power guard for
  the whole invocation, verified like the display-on investigation. This removes
  the display-off correlation as a confound; it is not a causal fix.
- Require, immediately before `task.json` creation, a fresh idle preflight. All
  46 locks must match the baseline, and no inactive profile may differ from the
  baseline fingerprint.
- Add focused tests for the new binding and refusal of the consumed root. Cover
  the WAL-copy open, the widened inventory with allowed and forbidden deltas, and
  power-guard ownership/failure. Run frozen type checking, full tests and build.

### G2 — one separately authorized gate run

1. Run the six-command preparation pipeline into the new root.
2. Capture before-images after the pipeline, because `test` adds evaluation
   records and `test:local` adds smoke rows.
3. Dry-run the preservation audit.
4. Repeat the idle/lock/profile checks.
5. Invoke the gate once.

All inference stays mocked, with a fictional key and zero real requests. The
Metadata, reliability, served, safety and fault steps exercise fresh fictional
fixtures only.

The duration is not established, because no complete run exists. The October 14
attempt stopped at reliability job 5 of 30. Plan for at least an hour of
uninterrupted machine time.

The stop rule is unchanged: the first unexpected failure ends the invocation,
retains everything and grants no retry. **If reliability fails again at the
second addition with the display held on, the next task should be a causal
investigation of that stage, not another gate.**

## Preserved constraints

- Do not replay or clear the October 14 `review_needed` job, its held account
  ownership or its 25,000-minor-unit fictional reservation.
- Real reserved exposure stays `$0.921518`. No paid inference, supplier access,
  checkout, purchase, hosted change or deployment is in scope.
- A passing gate would provide local offline evidence toward C4/M8. Real-model,
  hosted, supplier, pilot and production acceptance remain separate gates, so it
  would not close C4/M8 by itself.

## Owner decisions — 2026-10-21

- **G1 proceeds as scoped.**
- **Power:** wrap the G2 run in an external `caffeinate -di`. The power guard is
  not wired into the runner.
- **Stop routing:** a repeat second-addition failure with the display held on
  routes to causal investigation, not another gate.

## Verification

Documentation only. `git diff --check` and the changed relative links were
checked. The read-only inspection confirmed:

- the consumed October 14 `task.json` (two steps);
- the fixed-root and policy constants;
- the gate audit's database open mode and inventory;
- the power guard's exports.

No test, build or gate ran for this scope, and no checkbox changed.
