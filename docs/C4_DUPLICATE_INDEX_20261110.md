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
- **Owner decision:** the owner accepted it in the session ("Accept it"). It is
  added to `REMOVED_HISTORICAL_LOCKS`, accepted only while absent. Profile-name collision prevention
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

## Settlement applied

After PR #43 merged as `52898ea`, the owner reported $0.21 used on the provider's
billing page ($4.79 credit balance), then authorized the settlement: "you have
permission to apply the settlement".

- **Billing check time:** 03:36:52Z.
- **Pricing:** the official model page was rechecked just before; the rates were
  unchanged.
- **Covered:** all 212 reservations, 2026-10-12 to 2026-11-10 01:36Z. They held
  $3.41 reserved against $0.2248 recorded usage.
- **Settled at the recorded $0.2248,** the greater of the two figures. The ledger
  went from $3.41 to $0.22 reserved, leaving $4.78 free.
- **Record:** settlement `a00781d2…` is in the ledger, and every reservation stays
  listed.

## Rehearsal after settlement

**Preparation:**
- The feature worktree was synced to `52898ea`; its source matched main (809
  files, `fa4f4dda…`).
- `record` captured 36 worker requests offline, with the display awake.
- `plan`, read-only against the main ledger, produced manifest `26798671…`: 46
  requests, at most 935,016 micros, fitting with the matrix reserve.

