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

## Step 21 cause: harness restart race — 2026-10-24

The owner authorized an isolated reproduction. It ran in a clean clone of this
branch at `20359a8`, with its own `.sites-runtime`, fictional local data and ports
5181/5182. The gate root was not involved, and no real profile, lock, baseline or
evidence was touched. The gate was not re-run.

1. **The plain check failed on its first run** with the same exit 1. Its only
   message was `1 !== 0` from the final `launcher.stop()` in its `finally` block.
   No `PASS` line was printed, so an earlier failure had been replaced by the
   cleanup assertion.
2. **An uncommitted instrumented copy** printed the original error. It was
   `page.goto: net::ERR_ABORTED` on the first navigation after the graceful
   restart. That restart itself succeeded.
3. **A page-event trace showed the cause.** The page left open on the Vite dev
   server logged `[vite] server connection lost. Polling for restart...` at the
   stop. When the restarted server answered, the Vite 8.0.13 client called
   `location.reload()`. Both of that reload's requests and the check's `page.goto`
   ended in `ERR_ABORTED`.

The race reproduced in all three runs that reached the restart. The confined
browser context was not involved: it blocks with `ERR_BLOCKED_BY_CLIENT`, and only
non-local origins. This is a harness defect. Product behavior was not involved.

**Why the final stop exited 1 in the plain run is not established.** The
launcher's unverified app cleanup set exit code 1 without printing anything. A
second possibility was a supervisor poll racing credential revocation; it never
appeared in five runs. The repair makes the first possibility report its fixed
failure categories. G4 later showed the second cause: the check revoked the
supervisor's credential before stopping it. See the
[G4 record](C4_FULL_OFFLINE_GATE_RUN_20261024.md#step-21-cause-credential-revocation-before-the-final-stop).

**One clone run hit the open addition timeout instead.** The automation worker
journal recorded `browserFailure.stage: "addition"`, a 10 s response wait, 0
external requests, 0 checkout submissions and clean browser closure. That run
fell inside a display-off interval (13:20:23–13:22:04 local, on battery). Runs
with the display on passed. This is consistent with the
[display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md), but it is
**not a causal finding**.

### Repair

| File | Change |
| --- | --- |
| [`launcher-check-lifecycle.mjs`](../scripts/po-cart-worker/launcher-check-lifecycle.mjs) | New. `restartDetached` moves the page to `about:blank` before the graceful stop and never starts after a failed stop. `withCleanup` always runs cleanup and reports an `AggregateError` when both the check and its cleanup fail. |
| [`po-cart-manager-launcher-check.mjs`](../scripts/po-cart-manager-launcher-check.mjs) | Uses both. A failed stop now reports the exit code and the launcher's fixed status lines, which carry no credential or token. |
| [`po-cart-manager-preview.mjs`](../scripts/po-cart-manager-preview.mjs) | An unverified app cleanup now prints its fixed failure categories before exiting 1. |

The new [lifecycle suite](../tests/po-cart-launcher-check-lifecycle.mjs) models
the observed dev client. A naive restart aborts the post-restart navigation, and
the detached restart does not. The suite also covers order, a failed stop and all
four outcome combinations of `withCleanup`, and pins the check and the launcher.

Six planted defects were each caught:

1. no detach;
2. detaching after the stop;
3. restarting after a failed stop;
4. cleanup replacing the original failure;
5. a swallowed cleanup failure;
6. skipped cleanup.

| Command | Result |
| --- | --- |
| `pnpm test po-cart-launcher-check-lifecycle` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **111 suites** |
| `pnpm build` | Passed |
| `node scripts/po-cart-manager-launcher-check.mjs` in the isolated clone, under `caffeinate -di` | **Passed 3/3**, with no remaining process and ports free |

The gate's safe-log filter still drops non-`PASS` lines, so a future step failure
inside the gate would again be silent. It is part of the frozen gate runner and
was not changed.

## Gate-left worker locks (rebinding blocker)

A read-only `baseline_holds()` run after the repair refused before reaching the
profile comparison: `Worker locks/guards added or removed`. There are 50 locks
against the baseline's 46. Each of the four added locks:

- belongs to a G3-recorded profile;
- holds exactly the worker PID G3 recorded for it;
- names a process that is no longer running.

Three were written during step 15 and one during step 19. Those steps contain
three and one deliberate `SIGKILL` crash scenarios respectively. G2 stopped before
any of them. **Every full gate run therefore leaves such locks**, and the current
pre-check would refuse the next gate even after rebinding. The owner chose to
account for them; see the [rebinding record](C4_FULL_GATE_REBINDING_20261024.md).
Nothing was changed.

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

1. **Investigate step 21:** done on 2026-10-24. The cause is a harness restart
   race, now [repaired](#repair).
2. **Rebinding:** done on 2026-10-24. The owner chose to account for gate-left
   locks; see the [rebinding record](C4_FULL_GATE_REBINDING_20261024.md).
3. **Then a separately authorized fresh gate.**

Both earlier consumed roots, the retired preparation and the observation baseline
remain retained. This gate does not close C4/M8. Real-model, hosted, supplier,
pilot and production evidence remain separate.
