# C4 fresh full offline gate run (G3) — 2026-10-22

This is the one authorized invocation of the [rebound gate](C4_FULL_GATE_REBINDING_20261022.md),
run by the owner under `caffeinate -di`. **Result: steps 1–20 passed, then the run
stopped at step 21 of 21 (`cart:manager:check:launcher`, exit 1). All final
audits passed. C4/M8 remain open.**

All inference was mocked. The run used a fictional key and the real-provider
denial import, and made zero real requests. No supplier access, checkout,
purchase, deployment, hosted-data change or power-setting change occurred.
Private evidence is retained at
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261022/`.

## Preparation

The first preparation was retired uninvoked after the CI portability correction;
see the [rebinding record](C4_FULL_GATE_REBINDING_20261022.md#ci-portability-correction).
The second preparation passed all six commands (**110 suites**). The frozen source
was **595 files**, `5fe60fd7…`, and the gate's validator accepted it.

Before invocation:

- `capture` recorded 25,688 protected artifacts, 548 carts and 196 databases;
- a scratch `finish` dry run passed;
- the `before` check passed: baseline `8ee75de7…` holds, the 32,366 changed
  entries are all inside G2's 133 recorded profiles, preflight is idle and 46
  locks are exact.

## Outcome

The gate ran from 23:18:27Z on 2026-10-22 to 00:13:29Z on 2026-10-23.

| Step | Result |
| --- | --- |
| 1 — Metadata | Passed |
| 2 — Reliability | **30/30 ready** |
| 3–4 — Served off/passive | Matrix passed in both modes |
| 5 — AI safety | 50 cases passed |
| 6–8 — Faults off/passive/form | Injected faults held; no duplicate addition or incorrect readiness |
| 9–14 — Pipeline | All six commands passed |
| 15 — `cart:browser-worker:check` | **Passed.** This is the first real-browser confirmation of the [cleanup repair](C4_FULL_OFFLINE_GATE_RUN_20261021.md#repair--2026-10-21) |
| 16–20 | HTTP browser worker, cart, manager UI, browser session and reconciliation checks passed |
| 21 — `cart:manager:check:launcher` | **Stopped**, exit 1 |

Reliability again passed with the display held on. That is **not a causal
finding**, and the agreed investigation rule (a repeat second-addition failure)
did not trigger.

## Step 21 observations (cause not established)

The gate's safe-log filter retained no lines from this check, so the error text
is not preserved. The child process and its group were cleaned up and verified.
The retained private fixture root and file times show the following.

1. **20:08:52–20:09:29 local.** The launcher started, and the fictional cart was
   prepared and verified. The automation journal holds 3 calls with 0 external
   requests and 0 checkout submissions. The visible inspection browser then
   opened and closed, leaving no pending human journal.
2. **About 20:09:56–58.** Both worker credential files were reissued. This
   indicates that the graceful stop asserted exit 0 and the launcher restarted.
3. **20:10:07.** The step exited, about 9 seconds after the restart. That is too
   early for any of the check's 15–60 s timeouts.

The failure therefore lies in one of the post-restart assertions or in the final
cleanup:

- the post-restart assertions cover identity, cart, journal and secret absence;
- the final cleanup covers credential revocation, the HTTP 401 check and a
  second graceful stop that must exit 0.

This check last ran successfully on October 13. Since then, `a897ce3` changed
three things:

- the launcher now verifies its app cleanup and exits 1 when that fails;
- credential rotation now verifies prior revocation;
- the check now uses a confined browser context.

These are leads, not findings. No retry or re-run occurred.

## Final audits

All independent audits passed:

- **Credentials:** 179 revoked, with HTTP 401 checks.
- **Processes:** 198 task profiles and all process groups clear, with ports free.
- **Consumption:** 21 consumed steps match the results.
- **Evidence:** every reference is unchanged.
- **Preservation:** 25,688 artifacts and 548 carts unchanged. Across 196
  databases no historical row was removed or changed. There were 5,822 added
  fictional and smoke rows. Bookkeeping changed in two `_cf_METADATA` row states
  and one credential-event sequence.

The report keeps `passed: false`, `status: stopped`. The invocation is permanently
consumed.

## Next

1. **Investigate step 21** (needs authorization). Reproduce
   `cart:manager:check:launcher` with its full output in an isolated clean clone
   that has its own `.sites-runtime`. Real profiles, locks and evidence then stay
   untouched and the pre-gate baseline is not disturbed. Then repair, with a
   regression test.
2. **Rebinding.** Consume `…-20261022`; its 198 recorded profiles qualify under the
   audited gate-profile rule. Then bind a new root.
3. **Then a separately authorized fresh gate.**

Both earlier consumed roots, the retired preparation and the observation baseline
remain retained. This gate does not close C4/M8. Real-model, hosted, supplier,
pilot and production evidence remain separate.
