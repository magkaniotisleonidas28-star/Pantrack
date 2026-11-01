# C4 full offline gate (G7) and first paid-run attempt — 2026-11-01

This is the one authorized invocation of the
[G7 rebinding](C4_FULL_OFFLINE_GATE_RUN_20261027.md#rebinding-for-g7), run by the
owner under `caffeinate -di` on AC power, and the owner-authorized paid real-model
run that followed. **Result: G7 passed all 21 steps and every final audit. The
paid run stopped at its first step, before any provider request.**

Local evidence only. G7's inference was mocked, with zero real requests. The paid
attempt made **zero** provider requests and reserved nothing: the budget ledger
still holds 60 reservations totalling $0.921518, the last on 2026-10-14. No
supplier access, checkout, purchase, deployment, hosted-data change or
power-setting change occurred. **C4/M8 remain open**, and no checkbox advances.

## G7

**Preparation:** on merged main `6b21274`, the frozen six-command preparation passed
(**161 suites**). The frozen source was **752 files**, `524b4821…`, and the gate's
validator accepted it.

Before invocation:

- the new migrated-state check passed, with both states at all 45 migrations;
- `capture` recorded 48,375 protected artifacts, 888 carts and 701 databases;
- a scratch `finish` dry run passed, with the gate root listing unchanged;
- the `before` check passed: baseline `8ee75de7…`, the 46 historical locks exact,
  16 gate locks accounted, and 914 recorded profiles including G6's owner-reviewed
  ones.

**Outcome:** the gate ran from 05:50:37Z to 06:39:55Z. Every step exited 0, with the
source unchanged before and after each step:

- 30/30 reliability ready, with 0 external requests and 0 checkout submissions;
- 50 AI-safety cases passed;
- the faults, pipeline and browser checks all passed.

The status reads `fresh complete offline gate passed; original cause unresolved`
(the [second-addition timeout](C4_SECOND_ADDITION_DIAGNOSIS_20261014.md)).

**Final audits, all passed:**

- **Credentials:** 179 issued and 179 revoked, each checked for HTTP 401.
- **Processes:** 198 task profiles clear, with ports free.
- **Consumption and evidence:** both verified.
- **Preservation:** 48,375 artifacts and 888 carts unchanged, and no historical row
  removed or changed across 701 databases. Bookkeeping changed in two
  `_cf_METADATA` rows and one sequence row.

Steps 15 and 19 left four crash-scenario locks, bringing the total to 66.

## Paid-run attempt

The owner then explicitly authorized the paid run. In order:

1. The [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
   was checked: snapshot `gpt-5.4-mini-2026-03-17`, $0.75 input and $4.50 output
   per million tokens, reasoning `none` supported, and no deprecation notice.
2. The single-use allowance was created at 06:42:14Z from G7's report.
3. `pnpm cart:browser-worker:evaluate` started immediately.

It stopped before preflight with `No source files found for frozen-source gate.`

**Cause:**

- The command bundles `ai-evaluate.ts` into
  `.sites-runtime/po-cart-workers/ai-evaluate.mjs`.
- Since 2026-10-20, `ai-evaluate.ts` imports `second-addition-case.mjs`, which
  imports `local-browser-fixture.mjs`, which imports `sites-env.mjs`. The bundle
  therefore inlined `sites-env.mjs`.
- That module changes directory to `new URL('../', import.meta.url)`. From the
  generated module that is `.sites-runtime/`, where Git lists no source files, so
  the snapshot refused.
- The command's own comment warned that the seeder must stay unbundled.

**Why the gates missed it:** the offline metadata check bundles to
`.sites-runtime/ai-metadata-check.mjs`. One directory deep, the same wrong
calculation happens to land on the repository. The paid command's real build was
never exercised after 2026-10-20; the last paid run was on 2026-10-14.

The allowance is left `authorized`, never consumed. Its pricing check has expired,
so it can never validate again. By design it cannot be overwritten.

## Repair

**Build:**

- New [`evaluation-build.mjs`](../scripts/po-cart-worker/evaluation-build.mjs) is the
  one build of the paid evaluation.
- An esbuild resolver keeps `local-browser-fixture.mjs` and `sites-env.mjs`
  external, as absolute file URLs, so they load from their real files.
- `po-cart-ai-evaluate.mjs` builds only through it.
- New suite [`po-cart-evaluation-build`](../tests/po-cart-evaluation-build.mjs):
  - builds exactly as the command does, two directories deep in `.sites-runtime`;
  - checks that neither module is inlined, nothing changes directory, and the
    seeder's file URL is imported;
  - loads the module from an unrelated directory, then requires the process to be
    in the repository with the frozen source found;
  - checks that the command uses the shared build and loads its output.

**Allowance rotation:**

- The new allowance is `metadata-repair-acceptance-20261101/allowance.json`; the
  prior is the unused one.
- A prior is either consumed (version 1 or 2), or the **exactly pinned** unused one:
  - `retiredPriorAllowance.sha256` is `0b2eb16d…`;
  - it is version 2, `authorized`, with no run or consumption recorded;
  - its pricing check is expired, and it has a valid authorization time.
- Creating the next allowance also requires that the ledger has **no reservation
  at or after** the unused one's authorization. An unreadable time counts as a
  reservation.
- Validation and consumption use the same pin.

**G8 binding:**

- `consumedGateRoots` and `CONSUMED` add `…-20261031`;
- the gate and audit bind `…-20261101`;
- the pins in both suites are updated.

G7's audits all passed, so it accounts for its profiles and locks under the
existing rule.

**Read-only live check,** with writes blocked:

- **Migrated-state check:** passed.
- **`baseline_holds()`:**
  - baseline `8ee75de7…` holds, with preflight idle;
  - the 46 historical locks are exact;
  - 20 gate locks are accounted;
  - the 271,132 changed entries are all inside the 1,108 recorded profiles.

**Planted defects: 17 of 18 caught.**

- **Build:**
  - no resolver, which is the original bug. The text checks catch it, and so does
    the load check alone, with the frozen-source refusal reproduced;
  - only `sites-env` kept out;
  - a relative external path;
  - the command keeping its own build.
- **Allowance:** the pin, expiry, run, consumption, version or authorization-time
  check ignored; the ledger check ignored; a reservation at the authorization time
  allowed; an unreadable time allowed; validation or consumption dropping the pin;
  the unused prior refused.
- **The equivalent one:** keeping only the seeder external also keeps
  `sites-env` out, because it is reached only through the seeder.

**Checks:**

| Command | Result |
| --- | --- |
| `po-cart-evaluation-build`, `po-cart-evaluation-preflight`, `po-cart-full-gate-audit`, `po-cart-full-offline-gate` | Passed |
| `pnpm typecheck`, `pnpm test`, `pnpm build` (isolated clean clone) | Passed; **162 suites**; build complete |
| Prettier on changed scripts, tests and this record; `pnpm lint` | Formatted; lint unchanged from main (53 errors, 59 warnings) |

## Next: G8, then the separately authorized paid matrix

1. **After this merges,** on the merged and then frozen source:
   - confirm the migrated states;
   - run the six-command preparation into the new root;
   - record `freeze.json`;
   - `capture`;
   - dry-run `finish`;
   - `before`.

   **No merges** until the paid matrix finishes.
2. **The owner invokes G8 once, on AC power.**
3. **Only if G8 passes everything:**
   - build the paid evaluation with the merged build and confirm the load check
     **before** asking;
   - then, on the owner's fresh explicit authorization:
     - re-verify pricing;
     - create the allowance;
     - run `pnpm cart:browser-worker:evaluate` once (at most 72 requests, about
       $4.08 conservatively remaining under the $5 ceiling).

Rollback reverts this commit. The consumed roots, the unused allowance, the
observation baseline and all runtime state are untouched.
