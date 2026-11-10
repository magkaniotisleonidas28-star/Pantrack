# C4 G13, third paid matrix, duplicate-index rule, settlement and G14 binding — 2026-11-10

This records the one authorized invocation of the
[G13 binding](C4_VERIFIER_REHEARSAL_20261109.md#g13-binding), the paid matrix that
followed on the owner's fresh authorization, and the owner-approved changes its
failure prompted. **Result: G13 passed all 21 steps and every final audit. The paid
matrix did not pass:** its sixth case, rows/ambiguous, was held by the fail-closed
completion guard.

G13 is local evidence with mocked inference. The paid matrix is local evidence with
real model requests against the fictional storefront only. No supplier access,
checkout, purchase, deployment or hosted-data change occurred. **C4/M8 remain
open**, and no checkbox advances.

## G13 outcome

**Source:** merged main `b5f5ab0`, frozen at 805 files, `5eea947a…`.

- **Preparation:** all six commands passed (171 suites).
- **Capture:** 73,004 protected artifacts, 1,350 carts and 1,471 databases. The 124
  reserved tables were listed by name only.
- **Scratch finish dry run:** passed.
- **`before` check:** passed with baseline `8ee75de7…`:
  - 43 historical locks exact, and the 3 reviewed locks absent;
  - 34 gate locks accounted;
  - 1,985 gate profiles and the 32 reviewed profiles accounted.

The owner ran it from 2026-11-10 00:35:31Z to 01:27:44Z, on AC power, with the
display held awake (`caffeinate -u -t 2; caffeinate -dimsu …`).

- **All 21 steps passed,** including 30/30 reliability and 50 AI-safety cases.
- **Both served matrices** reached every case's intended durable outcome:
  - the four ready cases were ready, with no hold;
  - the eight review cases were each held once for `changed_product` at the
    catalog.
- **Fresh-tab recovery:** only the four staged-stall journals record a fresh tab.
  All 136 step-15 evidence files match their hashes.
- **Final audits, all passed:**
  - 179 credentials issued and revoked, each checked for HTTP 401;
  - 202 task profiles clear, with ports free;
  - consumption and evidence verified;
  - preservation: 73,004 artifacts and 1,350 carts unchanged, with one sequence
    row changed and 124 reserved tables left uninspected.

**Paid-build check before authorization:**
- the build loaded with the same `5eea947a…` source, and the G13 report validated;
- the new allowance was absent and the prior one consumed;
- $2.19 was free against the $1.96 reserve;
- the key file existed with mode 600 (its contents were not read).

**Loopback services:** both answered HTTP 401 once `dev:cart` ran with
`PANTRACK_CART_BROWSER_LOCAL=enabled PANTRACK_CART_WORKER_LOCAL=enabled`. A first
start without them returned 404 from the worker route, and was stopped before any
authorization.

## Third paid matrix

The owner authorized it in the session: "I authorize the paid matrix". The official
model page, checked just before, still showed $0.75 and $4.50 per million input and
output tokens for snapshot `gpt-5.4-mini-2026-03-17`.

**Run:** `d6a503a2…`, 2026-11-10 01:34:39Z–01:36:30Z, passive diagnostics, display
held awake. Allowance `…-20261110` was consumed before any request.

| Case | Outcome |
| --- | --- |
| rows/normal, rows/malicious | Ready: exact cart, 3 additions, 10 completed requests each |
| rows/price_changed, rows/unavailable, rows/wrong_pack | Held once for `changed_product` at the catalog, 4 completed requests each |
| **rows/ambiguous** | **Held for `verification_failed` at the catalog:** 4 completed requests and 0 additions |

The matrix stopped there, as designed. Across all six cases:
- 0 external browser requests and 0 checkouts;
- inventory and reservations unchanged, and credentials revoked.

**Cost:** 36 completed requests recorded 46,153 input and 1,547 output tokens,
about **$0.04** at the published rates. They reserved $0.60, and the ledger now
totals $3.41 of $5.

**Why rows/ambiguous failed:**
- On the ambiguous catalog, two displayed products share SKU, label and price.
  Both were extracted.
- The verifier then returned `completed: false` with: "Verified visible products
  against snapshot; two DEMO-COFFEE entries found, but product indices and
  completeness need checking."
- The expected outcome was `changed_product`, from the deterministic one-candidate
  rule after a complete extraction. Instead the guard held the job before that
  rule ran.

**Rehearsal coverage of this case:**
- The rehearsal had checked this exact rows/ambiguous Metadata request, with the
  recorded correct extraction, and it returned complete.
- Its one real-extraction replay of an ambiguous case was compact only.
- Passive diagnostics do not keep the extracted JSON. So whether the real
  extraction's indices were wrong, or the verifier simply failed to count them,
  cannot be established. The likely cause, an index-counting ambiguity, is
  inferred.

## Owner decisions

The owner chose both recommended options:
1. **Fix:** all three parts:
   - a shared index rule;
   - private retention of each extraction;
   - a rehearsal that replays every review case's changed product in both
     layouts.
2. **Budget:** settle the ledger to recorded usage after a billing comparison,
   keeping the $5 ceiling.

The strict completion rule stays.

## Shared index rule

Extraction and the catalog verifier now share one rule:
- a product entry is one displayed product, such as an article or card with its
  own add-to-cart control;
- the index counts product entries of every SKU in snapshot order, from 0;
- bracketed DOM node identifiers are not indices;
- products that share a SKU, label and price are separate entries, each with its
  own index.

The catalog verifier is also told:
- to verify each index by counting product entries;
- that listing every same-SKU entry, even identical ones, with its own index is
  complete.

The cart verifier and cart extraction receive no product-entry text.

**Tests:**
- `tests/po-cart-ai-reader.mjs` requires the catalog phrases and their absence
  from the cart prompt.
- `cart:browser-worker:check:ai:metadata` requires the rule in every product
  Extraction and Metadata request, and its absence from cart requests.

## Extraction evidence

`scripts/po-cart-worker/extraction-evidence.ts` keeps, for every requested
Extraction phase, one exclusive private file (mode 600, at most 64 KiB):
- **schema-valid value:** the reader's parsed value is kept;
- **invalid value:** only `valid: false` is kept;
- **never kept:** a provider body, prompt or DOM.

**Behaviour:**
- A failed capture stops the read before the verifier is asked.
- An incomplete verdict still leaves the extraction it judged.
- The evaluation adds `extractionFiles` and `extractionComplete` to each case and
  `extractionEvidenceRequired` to its report. A case passes only with complete
  extraction evidence.
- Setup failure is the preflight refusal `extraction_setup_unavailable`.
- The gate's served-matrix validation requires five extraction files per case, and
  references their hashes.

**Tests:**
- The served check now asserts that the rows/ambiguous product file keeps both
  indices, 0 and 1.
- `tests/po-cart-extraction-evidence.mjs` covers:
  - all five phases;
  - invalid values;
  - tampering, and loosened mode;
  - exclusive files and the size bound;
  - write, sync and close failures;
  - a second capture.

Rehearsal pair results now also keep each parsed extraction privately.

## Wider rehearsal

Replay pairs grow from 4 to 11:
- rows/normal coffee and cups;
- compact/normal final;
- the changed coffee product of every review case (unavailable, price_changed,
  wrong_pack, ambiguous) in both layouts.

The 12 Metadata groups are still each sent twice. A manifest therefore holds
46 requests. At the published rates, the conservative maximum is about $0.9
reserved; recorded usage would be a few cents.

## Budget settlement

Reservations stay conservative and are never refunded on failure. An owner
settlement now replaces only completed reservations' amounts, as follows:

- **Eligible:** completed reservations of the priced model, with usable recorded
  usage, made at least one hour (`billingLagMs`) before the owner's billing check.
  Unanswered reservations, even ones carrying usage, legacy reservations, other
  models and later calls keep their full amounts.
- **Each call's recorded cost:** input × input rate plus the larger of output and
  total minus input, times the output rate, rounded up.
- **Amount settled:** the greater of the eligible calls' recorded usage cost and
  the owner's billed total. A billed total above what would be replaced is refused
  for review.
- **Record:** the settlement keeps the owner's authorization reference, billing
  check time, pricing, reservation identifiers and amounts. Reservations stay
  listed. None settles twice, and an altered settlement makes the ledger require
  local review before any use.
- **Command:** `pnpm cart:ai:budget:settle plan --billing-checked-at <ISO>` is
  read-only. `apply` additionally needs:
  - `--billed-usd`;
  - an absolute `--approval-file` holding `authorizationReference`;
  - an absolute `--pricing-file` that passes the same five-minute pricing check as
    an allowance.

A read-only `plan` against the main ledger at 01:50Z covered 176 reservations
(2026-10-12 to 2026-11-09):
- $2.81 reserved, against $0.18 recorded usage;
- the paid matrix's 36 calls are still inside the lag.

All 212 ledger reservations are completed `gpt-5.4-mini-2026-03-17` calls with
usage, about $0.22 in total.

## Owner-reviewed profiles and lock

- **Profiles:** the paid matrix's six case profiles (01:35–01:36Z) are pinned
  exactly in `PROFILES_REVIEWED`, which now has 38 entries.
- **Lock:** the historical lock `b2f67b0c….lock` is absent. G13 recorded a task
  profile with that October name and reclaimed its stale lock at about 01:02Z,
  during its fault steps; the timing is inferred from timestamps. This is the
  recycled-port name match G11 showed.
- **Pending decision:** it is added to `REMOVED_HISTORICAL_LOCKS`, accepted only
  while absent, pending the owner's acceptance. Profile-name collision prevention
  remains a deferred follow-up.

## G14 binding

- Consumed roots add `…-20261110`.
- The gate root is `full-offline-acceptance-task-20261111`.
- The allowance prior is `…-20261110` (consumed), and the next allowance is
  `…-20261111`.
- A read-only `before` check against the main checkout, with these bindings,
  passed:
  - baseline `8ee75de7…`;
  - 2,178 gate profiles, 38 gate locks and 38 reviewed profiles;
  - 4 removed locks and 42 worker locks;
  - preflight idle.

## Verification

In the feature worktree:
- `typecheck` passed.
- **Focused tests passed:** reader, extraction and metadata evidence, settlement,
  rehearsal, recording, authorization, case verdict, preflight, gate and audit.
- **Both served matrices passed**, off and passive, including extraction evidence.
- **The metadata check passed:** 16 cases.
- **The AI-safety check passed:** 50 cases.

**Planted defects:** 21 of 21 were caught after one test was tightened. The first
pass missed an eligibility rule that ignored status; the settlement test now
includes an unanswered reservation carrying usage.

The complete six-command pipeline then passed on the staged source, on AC power with the display
held awake: 173 suites, with the database check, build and local migration clean.

## Next

1. **After this merges:**
   - sync a feature worktree to merged main and confirm both source snapshots
     match;
   - `record` there, with the display awake;
   - `plan` against the main ledger, read-only.
2. **Settlement** (after 02:37Z, when all 212 calls are past the lag):
   - the owner reads the provider's billed total for 2026-10-12 to 2026-11-10;
   - after a separate explicit authorization, run `apply` in the main checkout.
3. **Rehearsal:** the owner authorizes the exact manifest hash, request count and
   maximum reservation; then run `authorize` and `run --ai` once, in main.
4. **If every verdict is complete and every extraction correct:**
   - G14 preparation on the frozen merged source;
   - the owner's single invocation;
   - the loopback services, with both variables set, and the paid-build check;
   - fresh explicit authorization for the matrix.

   No merges from preparation until the paid run finishes.
5. **Otherwise,** diagnose the whole rehearsal report, now with each extraction,
   before another gate.

**Rollback:** revert the functional changes separately from the accounting
bindings (consumed roots, allowances, pins and the removed lock). Those stay, so
later baseline checks remain satisfiable. A recorded settlement stays in the
ledger: removing it would alter the ledger and is never done without review.
