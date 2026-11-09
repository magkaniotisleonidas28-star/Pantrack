# C4 full offline gate (G10), frozen-tab recovery and G11 binding — 2026-11-08

This records the one authorized invocation of the
[G10 binding](C4_FULL_OFFLINE_GATE_RUN_20261104.md#g10-binding), the owner-approved
diagnosis of its step-15 stall, the recovery that diagnosis supports, and the
G11 binding. **Result: G10 stopped at step 15 of 21. Every final audit passed.**
The paid matrix was not authorized or run.

Local evidence only, with mocked inference and zero real requests. No supplier
access, checkout, purchase, deployment or hosted-data change occurred. **C4/M8
remain open**, and no checkbox advances.

## G10 outcome

**Source:** merged main `a545d06`, frozen at 754 files, `db0e0b81…`. Preparation
passed all six commands (162 suites). The capture recorded 60,906 protected
artifacts, 1,124 carts and 1,107 databases. The `before` check passed with
baseline `8ee75de7…`, 46 historical locks exact, 26 gate locks accounted, and
1,464 gate profiles and the 30 reviewed profiles accounted.

The owner ran it from 2026-11-07 03:08:54Z to 03:42:39Z, on AC power.

- **Steps 1–14 passed.**
- **Step 15, `cart:browser-worker:check`, exited 1** at
  `po-cart-browser-worker-check.mjs:213`.
  - The case was the deterministic `rows/malicious` scenario, which has no AI
    reader.
  - The worker recorded two additions, then failed at the `catalog` stage, so the
    job was held as `review_needed` where `ready` was expected.
  - There were 0 external requests and 0 checkout submissions. Driver, browser and
    proxy all closed, with 0 cleanup errors.
- **Final audits, all passed:**
  - 113 credentials issued and revoked, each checked for HTTP 401;
  - 134 task profiles clear, with ports free;
  - consumption and evidence verified;
  - preservation: 60,906 artifacts and 1,124 carts unchanged. Bookkeeping changed
    in two `_cf_METADATA` rows and one sequence row.

G10 left no new locks. Its profiles are accounted under the existing rule because
every final audit passed.

## Diagnosis

On the owner's approval, each step ran outside the main checkout, in a separate
Desktop copy of `a545d06` with retained failure messages. A round is one full
`cart:browser-worker:check`. Before any recovery, 11 of 263 rounds had a stall
(about 1 in 24, or about 1 in 4,400 page loads).

| Step | Rounds | Finding |
| --- | --- | --- |
| Reused vs brand-new browser profiles | 12 + 12 | 2 of 12 had a timeout either way. Accumulated profile data is ruled out. |
| Request and event-loop logging | 23 | One `GET /catalog` got no reported load within 10 s. The Mac was idle, and the worker's event-loop lag was at most 6 ms. |
| Per-hop logging (relay, interception, practice store) | 72 | Relay and store answered in about 17 ms, and the browser then asked for `/favicon.ico`. Playwright never reported the load. |
| Same-tab retry | forced + natural | Forced cases passed, but a natural stall lost the retry too. Rejected. |
| Icon removed (`data:` icon) | 72 | 0 favicon requests, and 3 stalls still happened. The icon theory is refuted. |
| Probe of a stuck tab | 72 | Both stalls: the stuck tab's `evaluate` and a raw CDP `Runtime.evaluate` timed out at 5 s, and a new `connectOverCDP` timed out at 10 s. **A new tab in the same browser loaded `/catalog` in about 0.7 s with 3 items.** |

**Conclusion:** a rare Chrome tab freeze under Playwright CDP control. The tab
stops answering while the same browser keeps working. It is not Pantrack's relay,
interception, store, data or machine load. The cause inside Chrome is not fixed
here.

## Fresh-tab recovery

The browser session may move **once per job** to a fresh tab in the same context.
Cookies and request interception belong to the context, so they carry over. The
frozen tab is closed.

- **Read-only pages:** the practice session link, the catalog and the cart open
  once more in the fresh tab after a page-load timeout.
- **After an addition:** recovery happens only when the store has already answered
  this one addition with `303` to `/cart`. The fresh tab then reads the cart, and
  the existing exact verification decides. **The addition is never resubmitted.**
  Any other addition outcome is held as before.
- **A second stall in the same job,** or any other error, is held as today.
- **Recording:** each recovery adds `{jobId, stage}` to the worker journal's
  `freshTabs` and emits the allowlisted `fresh_tab` diagnostic event. The second-
  addition investigation accepts that event.

**Real-browser check:** `cart:browser-worker:check` gains four cases. In each, the
practice store answers one chosen page request after 11 s, beyond the worker's
10 s wait:

- a stall on the first page;
- a stall on a later catalog page;
- a stall on the cart page after an addition. The check asserts exactly three
  `POST /add` requests and exact pack counts;
- two stalls in one job. The second is held for review after one addition.

**Evidence outside the gate:**
- **Forced stalls:** in the Desktop copy, the three forced cases (launch, later
  catalog, after addition) each recovered, with the check exiting 0.
- **Side by side:** three copies at once ran 75 rounds with the recovery. All
  passed, with no natural stall in that window.

**A natural freeze has not yet been observed being recovered.** By owner decision,
G11 is the final test.

## G11 binding

- `consumedGateRoots` and `CONSUMED` add `…-20261105`, and the gate and audit bind
  `…-20261108`. Paid allowances are unchanged.
- **Read-only live check,** with writes blocked: `baseline_holds()` passed with
  baseline `8ee75de7…`, 46 historical locks exact, 26 gate locks accounted, and
  1,596 gate profiles and the 30 reviewed profiles accounted.
- The migrated-state check was skipped for that run only. The main checkout's
  local states do not yet include merged migration `0045`, and preparation's
  `pnpm db:migrate:local` applies it.

## Next

1. **After this merges:** G11 preparation on the frozen merged source, including
   migration `0045`. No merges until the paid run finishes.
2. **The owner invokes G11 once, on AC power.**
3. **Only if G11 passes everything:**
   - start the loopback services;
   - check the paid build;
   - ask for fresh explicit authorization for the one remaining matrix.
4. **If step 15 stalls despite recovery,** stop gating and review the retained
   `freshTabs` and failure stage first.

Rollback reverts this commit. The consumed roots, the allowances, the observation
baseline, the profiles and the ledger are untouched.
