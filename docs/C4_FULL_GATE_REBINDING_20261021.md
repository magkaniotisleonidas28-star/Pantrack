# C4 full offline gate rebinding (G1) — 2026-10-21

This source-only C4/M8 task is G1 of the [fresh full offline gate scope](C4_FULL_OFFLINE_GATE_SCOPE_20261021.md).
Its one reviewable outcome is a fresh fixed gate binding with corrected
preservation, tested offline. No gate, browser, preview, model, supplier or
migration ran. **C4/M8 remain open; historical causes remain unresolved.**

## Owner decisions applied

- G1 proceeds as scoped.
- **Power:** G2 is wrapped in an external `caffeinate -di`. No power-guard code
  is added to the runner. This removes the display-off correlation as a
  confound; it is not a causal fix.
- **Stop routing:** if reliability fails again at the second addition with the
  display held on, the next task is a causal investigation of that stage, not
  another gate.

## Changes

| File | Change |
| --- | --- |
| [`acceptance-gate.mjs`](../scripts/po-cart-worker/acceptance-gate.mjs) | Gate root is now `full-offline-acceptance-task-20261021`. The consumed October 14 root is listed in `consumedGateRoots`, and `createGateInvocation` refuses it under any spelling before writing. `gatePolicy` is unchanged because the paid-allowance check binds to it. The 21 steps, their order and every inspection threshold are unchanged. |
| [`po-cart-ai-gate.mjs`](../scripts/po-cart-ai-gate.mjs) | After preparation/freeze validation and before `task.json` exists, the runner requires `full-gate-audit.py before` to pass. A failure refuses without consuming the invocation. |
| [`full-gate-audit.py`](../scripts/po-cart-worker/full-gate-audit.py) | Uses the shared `open_readonly` helper. Adds fixed `capture` and `before` operations alongside the unchanged default `finish` audit. Refuses unknown operations and optimized execution. |

The new **`capture`** operation replaces the ad hoc private capture used on
October 14. It refuses the consumed root, an invoked root and a repeated
capture. It records:

- protected files under `po-cart-workers` (excluding `browser-profiles`,
  `modules` and the gate root), `cart-ai-budget` and `cart-ai-evaluation`, plus
  the October 14 extras, which are recorded as absent when missing;
- cart fixtures;
- every `*.sqlite` under `.wrangler/state` and `.sites-runtime`, with a pinned
  `database-inventory.json`;
- the source list and an empty rollback manifest.

**`finish`** keeps the October 14 rules. Historical rows may never be removed or
changed. Additions are recorded, and only `_cf_METADATA` and the credential-event
sequence count as bookkeeping. `finish` now also requires the pinned inventory and
that no captured database has disappeared.

**`before`** requires the published [observation baseline](C4_OBSERVATION_BASELINE_RUN_20261021.md)
to still hold. That means a complete passing report, a fingerprint hash that is
consistent with its file, idle preflight, historical PIDs absent, all 46 locks
exact, the retained singleton, and a current complete fingerprint identical to
the baseline.

## Verification

The [new focused suite](../tests/po-cart-full-gate-audit.mjs) runs the real
auditor functions against temporary SQLite and file fixtures. It covers:

- capture of a nested review database and a sidecar-less WAL copy;
- protected-scope exclusions and absent extras;
- capture refusal on repeat, after invocation and for the consumed root;
- clean and added-row audits, and regenerated `modules`;
- refusal of changed, removed or lost rows and databases, protected-file
  changes, created absent extras, cart changes and inventory tampering;
- `before` pass and refusal on drift, non-idle state, an unpublished or tampered
  baseline and reappearance;
- operation and optimization refusal.

The [existing gate suite](../tests/po-cart-full-offline-gate.mjs) now pins the
new root, the consumed root, the unchanged policy and refusal of the consumed root.

Planted defects for row loss, baseline drift, narrowed database scope and plain
`mode=ro` opening were each caught. Removing the "captured database removed"
check went undetected, because a missing database already fails when it is
opened. That check is kept as defence in depth.

| Command | Result |
| --- | --- |
| `pnpm test po-cart-full-gate-audit po-cart-full-offline-gate` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **110 suites** |
| `pnpm build` | Passed |

`db:check`, `db:migrate:local` and `test:local` are not claimed here; G2's
six-command preparation runs them. The new gate root was absent before and after
verification. The consumed October 14 `task.json` was unchanged.

A read-only live dry run of `before` passed. The baseline `8ee75de7…` still holds
exactly: 353,361 identical entries, idle, 46 exact locks. There are currently 118
databases. Nothing was written.

### Root-assertion correction

G2's first preparation failed at `pnpm test`. The new suite asserted that the
real gate root was absent, which is false during preparation, and would also be
false during the gate's own `test` step. The suite now asserts only that it
leaves the root's listing and modification times unchanged. With the root
present, the three affected suites passed. The failed preparation consumed no
invocation (`task.json` was never created). It is retained unchanged at
`.sites-runtime/po-cart-workers/full-offline-acceptance-superseded-preparation-20261021/`.

## G2 procedure (separately authorized)

1. Prepare the new root with the six-command pipeline, using the October 14
   pattern of a frozen source, private logs, `pipeline-final.json`,
   `freeze.json` and the real-provider denial import.
2. Run `python3 -I -B scripts/po-cart-worker/full-gate-audit.py capture`. Run it
   after the pipeline, because `test`/`test:local` add records.
3. Dry-run `finish` against the capture. Stop if any protected file the pipeline
   regenerates would fail it.
4. Invoke `caffeinate -di pnpm cart:browser-worker:gate:ai` once.

All inference stays mocked and the stop rule is unchanged.

Rollback reverts this branch's commit. The consumed October 14 root, the
observation baseline and all runtime state are untouched.
