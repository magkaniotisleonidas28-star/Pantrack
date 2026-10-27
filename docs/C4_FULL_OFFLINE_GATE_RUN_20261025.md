# C4 fresh full offline gate run (G5) — 2026-10-25

This is the one authorized invocation of the
[G5 rebinding](C4_FULL_OFFLINE_GATE_RUN_20261024.md#rebinding-for-g5), run by the
owner under `caffeinate -di` on AC power. **Result: all 21 steps passed and all
final audits passed. The gate's report records `passed: true`.**

This is local, mocked-provider evidence only. All inference was mocked. The run
used a fictional key and the real-provider denial import, and made zero real
requests. No supplier access, checkout, purchase, deployment, hosted-data change
or power-setting change occurred. Private evidence is retained at
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261025/`.

The gate's fixed status is `fresh complete offline gate passed; original cause
unresolved`. The original cause it refers to is the
[second-addition timeout](C4_SECOND_ADDITION_DIAGNOSIS_20261014.md), which this
pass does not explain. **C4/M8 remain open**, and no checkbox advances. C4 still
needs the signed-in PDF/XLSX integration, scheduler/job, alerts, budget policy
and supplier acceptance work listed in the roadmap.

## Preparation

The frozen six-command preparation passed (**113 suites**). The frozen source was
**605 files**, `4e986126…` (commit `a442f7c`, including the
[step-21 revocation-order repair](C4_FULL_OFFLINE_GATE_RUN_20261024.md#repair)),
and the gate's validator accepted it.

Before invocation:

- `capture` recorded 36,481 protected artifacts, 718 carts and 424 databases;
- a scratch `finish` dry run passed, with the gate root listing unchanged;
- the `before` check passed:
  - baseline `8ee75de7…` holds;
  - the 46 historical locks are exact;
  - G3's and G4's 8 gate-left locks are accounted;
  - the 128,887 changed entries are all inside 527 recorded profiles;
  - preflight is idle.

## Outcome

The gate ran from 20:23:52Z to 21:11:27Z on 2026-10-25. Every step exited 0, and
the source snapshot was unchanged before and after each step.

| Step | Result |
| --- | --- |
| 1 — Metadata | Passed |
| 2 — Reliability | **30/30 ready**, with 0 external requests and 0 checkout submissions |
| 3–4 — Served off/passive | Matrix passed in both modes |
| 5 — AI safety | 50 cases passed |
| 6–8 — Faults off/passive/form | Injected faults held |
| 9–14 — Pipeline | All six commands passed |
| 15 — `cart:browser-worker:check` | Passed, including the cleanup repair |
| 16–20 | The HTTP browser worker, cart, manager UI, browser session and reconciliation checks passed |
| 21 — `cart:manager:check:launcher` | **Passed.** This is the first in-gate confirmation of both step-21 repairs: the detached restart and stopping before revocation |

Reliability again passed with the display held on. That is **not a causal
finding** about the second-addition timeout.

## Final audits

All independent audits passed:

- **Credentials:** 179 issued and 179 revoked, each checked for HTTP 401.
- **Processes:** 198 task profiles and all process groups clear, with ports free.
- **Consumption:** 21 consumed steps match the results.
- **Evidence:** every reference is unchanged.
- **Preservation:** 36,481 artifacts and 718 carts unchanged. Across 424
  databases no historical row was removed or changed. There were 5,819 added
  fictional and smoke rows. Bookkeeping changed in two `_cf_METADATA` row states
  and one credential-event sequence.

Steps 15 and 19 again left four crash-scenario worker locks, as expected. That
brings the total to 58: the 46 historical locks plus 4 each from G3, G4 and G5.
A later binding accounts for them under the existing rule.

The invocation is permanently consumed. The consumed roots, the observation
baseline and all runtime state are retained.

## What this proves and what it does not

- **Proved locally, with mocked providers:**
  - all 21 offline acceptance steps pass on one frozen source;
  - the steps include reliability, AI safety, fault injection, the complete
    pipeline and the real-browser worker, session, reconciliation and launcher
    checks;
  - historical data, processes and credentials were independently audited.
- **Not proved:**
  - the cause of the second-addition timeout;
  - real-model behavior;
  - hosted, sandbox, supplier, pilot or production behavior.

  Each of these keeps its own configuration, budget and authorization gate.

## Next

The full offline gate had no further step, and remaining C4 work went back to the
roadmap's separate outcomes.

On 2026-10-27 the owner asked to run the real-model test. The paid allowance
requires a passing gate on the **current** source, and later work (receiving,
weekly drafts, over-cap approval) changed it, so G5's report no longer validates.

## Rebinding for G6

The rebinding is source-only, under the same rules as
[G5's](C4_FULL_OFFLINE_GATE_RUN_20261024.md#rebinding-for-g5):

- `consumedGateRoots` and `CONSUMED` add `…-20261025`;
- the gate and audit bind `…-20261027`;
- the gate-root pins in both suites are updated.

`gatePolicy` (`metadata-repair-real-matrix-v1`), the 21 steps, every threshold, the
lock rule and the paid-allowance code are unchanged. G5's final audits all passed,
so its recorded profiles and worker locks count under the existing rule.

**Read-only live check:** `baseline_holds()` passed against the current state, with
every file-write path blocked in the process:

- baseline `8ee75de7…` holds, with preflight idle;
- the 46 historical locks are exact;
- **12 gate locks** (four each from G3–G5) are accounted;
- the 176,277 changed entries are all inside the **719 profiles** that G2–G5
  recorded.

The new root is absent.

**Checks:**

| Command | Result |
| --- | --- |
| `pnpm test po-cart-full-gate-audit po-cart-full-offline-gate po-cart-observation-baseline` | Passed (3 suites) |
| `pnpm typecheck`, `pnpm test`, `pnpm build` | Passed; **155 suites**; build complete |

`db:check`, `db:migrate:local` and `test:local` are not claimed here; the gate's
six-command preparation runs them on the frozen source.

## Next: G6, then the separately authorized paid matrix

1. **After this rebinding merges,** on the merged and then frozen source:
   - run the six-command preparation into the new root;
   - record `freeze.json`;
   - run `full-gate-audit.py capture`;
   - dry-run `finish` against the capture;
   - run the `before` check.

   **No merges** may happen from then until the paid matrix finishes, because any
   source change invalidates both the gate and the allowance.
2. **The owner invokes the gate once, on AC power:**
   `caffeinate -di pnpm cart:browser-worker:gate:ai`. All inference stays mocked.
3. **Only if G6 passes all 21 steps and the owner explicitly authorizes the paid
   run:**
   - create the single-use Metadata allowance from G6's report;
   - re-verify the model, settings and pricing against the
     [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
     within five minutes;
   - run `pnpm cart:browser-worker:evaluate` once: at most 72 requests, within the
     $5 cumulative ceiling, with about $4.08 conservatively remaining.

Rollback reverts this commit. Every consumed root, the observation baseline and all
runtime state are untouched. This gate does not close C4/M8. Real-model, hosted,
supplier, pilot and production evidence remain separate.
