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

The full offline gate has no further step. Remaining C4 work goes back to the
roadmap's separate outcomes. These include the other contributor's
server-authorized, revision-bound PDF/XLSX export snapshot and the signed-in
manager integration; this workstream does not overlap them. Choosing the next
C4 item is an owner decision.
