# C4 full offline gate (G9) and G10 binding — 2026-11-05

This is the one authorized invocation of the
[G9 binding](C4_AVAILABILITY_EVIDENCE_20261104.md#g9-binding), run by the owner
under `caffeinate -di` on AC power. **Result: G9 stopped at step 15 of 21. Every
final audit passed.** The paid matrix was not authorized or run.

Local evidence only, with mocked inference and zero real requests. No supplier
access, checkout, purchase, deployment or hosted-data change occurred. **C4/M8
remain open**, and no checkbox advances.

## Preparation

**Source:** on merged main `fce425d`, the frozen six-command preparation passed
(**162 suites**). The frozen source was **754 files**, `1ba991c1…`, and the gate's
validator accepted it.

**Before invocation:**

- the migrated-state check passed, with both states at all 45 migrations;
- `capture` recorded 59,082 protected artifacts, 1,070 carts and 979 databases;
- a scratch `finish` dry run passed, with the gate root listing unchanged;
- the `before` check passed:
  - baseline `8ee75de7…`, with the 46 historical locks exact;
  - 24 gate locks accounted;
  - 1,302 gate profiles and the 30 owner-reviewed profiles accounted.

## Outcome

The gate ran from 03:51:56Z to 04:28:55Z, with the source unchanged before and
after each step.

**Steps 1–14 passed:** metadata, 30/30 reliability, both served modes, 50 AI-safety
cases, the three fault modes and the six pipeline commands.

**Step 15, `cart:browser-worker:check`, exited 1** at
`po-cart-browser-worker-check.mjs:412`. That case is the deterministic
`final-baseline_changed` scenario, which has no AI reader. Its expectation is three
additions, after which the hook changes the cart.

- The job recorded two additions.
- Before the third, the worker failed at the `catalog` stage. Under the gate, the
  message is reduced to `Browser preparation failed.`
- The job was held, with 0 external requests and 0 checkout submissions. Driver,
  browser and proxy all closed, with no cleanup errors.
- The hook had not yet run, so the cart change did not cause the failure.

**What is known:**

- Neither this check nor the browser adapter changed since G8. G5–G8 all passed
  step 15.
- The catalog stage waits up to 10 seconds each for the cart and catalog pages to
  reach network idle.
- The cause is unresolved. The gate retains no message text, so this is the same
  family of unattributed addition-stage stalls as the
  [second-addition timeout](C4_SECOND_ADDITION_DIAGNOSIS_20261014.md), not a
  diagnosed repeat of it.

**Final audits, all passed:**

- **Credentials:** 113 issued and 113 revoked, each checked for HTTP 401.
- **Processes:** 165 task profiles clear, with ports free.
- **Consumption and evidence:** both verified.
- **Preservation:** 59,082 artifacts and 1,070 carts unchanged, and no historical
  row removed or changed. Bookkeeping changed in two `_cf_METADATA` rows and one
  sequence row.

G9 left two crash-scenario locks, bringing the gate locks to 26.

## Repetition outside the gate

The owner approved a bounded measurement. `cart:browser-worker:check` was run
repeatedly in an isolated clean clone of `fce425d`, outside the main checkout.
There, failure messages are retained and the main checkout's profiles are
untouched.

- **7 valid runs, all passed,** in 226–229 seconds each. Every retained failure was
  an expected scenario outcome.
- **Run 8 and later of the second batch are invalid.** macOS temporary-file cleanup
  removed older files from the clone mid-batch. Run 7 then failed with
  `ENOENT … drizzle/0000_amused_ben_grimm.sql`, and later runs found no
  `package.json`. These are environment failures and are not counted.
- **Overall, the stall is rare:** one stall in about 12 executions of this check
  since October, counting gates G5–G9 and these runs. It was not reproduced, so no
  message or cause was captured.

## G10 binding

- `consumedGateRoots` and `CONSUMED` add `…-20261104`, and the gate and audit bind
  `…-20261105`. G9's audits all passed, so it accounts for its profiles and locks
  under the existing rule.
- The paid allowances are unchanged. The next allowance is still
  `metadata-repair-acceptance-20261104/allowance.json`, which has not been
  created.

**Read-only live check,** with writes blocked:

- the migrated-state check passed;
- `baseline_holds()` passed: baseline `8ee75de7…`, 46 historical locks exact, 26
  gate locks accounted, and 1,464 gate profiles and the 30 reviewed profiles
  accounted.

## Next

1. **After this merges:** G10 preparation on the frozen merged source. No merges
   until the paid run finishes.
2. **The owner invokes G10 once, on AC power.**
3. **Only if G10 passes everything:**
   - start the loopback application and storefront;
   - check the paid build;
   - ask for fresh explicit authorization for the one remaining matrix.
4. **If step 15 stalls again,** stop gating. Diagnose the catalog-stage stall with
   retained messages first.

Rollback reverts this commit. The consumed roots, the allowances, the observation
baseline, the profiles and the ledger are untouched.