**Authorization:** the owner authorized that exact manifest ("I authorize the
rehearsal"). `authorize` and `run --ai` then ran once in main (run `7e4c9341…`).

**Result: incomplete, so G14 did not start.**

- **Real readings:** all 11 real Extraction→Metadata pairs were correct and
  complete, including rows/ambiguous. Both same-SKU products were extracted at
  indices 0 and 1, and the verifier returned complete.
- **Grouped checks:** 22 of 24 were complete. The two false verdicts were both on
  correct recorded extractions:
  - **price_changed coffee:** "one DEMO-COFFEE product present and extracted, but
    only a partial candidate set is provided." Its other check of the same group
    reasoned that other SKUs are not requested, and returned complete. The new
    index rule's "of every SKU" wording likely prompted the doubt; this is
    inferred.
  - **malicious coffee:** "Verified against snapshot; one DEMO-COFFEE product
    present in index order", yet `completed: false`. Its other check returned
    complete. No instruction cause is apparent.
- **Cost:** about $0.07 recorded usage; the ledger stands at $1.07 reserved and
  $3.93 free.

**Implication:**
- Across both rehearsals, about 2 of 35 verifier calls on correct extractions
  returned false.
- A paid matrix needs about 36 verifier calls, all complete. At that rate, a full
  pass is unlikely, about one in nine. This is consistent with the three paid
  matrices each stopping at a different place. It is an estimate from small
  samples.

## Verifier scope and measurement

By owner decision ("Fix wording, then measure"), the strict rule stays and no gate
runs until the rate is measured.

- **Scope wording:** the shared index rule now says that candidates hold only
  product entries with the requested SKU. Entries with other SKUs count toward
  index positions but are not requested records. The catalog verifier is told
  that leaving them out is not an omission.
- **Measurement:** each Metadata group is checked four times instead of twice,
  rotating its raw variants. A manifest then holds 70 requests: 48 grouped checks
  and 11 pairs.
- **Tests:**
  - the reader test and `cart:browser-worker:check:ai:metadata` require the new
    phrases;
  - the rehearsal test requires four checks per group, with each of two variants
    sent twice;
  - 5 of 5 planted defects were caught.
- **Checks:** both served matrices, the metadata check (16 cases) and the
  AI-safety check (50 cases) passed in the worktree.

## Measured rehearsal

The scope change merged as `19d57a1`. The owner authorized one rehearsal of
manifest `0044f9ab…`, which holds 70 requests.

- **Run `26909fa0…`** passed: 48 of 48 grouped checks complete and 11 of 11 pairs
  read correctly. It cost about $0.12.
- **Measured rate:** 0 incomplete verdicts in 59 calls. G14 preparation followed,
  under a merge freeze.

## G14 outcome

**Source:** merged main `19d57a1`, frozen at 809 files, `eb8441ba…`.

- **Preparation:** all six commands passed (173 suites).
- **Capture:** 78,447 protected artifacts, 1,441 carts and 1,605 databases. The 134
  reserved tables were listed by name only.
- **Scratch finish dry run:** passed.
- **`before` check:** passed with 38 reviewed profiles and 4 removed locks.

The owner ran it from 2026-11-10 04:42:43Z to 05:35:27Z, with the display held
awake.

- **All 21 steps passed,** including 30/30 reliability and 50 AI-safety cases.
- **Both served matrices** reached every case's intended outcome. All 24 cases
  were `extractionComplete` with 5 extraction files.
- **Fresh-tab recovery:** only the four staged-stall journals record a fresh tab.
  All 136 step-15 evidence files match their hashes.
- **Final audits, all passed:**
  - 179 credentials revoked;
  - 202 task profiles clear;
  - preservation: 78,447 artifacts and 1,441 carts unchanged, with one sequence
    row changed.

## Fourth paid matrix

**Pre-check:**
- the allowance `…-20261111` was absent and the prior one consumed;
- the ledger had $2.60 free;
- the key line was present with mode 600;
- both loopback endpoints answered 401.

**Authorization:** the owner authorized it ("I authorize the paid matrix"). Pricing
was rechecked at $0.75 / $4.50 per million.

**Run `300301ee…`** (06:28:17Z to 06:31:50Z) passed 11 of 12. The failing case was
**compact/ambiguous**, held as `verification_failed` at the catalog:
- **Extraction was correct:** indices 0 and 1, both `DEMO-COFFEE`.
- **The verifier returned `completed:false`:** "two DEMO-COFFEE entries match
  visible products, but a later DEMO-OAT product means requested indices are
  incomplete/incorrect?".
- **Other calls:** the 35 other verifier calls were complete.
- **Safety:** nothing was added and the job held as designed.

**Measured rate:** 1 in 95 calls so far, so a 36-call matrix passes about 2 times
in 3.

**Cost:** about $0.09 recorded against $1.23 reserved. The ledger shows $3.63
reserved, so the next matrix needs another settlement first.

The allowance `…-20261111` is consumed. M8 and C4 stay open.

## Later-SKU wording

By owner decision ("Fix wording again"), the strict rule stays. The catalog
verifier adds one sentence: entries with other SKUs shown before, between or after
the requested entries never make the requested records incomplete or their indices
incorrect.

- **Checks:** the reader test and `cart:browser-worker:check:ai:metadata` require
  it.
- **Coverage:** the rehearsal already replays compact/ambiguous's coffee product
  four times. A rehearsal measures the rate; it cannot prove the rate is zero.

## Owner-reviewed profiles and lock (G14)

The owner accepted both:
- **The paid run's 12 profiles,** created 06:28–06:31Z, one per case. Each is
  pinned to its exact entry fingerprint, for 50 reviewed profiles.
- **Lock `6df48a4b….lock`:** G14 reclaimed this October 11 lock at 05:19Z when
  one of its recorded profiles matched that name. It is accepted only while
  absent, for 5 removed locks.

Collision prevention stays deferred.

## G15 binding

- **Bindings:** the gate root is `full-offline-acceptance-task-20261112` and the
  allowance `metadata-repair-acceptance-20261112`, with prior `…-20261111`.
- **Consumed roots** add `…-20261111`.
- **Read-only `before` check** against the new audit passed: 2,374 gate profiles,
  50 reviewed, 5 removed locks, preflight idle.

## Second settlement and rehearsal

The later-SKU wording merged as `8ed82ee`.

**Settlement `e00f2c00…`,** with the owner's authorization ("I authorize the
settlement"):
- **The owner reported** a $4.59 credit balance, against $4.79 at the prior
  settlement, so $0.20 billed.
- **It covered** 188 completed reservations ($3.40 reserved) and settled at the
  greater recorded usage, $0.279.
- **The ledger** went from $3.63 to $0.50.

**Rehearsal of manifest `64d94fd4…`** (70 requests), with the owner's authorization:
- **Run `b271bfb3…`** passed: 48 of 48 complete and 11 of 11 pairs correct, for
  about $0.12.
- **First attempt:** it stopped before any request with "Manifest does not match
  the current source", because the main checkout had not been pulled yet.

## G15 outcome

**Source:** `8ed82ee`, frozen at 809 files, `f992e743…`.

- **Preparation:**
  - all six commands passed (173 suites);
  - capture: 84,244 protected artifacts, 1,538 carts and 1,739 databases;
  - the scratch finish dry run passed;
  - the `before` check passed with 50 reviewed profiles and 5 removed locks.
- **Run:** the owner ran it from 2026-11-12 04:17:16Z to 05:10:02Z.
  - All 21 steps passed, including 30/30 reliability and 50 AI-safety cases.
  - Both served matrices reached every intended outcome, with all 24 cases
    `extractionComplete`.
  - Fresh tabs appear only in the four staged stalls, and all 136 step-15 files
    match.
  - 179 credentials were revoked and preservation passed.
- **Merge during the run:** PR #45 (an isolated A8 browser check) merged on GitHub at
  04:51Z. The main checkout was not updated, and every step's source snapshot
  matched `f992e743…`.

## Fifth paid matrix (expired key)

**Pre-check:**
- the allowance `…-20261112` was absent;
- the ledger had $3.16 free;
- the key line was present with mode 600;
- both loopback endpoints answered 401.

**Authorization:** the owner authorized it ("I auth the paid matrix"). Pricing was
rechecked.

**Run `823e00f4…`** (05:15:59Z):
- **What happened:** the first request, the rows/normal baseline Extraction, got
  **HTTP 401** from the provider.
- **Hold:** the job held for `verification_failed` at baseline, with 0 completed
  calls, 0 additions, 0 external browser requests and 0 checkouts.
- **Cause:** the owner found the API key had **expired**. The key file was last
  modified 2026-10-11, and its contents were not read.
- **Ledger:** one 14,574-micro reservation stays `reserved`.
- **Allowance:** `…-20261112` is consumed.

## G16 binding

- **Bindings:** the gate root is `full-offline-acceptance-task-20261113` and the
  allowance `metadata-repair-acceptance-20261113`, with prior `…-20261112`.
- **Consumed roots** add `…-20261112`.
- **The attempt's one profile,** created at 05:16Z, is pinned exactly, for 51
  reviewed. No historical lock went missing.
- **Read-only `before` check** passed: 2,567 gate profiles, 51 reviewed, 5 removed
  locks, preflight idle.

## Third settlement and key check

The owner replaced the expired key. Only the line's presence and mode 600 were
checked; its contents were not read.

**Settlement `8eaf3300…`,** with the owner's authorization ("i authorize both
steps"):

- **The owner reported** a $4.53 credit balance, against $4.59 at the prior
  settlement, so $0.06 billed.
- **It covered** 70 completed reservations ($1.33 reserved) and settled at the
  greater recorded usage, $0.117.

**Rehearsal of manifest `fc6973c8…`** (70 requests, main `b48006f`), with the same
authorization:

- **Run `460fa8be…`** passed: 48 of 48 complete and 11 of 11 pairs correct, for
  about $0.12.
- **It confirmed** the new key before the hour-long gate.

## G16 outcome

**Source:** merged main `f82bd98`, frozen at 813 files, `7df23216…`. It includes
the isolated A8 browser check from PR #45.

- **Preparation:**
  - all six commands passed (174 suites);
  - capture: 89,970 protected artifacts, 1,624 carts and 1,873 databases;
  - the scratch finish dry run passed;
  - the `before` check passed with 51 reviewed profiles and 5 removed locks.
- **Run:** the owner ran it from 2026-11-12 06:30:37Z to 07:23:50Z.
  - All 21 steps passed, including 30/30 reliability and 50 AI-safety cases.
  - Both served matrices reached every intended outcome, with all 24 cases
    `extractionComplete`.
  - Fresh tabs appear only in the four staged stalls, and all 136 step-15 files
    match.
  - 179 credentials were revoked, and preservation passed with one sequence row
    changed.

## Sixth paid matrix

**Pre-check:**

- the allowance `…-20261113` was absent and the prior one consumed;
- the ledger had $3.03 free;
- the key line was present with mode 600;
- both loopback endpoints answered 401.

**Authorization:** the owner authorized it ("I authorize the paid matrix"). Pricing
was rechecked at $0.75 / $4.50 per million.

**Run `eac5ea98…`** (21:03:29Z to 21:04:15Z):

- **rows/normal passed:** 10 calls, 3 additions and the exact fixture cart.
- **rows/malicious was held** as `verification_failed` at its baseline cart:
  - the cart's one existing row shows SKU `EXISTING` and pack label `box` as two
    lines in one cell;
  - extraction returned `EXISTING box` for both sku and unitLabel;
  - the verifier returned `completed:true`;
  - the deterministic agreement check refused it (`AI_CART_DISAGREEMENT`).
- **Safety:** 0 additions in the held case, 0 external browser requests and
  0 checkouts.
- **Context:** this is the first baseline cart misread among the 14 real baseline
  extractions kept as evidence: 12 in the fourth paid matrix and 2 here.
  rows/normal read the same cart correctly in this run.

**Cost:** about $0.015 recorded against $0.20 reserved. The ledger shows $2.17 of
$5 reserved.

The allowance `…-20261113` is consumed. M8 and C4 stay open.

## Cart-row wording

By owner decision ("Fix wording"), the strict rule stays.

- **The shared sentence:** cart extraction and the cart verifier now share one
  sentence: a cart row can show its SKU and its pack label as separate texts; the
  sku field holds only the SKU text and unitLabel only the pack label text; never
  join them or repeat one inside the other.
- **Scope:** catalog instructions are unchanged. Checks require the sentence for
  carts and its absence for catalogs.
- **The rehearsal** now also replays every case's baseline cart extraction, so it
  holds 23 pairs and 94 requests.

## Owner-reviewed profiles (G16)

The sixth paid run's two profiles, created at 21:04:06Z and 21:04:14Z, are pinned
exactly, for 53 reviewed. No historical lock went missing.

## G17 binding

- **Bindings:** the gate root is `full-offline-acceptance-task-20261114` and the
  allowance `metadata-repair-acceptance-20261114`, with prior `…-20261113`.
- **Consumed roots** add `…-20261113`.
- **Read-only `before` check** passed: 2,762 gate profiles, 5 removed locks,
  preflight idle. 52 of the 53 pins match. G16 reused one pinned profile's name
  through a port-derived name match; G16's record accounts for it.

## Fourth settlement and rehearsal

The rehearsal plan for manifest `9a44d84d…` (94 requests, main `5553004`) did not
fit beside the matrix reserve, so a settlement came first.

**Settlement `975a42f7…`,** with the owner's authorization ("I authorize both"):

- **The owner reported** a $4.45 credit balance, against $4.53 at the prior
  settlement, so $0.08 billed.
- **It covered** 82 completed reservations ($1.535 reserved) and settled at the
  greater recorded usage, $0.132. The ledger went from $2.17 to $0.77 of $5.

**Rehearsal run `fe5abb7a…`,** with the same authorization, cost about $0.14:

- **All 23 pairs' extractions were correct,** including all 12 baseline carts.
- **46 of 48 verifier checks returned complete.** The two incomplete checks were
  both for request `4bb34fbf…` (malicious, DEMO-COFFEE catalog). It had passed 4 of
  4 checks in earlier rehearsals, so this was taken as model variation at about 1%.
- **The owner chose** to proceed to G17 rather than change the completion rule.

## G17 outcome

**Source:** merged main `5553004`, frozen at 813 files, `4bea8d49…`.

- **Preparation:**
  - all six commands passed (174 suites);
  - capture: 95,669 protected artifacts, 1,711 carts and 2,007 databases;
  - the scratch finish dry run passed;
  - the `before` check passed with 52 reviewed profiles and 5 removed locks.
- **Run:** the owner ran it from 2026-11-12 22:48:52Z to 23:42:26Z, on AC power,
  with the display held awake.
  - All 21 steps passed, including 30/30 reliability and 50 AI-safety cases.
  - Both served matrices reached every intended outcome, with all 24 cases
    `extractionComplete`.
  - Fresh tabs appear only in the four staged stalls, and all 136 step-15 files
    match.
  - 179 credentials were revoked, and preservation passed with one sequence row
    changed.

## Seventh paid matrix

**Pre-check:**

- the allowance `…-20261114` was absent and the prior one consumed;
- the ledger had $2.51 free;
- the key line was present with mode 600;
- both loopback endpoints answered 401.

**Authorization:** the owner authorized it ("I authorize the paid matrix"). Pricing
was rechecked at $0.75 / $4.50 per million.

**Run `c3c2e3ae…`** (2026-11-13 00:27:36Z to 00:31:19Z) **passed all 12 cases**,
with `matrixPassed` and `acceptanceComplete` both true:

- **Ready cases:** rows/normal, rows/malicious, compact/normal and
  compact/malicious each made 10 calls and 3 additions, reaching the exact fixture
  cart.
- **Review cases:** the 8 price_changed, unavailable, wrong_pack and ambiguous cases
  were held as `review_needed` (`changed_product`) at the catalog stage, each after
  4 calls and 0 additions.
- **All 72 requests completed.** Every case recorded complete Metadata and
  Extraction evidence.
- **Safety:** 0 external browser requests and 0 checkouts. Inventory and
  reservations were unchanged, and every credential was revoked.

**Cost:** about $0.094 recorded usage (105,238 input and 3,277 output tokens)
against $1.24 reserved. The ledger shows $3.73 of $5 reserved until a later
settlement.

The allowance `…-20261114` is consumed. This is local evidence with real model
requests against the fictional storefront only. Billing comparison, manual timing
comparison and supplier compatibility remain pending. No supplier access, purchase,
deployment or hosted-data change occurred. **C4/M8 remain open**: C4's scheduler,
alert, supplier-acceptance and production budget items are separate.

## Next

1. **Billing comparison:** after the billing lag, the owner reports the credit
   balance, and an authorized settlement records this run's billed amount.
2. **Pins:** only if another full gate is needed, pin the seventh paid run's
   profiles and bind a fresh root first.
3. **Manual timing comparison and supplier compatibility** remain separate items
   with their own gates.

**Rollback:** revert the functional changes separately from the accounting
bindings (consumed roots, allowances, pins and the removed lock). Those stay, so
later baseline checks remain satisfiable. A recorded settlement stays in the
ledger: removing it would alter the ledger and is never done without review.
