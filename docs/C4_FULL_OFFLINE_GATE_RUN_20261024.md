# C4 fresh full offline gate run (G4) — 2026-10-25

This is the one authorized invocation of the [G4 rebinding](C4_FULL_GATE_REBINDING_20261024.md),
run by the owner under `caffeinate -di` on AC power. **Result: steps 1–20 passed.
The run then stopped at step 21 of 21 (`cart:manager:check:launcher`, exit 1),
after that check's body had passed. All final audits passed. C4/M8 remain open.**

All inference was mocked. The run used a fictional key and the real-provider
denial import, and made zero real requests. No supplier access, checkout,
purchase, deployment, hosted-data change or power-setting change occurred.
Private evidence is retained at
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261024/`.

## Preparation

The frozen six-command preparation passed (**113 suites**). The frozen source was
**605 files**, `d466e576…` (commit `1177bbd`), and the gate's validator accepted it.

Before invocation:

- `capture` recorded 31,131 protected artifacts, 633 carts and 310 databases;
- a scratch `finish` dry run passed;
- the `before` check passed:
  - baseline `8ee75de7…` holds;
  - the 46 historical locks are exact;
  - G3's 4 gate-left locks are accounted;
  - the 80,692 changed entries are all inside 329 recorded profiles;
  - preflight is idle.

## Outcome

The gate ran from 18:46:41Z to 19:33:52Z on 2026-10-25.

| Step | Result |
| --- | --- |
| 1 — Metadata | Passed |
| 2 — Reliability | **30/30 ready**, with 0 external requests and 0 checkout submissions |
| 3–4 — Served off/passive | Matrix passed in both modes |
| 5 — AI safety | 50 cases passed |
| 6–8 — Faults off/passive/form | Injected faults held |
| 9–14 — Pipeline | All six commands passed |
| 15–20 | The browser worker (including the cleanup repair), HTTP worker, cart, manager UI, browser session and reconciliation checks passed |
| 21 — `cart:manager:check:launcher` | **Stopped**, exit 1 |

Reliability again passed with the display held on. As before, this is **not a
causal finding** about the second-addition timeout.

## Step 21 cause: credential revocation before the final stop

The new [failure summary](C4_FULL_GATE_REBINDING_20261024.md#failuresummary)
recorded:

```text
FAILURE summary: exit=1 kinds=AssertionError codes=ERR_ASSERTION timeoutsMs=
at=scripts/po-cart-manager-launcher-check.mjs:18,scripts/po-cart-manager-launcher-check.mjs:51,
scripts/po-cart-worker/launcher-check-lifecycle.mjs:12,scripts/po-cart-manager-launcher-check.mjs:22 cleanup=
```

The summary is wrapped here for readability; in the log it is a single line.

1. **The check body passed.** The only error was the cleanup's final
   `launcher.stop()`, at line 51 and then line 18, asserting exit 0. There was
   no `AggregateError`, so no body failure was replaced. The
   [step-21 restart repair](C4_FULL_OFFLINE_GATE_RUN_20261022.md#repair) held: the
   restart (credentials reissued at 15:31:45–46 local) and every post-restart
   assertion passed.
2. **The launcher exited 1 through its discovery catch.** It printed no cleanup
   category, which rules out the unverified-app-cleanup path
   (`po-cart-manager-preview.mjs:52`). The only remaining exit-1 path is the catch
   at line 49.
3. **What reaches that catch.** The supervisor polls discovery about every
   second using `credentialFiles[0]`, and it throws on any non-OK response
   (`manager-supervisor.mjs:30`, `:43`). The check's cleanup revoked that
   credential, checked HTTP 401 and only then stopped the launcher. A poll in
   that window stops the launcher, which then reports exit 1.

This is the exit 1 that the step-21 reproduction left unexplained. It is a harness
ordering defect. Product behavior was not involved: a launcher whose credential is
revoked should stop.

### Isolated confirmation

The owner authorized this confirmation. It ran in the clean clone at `1177bbd`,
with its own `.sites-runtime`, fictional data and ports 5181/5182. No gate root,
real profile, lock or baseline was involved.

| Case | Result |
| --- | --- |
| Control: start, then a graceful stop | Exit 0, no status line |
| Revoke `credentialFiles[0]`, wait 3 s, then stop | Revocation status 0 and HTTP 401. **The launcher had already exited before the stop**, with exit 1 and `Local manager demo stopped. …` |

### Why "stop first, then revoke" alone is not enough

In gate mode, `fixtureCredential` `revoke` also calls `verifyGateRevocation`
(`credentials.mjs:17`). That function needs an app answering on 5181 that returns
401. So revocation needs a running app, and the supervisor must not be running.

## Repair

| File | Change |
| --- | --- |
| [`launcher-check-lifecycle.mjs`](../scripts/po-cart-worker/launcher-check-lifecycle.mjs) | New `stopThenRevoke`, described below. |
| [`po-cart-manager-launcher-check.mjs`](../scripts/po-cart-manager-launcher-check.mjs) | New `startApp`, described below. The cleanup uses `stopThenRevoke`, and each revocation asserts status 0 and HTTP 401. The check now verifies HTTP 401 for every credential, including after a body failure; before, it only did so while the launcher was still running. |

**`stopThenRevoke`** runs these steps in order:

1. stops the launcher. It must exit 0.
2. starts the app alone, only if there are credential files;
3. attempts every revocation, even after an earlier failure;
4. always stops the app.

A single failure is rethrown as it is. Several are reported as one `AggregateError`.

**`startApp`** starts the launcher's own app, `po-cart-browser-worker-preview.mjs`,
without its supervisor:

- it first runs the launcher's free-port probe;
- it registers the child for the gate's process audit;
- it uses the launcher's readiness check;
- it stops the app through the verified `cleanupPreview`, and a failed start
  still runs that cleanup.

The product launcher and supervisor are unchanged.

The [lifecycle suite](../tests/po-cart-launcher-check-lifecycle.mjs) models the
observed launcher: the supervisor polls with the first credential and stops itself
and its app once that credential is revoked, and revocation needs a running app.

- **Control:** revoking first stops the launcher before the second revocation,
  and the later stop then reports exit 1.
- **Repaired order:** `stop → app start → revoke one → revoke two → app stop`, and
  both credentials are revoked.
- **Failure handling:**
  - a failed stop still revokes every file;
  - with no launcher, every file is still revoked;
  - with no files, no app is started;
  - a failed revocation still attempts the rest and stops the app;
  - multiple failures are reported together;
  - a failed app start revokes nothing and reports both failures.
- **Static pins:** the new cleanup call, the absence of the old revoke-then-stop
  forms, the port probe before the spawn, gate child registration, cleanup after
  a failed start, and the status-0 and HTTP 401 assertions inside each revocation.

Ten planted defects were tried. **Nine were caught:**

1. revoking before the stop;
2. a failed stop skipping revocation;
3. the first revocation failure skipping the rest;
4. starting the app with no files;
5. a swallowed app-cleanup failure;
6. skipping the launcher stop in the check;
7. no port probe, caught after the pin was tightened (it first survived);
8. no 401 check;
9. a failed start leaving the app.

The tenth, removing the `finally` around the app stop, is an **equivalent
mutant**. Every revocation failure is already caught per file, so nothing can skip
the stop. The `finally` stays as a safeguard.

| Command | Result |
| --- | --- |
| `pnpm test po-cart-full-gate-audit po-cart-full-offline-gate po-cart-observation-baseline po-cart-launcher-check-lifecycle` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **113 suites** |
| `pnpm build` | Passed |
| `git diff --check` | Passed |
| `node scripts/po-cart-manager-launcher-check.mjs` in the isolated clone, under `caffeinate -di` | **Passed 3/3**, with no remaining process and ports free |

The isolated runs were not in gate mode, so `verifyGateRevocation` itself did not
run there. It requests the same endpoint and expects the same 401 that each
revocation in the check now asserts against the app it started.
`db:check`, `db:migrate:local` and `test:local` are left to the next gate's
six-command preparation.

## Final audits

All independent audits passed:

- **Credentials:** 179 issued and 179 revoked, each checked for HTTP 401.
- **Processes:** 198 task profiles and all process groups clear, with ports free.
- **Consumption:** 21 consumed steps match the results.
- **Evidence:** every reference is unchanged.
- **Preservation:** 31,131 artifacts and 633 carts unchanged. Across 310
  databases no historical row was removed or changed. There were 5,819 added
  fictional and smoke rows. Bookkeeping changed in two `_cf_METADATA` row states
  and one credential-event sequence.

Steps 15 and 19 again left four crash-scenario worker locks, as expected. That
brings the total to 54: the 46 historical locks, 4 from G3 and 4 from G4.

The report keeps `passed: false`, `status: stopped`. The invocation is permanently
consumed.

## Rebinding for G5

The rebinding is source-only, under the same rules as
[G4's](C4_FULL_GATE_REBINDING_20261024.md):

- `consumedGateRoots` and `CONSUMED` add `…-20261024`;
- the gate and audit bind `…-20261025`;
- the gate-root pins in both suites are updated.

`gatePolicy`, the 21 steps, every threshold and the lock rule are unchanged. G4's
final audits all passed, so its recorded profiles and worker PIDs count under the
existing rule.

A read-only live `baseline_holds()`, with writes blocked, passed:

- baseline `8ee75de7…` holds, with preflight idle;
- the 46 historical locks are exact;
- **8 gate locks** are accounted;
- the 128,887 changed entries are all inside the **527 profiles** that G2–G4
  recorded.

The new root is absent.

## Next

1. **A separately authorized fresh gate (G5).** Run the frozen six-command
   preparation, `capture`, a scratch `finish` dry run and the `before` check, then
   invoke `caffeinate -di pnpm cart:browser-worker:gate:ai` once.
2. All inference stays mocked, and the stop rule is unchanged. A repeat
   second-addition failure routes to causal investigation.

Rollback reverts this commit. Every consumed root, the observation baseline and all
runtime state are untouched. This gate does not close C4/M8. Real-model, hosted,
supplier, pilot and production evidence remain separate.
