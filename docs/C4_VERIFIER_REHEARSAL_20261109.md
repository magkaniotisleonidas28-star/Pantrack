# C4 G12, second paid matrix, verifier rehearsal and G13 binding — 2026-11-09

This records the one authorized invocation of the
[G12 binding](C4_PACK_LABEL_EVIDENCE_20261109.md#g12-binding), the paid matrix that
followed on the owner's fresh authorization, and the owner-approved change of
approach that its failure prompted. **Result: G12 passed all 21 steps and every
final audit. The paid matrix did not pass:** its first case was held by the
fail-closed completion guard.

G12 is local evidence with mocked inference. The paid matrix is local evidence
with real model requests against the fictional storefront only. No supplier
access, checkout, purchase, deployment or hosted-data change occurred. **C4/M8
remain open**, and no checkbox advances.

## G12 outcome

**Source:** merged main `fee8992`, frozen at 792 files, `0ea7d815…`. Preparation
passed all six commands (167 suites). Capture recorded 67,744 protected artifacts,
1,264 carts and 1,337 databases. The `before` check passed with baseline
`8ee75de7…`, 43 historical locks exact and the 3 reviewed locks absent, 30 gate
locks accounted, and 1,791 gate profiles and the 31 reviewed profiles accounted.

The owner ran it from 2026-11-09 19:55:21Z to 20:47:19Z, on AC power.

- **All 21 steps passed,** including 30/30 reliability and 50 AI-safety cases.
- **Fresh-tab recovery:** only the four staged-stall cases used a fresh tab, each
  once at its intended stage. All 136 step-15 evidence files match their hashes.
- **Final audits, all passed:**
  - 179 credentials issued and revoked, each checked for HTTP 401;
  - 202 task profiles clear, with ports free;
  - consumption and evidence verified;
  - preservation: 67,744 artifacts and 1,264 carts unchanged. Bookkeeping changed
    in two `_cf_METADATA` rows and one sequence row. Reading that reserved table
    is now retired; see [Reserved tables](#reserved-tables).

The paid build was checked before authorization exactly as for
[G11](C4_PACK_LABEL_EVIDENCE_20261109.md#pre-authorization-check-of-the-paid-build),
on `0ea7d815…`. Both loopback services answered HTTP 401.

## Second paid matrix

The owner gave fresh explicit authorization on 2026-11-09: "I authorize the paid
matrix". The official model page was checked again with the same result. The
allowance was created at 21:29:37Z from G12's report, and run `bcefae0c…` ran from
21:29:38Z to 21:29:55Z. Preflight passed and consumed the allowance. The preview
was stopped afterwards.

**Outcome:** the matrix stopped after its first case, rows/normal:

- **Safety:** 0 external browser requests, 0 checkout submissions, 0 additions,
  inventory and reservation unchanged, credentials revoked, cleanup and network
  coverage verified.
- **Observed:** the baseline cart was verified. For coffee, the verifier returned
  `completed: false` with the progress note "noted missing required pack label
  field in extracted JSON". The job was held as `review_needed` at the catalog
  stage, with no `agreed` record for coffee.
- **Inferred, not observed:** the strict schema requires `unitLabel`, and the
  instructions called it only "pack label", so a field-name mismatch is a strong
  explanation. The provider does not retain response bodies, so the extracted
  value itself is unavailable, and the progress note does not prove the model's
  reasoning.

**Spend:** 4 requests, about $0.004 at list price. The ledger's conservative
total rose by $0.064517 to $2.239762 of $5. Across all 144 recorded requests,
usage at list price totals about $0.14; this is a token estimate, not billing.

## Why a rehearsal

Three paid matrices in a row were held by verifier false negatives:
- **2026-11-04:** availability, in the twelfth and last case;
- **2026-11-09, first run:** label form, in the first case;
- **2026-11-09, second run:** the field name, in the first case.

Each fix took a PR, an hour-long gate and a paid run, because:
- only the paid matrix uses the real model;
- the matrix stops at its first failure;
- the ledger counts each request's worst case.

**By owner decision,** a recorded-verifier rehearsal now precedes the next gate.
A read-only review then found gaps in the first rehearsal draft, and **by owner
decision its full repair plan was implemented.** The rehearsal is practice
evidence only. The gate, the allowance and the matrix are unchanged and remain
the only acceptance path.

## Field contract

[`ai-reader.ts`](../scripts/po-cart-worker/ai-reader.ts) names every fact by its
schema field:
- **`extractionFields`** gives one plain name per key, such as
  `unitLabel (pack label)`.
- **Extraction requests** list their fields in that form, derived from each
  schema's keys.
- **`metadataCompletionFor(kind)`** gives each verifier only its own kind's
  contract:
  - products get `candidates` with five fields, plus the availability rule;
  - carts get `entries` with four fields, and are told that catalog fields are
    not requested.
- **The verifier is told** that a requested fact present under its field name is
  not missing, though its value must still match the snapshot.

The strict guard is unchanged.

**Checks:**
- The reader suite requires the field map to cover exactly both schemas' keys.
  It also requires each kind's prompt to name its own fields and none of the
  other kind's.
- The real-browser metadata check requires the kind-specific contract in every
  verifier request.

## Verifier rehearsal

Implemented in
[`rehearsal-recorder.mjs`](../scripts/po-cart-worker/rehearsal-recorder.mjs),
[`rehearsal-manifest.mjs`](../scripts/po-cart-worker/rehearsal-manifest.mjs),
[`rehearsal-authorization.mjs`](../scripts/po-cart-worker/rehearsal-authorization.mjs),
[`rehearsal-runner.mjs`](../scripts/po-cart-worker/rehearsal-runner.mjs) and the
command [`po-cart-ai-rehearsal.mjs`](../scripts/po-cart-ai-rehearsal.mjs). It
works in four steps.

### 1. `pnpm cart:ai:rehearsal:record`

Offline, behind the offline boundary. **It refuses to run in the main checkout**,
because it opens a browser.

- **What it captures:** the real `LocalBrowserCartWorker`, reader and Stagehand
  prepare all 12 matrix cases against the real fixture. They use a private profile
  root, never the shared one, and a synthetic provider.
- **What the synthetic provider returns:** each Extraction gets the correct value
  for the page as rendered, which is kept as the oracle. Each Metadata request is
  recorded and answered complete.
- **Outcome checks:** ready cases must end ready with three additions. Review
  cases must end held, after their baseline and first product.
- **Cleanup:** the worker, API server, fixture and database each get their own
  cleanup attempt.
- **Publishing:** a recording is published exclusively only after every cleanup
  is verified, all 36 case and phase captures are present, and the source held.
- **On failure:** the work directory and its report are retained.

### 2. `plan --recording <file> --ledger <main ledger> --output <file>`

- **Grouping:** Metadata requests are grouped after ignoring only Stagehand's
  line-leading `[frame-node]` IDs inside the DOM section. The bytes sent are
  always the raw recording.
- **Each group is sent twice,** using a second raw variant where one exists.
- **Four real extraction pairs** are added: rows/normal coffee and cups,
  compact/ambiguous coffee, and the compact/normal final cart.
- **Reservations:** each request reserves exactly what the provider would. A
  pair's Metadata reserves the input cap, because the real extraction is unknown
  until it arrives.
- **The ledger** is only read. The plan reports whether the run fits while keeping
  the matrix's $1.959552 free.

### 3. `authorize --manifest … --approval-file … --pricing-file … --output …`

Run only after the owner's separate explicit authorization of that exact manifest.

- **Exclusive:** it creates a one-use authorization file that can never be
  replaced.
- **Bound to:**
  - the manifest's SHA-256;
  - its source;
  - its request count and maximum reservation;
  - the canonical ledger;
  - a pricing check made within five minutes.

### 4. `run --ai --manifest … --authorization-file …`

In the main checkout:

- **Before any send:** a report skeleton is saved before configuration is read.
  Every refusal input is saved before it is evaluated. The authorization is
  consumed once, under its ownership lock.
- **For every request:**
  - the source is rechecked first;
  - its attempt is saved before the call, and its outcome after;
  - under the ledger lock, it may reserve only if the matrix reserve stays free
    (`minimumRemainingMicros`).
- **Pairs:** a pair's Metadata carries the real extraction, substituted at the
  recorded marker exactly once. The extraction is compared with the oracle
  separately.
- **Failures:** a provider, budget, evidence or source failure stops the run, with
  no retry. A false verdict or wrong extraction is recorded and the planned run
  continues.
- **Verdicts:** an invalid verdict is never counted as complete.
- **`acceptanceComplete` is always false.**

**One shared bound:**
[`ai-request-budget.mjs`](../scripts/cart-preview/ai-request-budget.mjs) holds the
input cap, overhead, output ceiling and reservation formula for the provider and
every estimate. The provider's default behavior is unchanged.

**Suites:**
- `po-cart-ai-rehearsal`: manifests and the runner, through the real provider and
  ledger with an injected transport.
- `po-cart-rehearsal-authorization`.
- `po-cart-rehearsal-recording`: the real orchestrator with injected resource
  factories, including cleanup, port, outcome, source and coverage failures.

## Matrix outcome reasons

[`evaluation-case-verdict.mjs`](../scripts/po-cart-worker/evaluation-case-verdict.mjs)
makes each matrix case prove its intended durable outcome.

- **Ready cases** must end ready, with no hold and no intervention.
- **Review cases** must be held exactly once:
  - for `changed_product`;
  - at the catalog stage;
  - as the last event;
  - with the stopped tick as the one intervention.

`ai-evaluate.ts` records `holdReason`, `failureStage` and `outcomeVerified`, and a
case passes only with `outcomeVerified`. The served check asserts them for all 12
mocked cases.

## Reserved tables

`full-gate-audit.py` no longer queries Cloudflare-reserved `_cf_` tables, as
AGENTS.md requires.

- **Reserved tables:** capture lists their names from `sqlite_master` only, and
  finish checks that they still exist. Any read is refused.
- **The two migrated gate states** must hold exactly the latest migration
  snapshot's application tables, plus `d1_migrations`, `sqlite_sequence` and
  reserved names.
- **Every other table in every database** keeps exact row preservation, as before.
- **Capture version 2:** finish refuses an older capture rather than
  reinterpreting it. `reservedTablesUninspected` replaces the old metadata count.

**Interpretation, for the rule's author to confirm:** of 1,463 local SQLite files,
only 19 are D1 states with a migration record.
- Two older copies, from a 2026-10-07 branch, carry a different `0024` migration.
- Most of the others are fixture or test stores.

So snapshot inventories are enforced where the gate writes, and everything else
keeps row preservation. A read-only run of the new capture against the main
checkout passed, with 119 reserved tables listed and 0 read. The older one-off
audits (`legacy-profile-audit.py` and its peers) still read `_cf_METADATA`. They
are not run by the gate; retiring them is deferred.

**SQLite's authorizer** proves in the suite that no reserved table is read, even
when one changes.

## Planted defects

21 of 21 were caught. Three of them were caught only after tightening the tests,
so each rule is now tested on its own:

1. the budget floor ignored;
2. the per-request source check skipped;
3. the attempt saved only after its call;
4. a string verdict accepted;
5. a replay sending the oracle instead of the real extraction;
6. authorization not consumed;
7. the Metadata type unchecked;
8. coverage unchecked;
9. IDs stripped outside the line prefix;
10. the authorization binding not compared;
11. the authorization file overwritable;
12. expired pricing consumable;
13. a recorder cleanup step skipped;
14. a cleanup failure ignored;
15. a case outcome unchecked;
16. a wrong hold reason accepted;
17. a ready-case intervention accepted;
18. a reserved table read;
19. the migrated-state inventory unchecked;
20. an older capture accepted;
21. a cart verifier given product fields.

## Display sleep and the browser stall

During verification, every browser check began failing at its first addition:
- Playwright's click on the add-to-cart button never completed;
- the worker held the job as `uncertain_write` at the addition stage;
- the page reported crashed on close.

The machine was idle with its display asleep. No stray browser process ran, and
memory was ample. A plain Playwright headless-shell probe still clicked normally.
Pantrack launches the full Chrome binary through Stagehand.

After `caffeinate -u -t 2` woke the display, the same real-browser metadata check
passed 16/16. Under `caffeinate -dimsu`, both served checks then passed 12/12.

**Reading:**
- **Verified:** a sleeping display stalls Pantrack's browser clicks.
- **Inferred:** this is the likely cause of the rare step-15 stalls in G9 and G10
  and of the earlier freeze diagnosis. `caffeinate -di` prevents idle sleep but
  does not wake a display that is already asleep.

**Until a launch-level fix is reviewed,** browser checks, gates and paid runs need
the display awake and the screen unlocked.

**Trial plan:** the real worker recording on this source gave 36 captures in 12
groups. `plan` against the main ledger, read-only, gave 32 requests at most
610,333 micros, leaving about $0.19 above the matrix reserve. The final plan is
made again on merged source.

## Owner-reviewed profile

The second matrix changed one profile outside any gate. Under the owner's
2026-11-09 rule for paid-matrix profiles, it joins `PROFILES_REVIEWED`, pinned to
the digest of every entry under it. The list is now 32. G12 removed no further
historical lock.

## G13 binding

- **Gate:** `consumedGateRoots` and `CONSUMED` add `…-20261109`, and the gate and
  audit bind `…-20261110`.
- **Allowances:** the prior is the one the second 2026-11-09 matrix consumed,
  `metadata-repair-acceptance-20261109/allowance.json`, and the next is
  `metadata-repair-acceptance-20261110/allowance.json`.

**Read-only live check,** with writes blocked: `baseline_holds()` passed with
baseline `8ee75de7…`, preflight idle, 43 historical locks exact with the 3
reviewed locks absent, 34 gate locks accounted, and 1,985 gate profiles and the
32 reviewed profiles accounted.

## Next

1. **Wake the display before each step that opens a browser,** and keep it awake
   (`caffeinate -u -t 2`, then `caffeinate -dimsu …`).
2. **After this merges,** sync the feature worktree to merged main and confirm the
   two source snapshots match. Then run `record` and `plan` there, against the
   main ledger, read-only.
3. **The owner authorizes** the exact manifest's hash, request count and maximum
   reservation. Then run `authorize` and `run --ai` once, in the main checkout.
4. **If every positive verdict is complete and every extraction correct:**
   - G13 preparation on the frozen merged source;
   - the owner's single invocation;
   - the loopback services and the paid-build check;
   - fresh explicit authorization for the matrix.

   No merges from preparation until the paid run finishes.
5. **Otherwise,** diagnose the whole rehearsal report before another gate. Any
   further paid run needs fresh authorization and fresh budget arithmetic.

**Rollback:** revert the functional changes separately from the accounting
bindings (consumed roots, allowances, pins). Those stay, so later baseline checks
remain satisfiable, and any code rollback after a gate needs a new binding.
The observation baseline, profiles, locks and ledger are untouched.
