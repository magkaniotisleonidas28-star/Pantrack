# C4 G11, paid matrix, pack-label evidence and G12 binding — 2026-11-09

This records the one authorized invocation of the
[G11 binding](C4_FULL_OFFLINE_GATE_RUN_20261105.md#g11-binding), the paid matrix
that followed on the owner's fresh authorization, the change that its failure
supports, and the G12 binding. **Result: G11 passed all 21 steps and every final
audit. The paid matrix did not pass:** its first case was held by the fail-closed
completion guard.

G11 is local evidence with mocked inference. The paid matrix is local evidence
with real model requests against the fictional storefront only. No supplier
access, checkout, purchase, deployment or hosted-data change occurred. **C4/M8
remain open**, and no checkbox advances.

## G11 outcome

**Source:** merged main `ef5bf72`, frozen at 792 files, `4997d07e…`. Preparation
passed all six commands (167 suites). The cart-review state first lacked merged
migration `0045`, so capture refused; applying it locally, as the preview does at
startup, let capture pass. Capture recorded 62,489 protected artifacts, 1,178
carts and 1,203 databases. The `before` check passed with baseline `8ee75de7…`,
46 historical locks exact, 26 gate locks accounted, and 1,596 gate profiles and
the 30 reviewed profiles accounted.

The owner ran it from 2026-11-09 06:00:21Z to 06:52:10Z. The machine was on AC
power at preparation and on battery by the post-gate check.

- **All 21 steps passed,** including 30/30 reliability, 50 AI-safety cases and
  step 15, `cart:browser-worker:check`.
- **Fresh-tab recovery:** each of the four staged-stall cases recorded exactly one
  fresh tab at its intended stage. No other job used one, so no natural freeze
  occurred in this run. All 136 step-15 evidence files match their hashes.
- **Final audits, all passed:**
  - 179 credentials issued and revoked, each checked for HTTP 401;
  - 202 task profiles clear, with ports free;
  - consumption and evidence verified;
  - preservation: 62,489 artifacts and 1,178 carts unchanged. Bookkeeping changed
    in two `_cf_METADATA` rows and one sequence row.

## Pre-authorization check of the paid build

After G11's final audit, and before asking the owner:

- `buildEvaluation()` built the real bundle. The seeder stayed external,
  `sites-env.mjs` was not inlined, and nothing changes directory.
- Loaded from an unrelated directory, the bundle left the process in the
  repository, where the snapshot found the same 792 files and `4997d07e…`.
- `validateGate` accepted G11's report.
- The new allowance path was absent, the prior allowance was consumed, and the
  ledger held no reservation after 2026-11-04.
- With `PANTRACK_CART_BROWSER_LOCAL=enabled PANTRACK_CART_WORKER_LOCAL=enabled pnpm dev:cart`,
  both preflight addresses answered HTTP 401 with the expected content types.

## Paid matrix

The owner gave fresh explicit authorization on 2026-11-09: "I authorize the one
remaining paid matrix". In order:

1. The [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
   was checked: snapshot `gpt-5.4-mini-2026-03-17`, $0.75 input and $4.50 output
   per million tokens, reasoning `none` supported, and no deprecation notice.
2. The single-use allowance was created at 17:20:31Z from G11's report.
3. `pnpm cart:browser-worker:evaluate` ran as `fcc0c7cd…` from 17:20:31Z to
   17:21:02Z. Preflight passed and consumed the allowance. The preview was stopped
   afterwards.

The machine was on battery (84%) during the run.

**Outcome:** the matrix stopped after its first case, rows/normal, against source
`4997d07e…`:

- **Safety:** 0 external browser requests, 0 checkout submissions, inventory and
  reservation unchanged, credentials revoked, cleanup and network coverage
  verified. No fresh tab was needed.
- **The failure:** the worker extracted and verified the baseline cart, coffee and
  oat milk, and added both. For cups, the extraction was correct, but the model's
  own Metadata verifier returned `completed: false`. Its progress note said it
  "detected one omission in required labeling structure". That raised
  `AI_INCOMPLETE_EXTRACTION` at the catalog stage, so the job was held as
  `review_needed` after two of three additions. The evaluation stops at its first
  failed case, so the other 11 did not run.

**Reading:**

- Coffee and oat milk show labels like `case of 6 × 1 lb`. Cups show
  `sleeve of 50`, a count without a unit size. The verifier treated that
  different form as missing structure.
- The same label passed in the 2026-11-04 matrix, so this judgment varies between
  runs. As then, the outcome was safe and the strict rule correctly refused it.

**Spend:** 8 requests, with 9,092 input and 328 output tokens recorded, which is
about $0.008 at list price. The ledger's conservative total rose by $0.128513 to
$2.175245 of $5. The $1.959552 matrix reservation still fits.

## Pack-label evidence

By owner decision, the strict completion rule stays. Following the
[availability evidence](C4_AVAILABILITY_EVIDENCE_20261104.md) pattern,
[`ai-reader.ts`](../scripts/po-cart-worker/ai-reader.ts) adds one shared rule,
`packLabelEvidence`:

> A pack label is the exact visible label text shown for that product or cart row,
> in whatever form the supplier uses: a count with a unit size, a count alone, or
> a single unit name. A verbatim visible label is the complete pack label; labels
> need not share one structure.

The wording deliberately avoids the storefront's own labels.

**Where it applies:**

- **Product and cart extraction** state the rule.
- **The Metadata verifier** states it, and adds that a verbatim label verifies the
  pack field. A label without a unit size, or in a different form from other
  labels, is not an omission.

**What is unchanged:**

- the completion guard, which still refuses anything but `completed: true`;
- the exact pack-label comparison against the order line;
- the schemas, the agreement checks, the policy and the 21 steps.

**Checks:**

- `po-cart-ai-reader` requires the rule's phrases in the verifier instructions.
- The metadata check, through the installed SDK, real browsers and the fixture,
  requires:
  - the rule in every product and cart extraction request;
  - the rule's phrases in each verifier request;
  - in every complete case, the cups extraction snapshot carrying `sleeve of 50`.

## Owner-reviewed locks and profile

**Why the pre-check refused:** a read-only G12 pre-check refused with `Worker
locks/guards added or removed`. Three of the 46 historical lock files from
October were absent.

- Practice profile names hash the fixture's origin, including a random port,
  with fixed demo IDs. During G11's browser checks at about 01:33 local time,
  three names matched October profiles that still held stale locks. Their owners
  were long gone, so the checks reclaimed and released them, as designed.
- G11 recorded two of those profiles. The third most likely came from a case that
  takes the lock without launching a browser.
- G11's own audits do not cover historical locks. The next `before` check does.
- The paid matrix also changed one profile outside any gate.

**The new rule:** by owner decision, these are accepted narrowly.

- **`REMOVED_HISTORICAL_LOCKS`** names exactly the three locks. Each is accepted
  only while absent. Its fingerprint entry may only be missing, never changed.
  The other 43 historical locks, including the retained stale lock's bytes, stay
  exact.
- **The paid-matrix profile** joins `PROFILES_REVIEWED`, pinned to the digest of
  every fingerprint entry under it. The list is now 31.
- **Source pins:** the audit suite pins both lists' exact text.

The observation auditor's `worker_locks` gains an optional `removed` set that
defaults to empty, so its own baseline checks are unchanged.

The new cases:

- accept a reviewed removed lock while it is absent;
- refuse it present, another historical lock removed, an unknown name, and its
  fingerprint entry changed instead of removed.

**Planted defects: 6 of 6 caught** — the historical-subset check dropped, removed
entries' metadata still required, the exact lock set weakened, a changed entry
accepted, the second lock check without the set, and the stale lock added to the
set. A seventh, a separate absence check, was equivalent to the exact set and was
removed.

**Remaining risk:** another port match can happen in any gate. The next `before`
check would refuse it the same way, and the owner would review it again.

## G12 binding

- **Gate:** `consumedGateRoots` and `CONSUMED` add `…-20261108`, and the gate and
  audit bind `…-20261109`.
- **Allowances:**
  - the prior paid allowance is the one the 2026-11-09 matrix consumed,
    `metadata-repair-acceptance-20261104/allowance.json`;
  - the next one is `metadata-repair-acceptance-20261109/allowance.json`;
  - the retired-unused pin for the 2026-11-01 allowance is unchanged and no longer
    applies.

**Read-only live check,** with writes blocked: `baseline_holds()` passed with
baseline `8ee75de7…`, preflight idle, 43 historical locks exact with the 3
reviewed locks absent, 30 gate locks accounted, and 1,791 gate profiles and the
31 reviewed profiles accounted.

## Next

1. **After this merges:** G12 preparation on the frozen merged source. No merges
   until the paid run finishes.
2. **The owner invokes G12 once, on AC power.**
3. **Only if G12 passes everything:**
   - start the loopback services;
   - check the paid build;
   - ask for fresh explicit authorization for one more matrix.

Rollback reverts this commit. The consumed roots and allowances, the observation
baseline, the profiles, the locks and the ledger are untouched.
