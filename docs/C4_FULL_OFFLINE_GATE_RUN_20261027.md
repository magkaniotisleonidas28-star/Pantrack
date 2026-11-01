# C4 fresh full offline gate run (G6) — 2026-10-27

This is the one authorized invocation of the
[G6 rebinding](C4_FULL_OFFLINE_GATE_RUN_20261025.md#rebinding-for-g6), run by the
owner under `caffeinate -di` on AC power. **Result: all 21 steps passed, and the
final preservation audit failed. The gate's report records `passed: false`,
status `audit_failed`.** The real-model test therefore did not run.

This is local, mocked-provider evidence only. All inference was mocked. The run
used a fictional key and the real-provider denial import, and made zero real
requests. No supplier access, checkout, purchase, deployment, hosted-data change
or power-setting change occurred. Private evidence is retained at
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261027/`.

**C4/M8 remain open**, and no checkbox advances.

## Preparation

The frozen six-command preparation passed (**157 suites**) on merged main
`5f9df85`. The frozen source was **737 files**, `872ed39c…`, and the gate's
validator accepted it.

Before invocation:

- `capture` recorded 43,193 protected artifacts, 803 carts and 571 databases;
- a scratch `finish` dry run passed, with the gate root listing unchanged;
- the `before` check passed: baseline `8ee75de7…`, the 46 historical locks exact,
  12 gate locks accounted, 719 recorded profiles, and preflight idle.

## Outcome

The gate ran from 05:02:08Z to 05:51:00Z on 2026-10-27. Every step exited 0, and
the source snapshot was unchanged before and after each step.

| Step | Result |
| --- | --- |
| 1 — Metadata | Passed |
| 2 — Reliability | **30/30 ready**, with 0 external requests and 0 checkout submissions |
| 3–4 — Served off/passive | Matrix passed in both modes |
| 5 — AI safety | 50 cases passed |
| 6–8 — Faults off/passive/form | Injected faults held |
| 9–14 — Pipeline | All six commands passed |
| 15–21 | The browser worker, HTTP worker, cart, manager UI, browser session, reconciliation and launcher checks passed |

## Final audits

- **Credentials:** 179 issued and 179 revoked, each checked for HTTP 401.
- **Processes:** 198 task profiles and all process groups clear, with ports free.
- **Consumption:** 21 consumed steps match the results.
- **Evidence:** every reference is unchanged.
- **Preservation: failed** (`finish_failed`).

Steps 15 and 19 again left four crash-scenario worker locks, bringing the total
to 62: the 46 historical locks plus 4 each from G3 to G6.

## Diagnosis

A read-only rerun of the finish audit's comparisons, with writes disabled,
located the failure:

- **Unchanged:** all protected artifacts, all 803 carts, every source file, and
  every captured database and table, except the following.
- **One table differs:** in the cart-review database
  (`.sites-runtime/cart-review-state`), all 838 captured rows of
  `po_cart_budget_policies` no longer match their captured hashes. The
  `d1_migrations` sequence row changed too.

**Cause:** the cart-review database was at migration `0034` when it was captured.
At 05:02:09–10Z, during step 1, the cart preview applied `0035`–`0044`, as it does
on every start. `0035` adds six columns to `po_cart_budget_policies`, so every
existing row gained six null values and its hash changed. The **first four
columns of all 838 rows match their captured values exactly**; no value was lost
or altered, and the gate added 86 new fictional rows.

**Why preparation missed it:** since G5, served checks ran in an isolated clone, so
nothing migrated the main checkout's cart-review state. Preparation's
`db:migrate:local` migrates only `.wrangler/state`. The audit compares whole rows,
so it correctly refused a schema upgrade that happened inside the run.

The invocation is permanently consumed. Its root, the earlier consumed roots, the
observation baseline and all runtime state are retained. The cart-review database
now has all 45 migrations.

## Rebinding for G7

The paid allowance needs a passing gate on the current source. The rebinding
binds a fresh root and adds two audit rules.

**Binding:**

- `consumedGateRoots` and `CONSUMED` add `…-20261027`;
- the gate and audit bind `…-20261031`;
- the gate-root pins in both suites are updated.

**Migrated-state check (repair).** `capture` and the `before` check now refuse when
either state the gate migrates (`.wrangler/state` and
`.sites-runtime/cart-review-state`) is not at exactly the source's migrations. That
means a missing, extra or unrecorded migration, or none at all. An upgrade can no
longer rewrite captured rows inside a run.

**Owner-reviewed G6 profiles.** G6 failed an audit, so under the existing rule its
914 profiles and 4 new worker locks would count as unexplained, and the `before`
check refused. The owner chose on 2026-11-01 to account for G6 narrowly:

- `PRESERVATION_REVIEWED` names only G6's root;
- it pins the exact hashes of G6's `final-audit.json` and `preservation.json`;
- the gate's only failed audit must be preservation;
- its credential, cleanup, evidence and consumption audits must have passed, along
  with its process audit with profiles clear and the recorded profile count.

Every other gate still needs all final audits to pass, and the lock rule is
unchanged.

`gatePolicy` (`metadata-repair-real-matrix-v1`), the 21 steps, every threshold and
the paid-allowance code are unchanged.

**Read-only live check,** with every file-write path blocked in the process:

- **Migrated-state check:** both states have all 45 migrations.
- **`baseline_holds()`:**
  - baseline `8ee75de7…` holds, with preflight idle;
  - the 46 historical locks are exact;
  - **16 gate locks** (four each from G3–G6) are accounted;
  - the 223,696 changed entries are all inside the **914 profiles** that G2–G6
    recorded.

The new root is absent.

**Planted defects: 13 of 14 caught.**

- **Migrated-state check (7 of 7):** skipped in capture or in the pre-check; behind
  allowed; extra allowed; an unrecorded state allowed; only the first state
  checked; no migrations allowed.
- **Reviewed rule (6 of 7):** pins ignored; other audits ignored; the reviewed gate
  still needing a preservation pass; profiles-clear ignored; the rule never
  consulted; a different gate pinned.
- **The equivalent one:** dropping the "is pinned" test changes nothing, because an
  unpinned gate's hashes never equal a missing pin.

**Checks:**

| Command | Result |
| --- | --- |
| `node tests/po-cart-full-gate-audit.mjs`, `node tests/po-cart-full-offline-gate.mjs` | Passed |
| `pnpm typecheck`, `pnpm test`, `pnpm build` (isolated clean clone, on main `44cfb2b`) | Passed; **161 suites**; build complete |
| Prettier on the changed scripts, tests and record; `pnpm lint` | Formatted; lint unchanged from main (53 errors, 59 warnings, none in changed files) |

`db:check`, `db:migrate:local` and `test:local` are not claimed here; the gate's
six-command preparation runs them on the frozen source.

## Next: G7, then the separately authorized paid matrix

1. **After this rebinding merges,** on the merged and then frozen source:
   - confirm both migrated states have every migration;
   - run the six-command preparation into the new root;
   - record `freeze.json`;
   - run `full-gate-audit.py capture`;
   - dry-run `finish` against the capture;
   - run the `before` check.

   **No merges** may happen from then until the paid matrix finishes.
2. **The owner invokes the gate once, on AC power:**
   `caffeinate -di pnpm cart:browser-worker:gate:ai`.
3. **Only if G7 passes all 21 steps and every final audit, and the owner explicitly
   authorizes the paid run:** create the single-use Metadata allowance from G7's
   report, re-verify pricing within five minutes, and run
   `pnpm cart:browser-worker:evaluate` once (at most 72 requests, about $4.08
   conservatively remaining under the $5 ceiling).

Rollback reverts this commit. Every consumed root, the observation baseline and all
runtime state are untouched.
