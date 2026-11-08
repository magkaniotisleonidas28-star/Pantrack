# C4 availability evidence and G9 binding — 2026-11-04

This follows the [2026-11-04 paid matrix](C4_FULL_OFFLINE_GATE_RUN_20261101.md#paid-matrix).
In that run, compact/ambiguous was held by the fail-closed completion guard because
the Metadata verifier was unsure of availability shown only by the add-to-cart
control. By owner decision, the strict completion rule stays. This change clarifies
the evidence instead, and binds G9.

Local evidence only, with mocked inference. No real model call, supplier access,
checkout, deployment or hosted-data change occurred. **C4/M8 remain open**, and no
checkbox advances.

## Availability evidence

[`ai-reader.ts`](../scripts/po-cart-worker/ai-reader.ts) adds one shared rule,
`availabilityEvidence`:

> A product is available when it shows an enabled add-to-cart control and no
> out-of-stock or unavailable text. It is unavailable when its add-to-cart control
> is disabled or out-of-stock or unavailable text is shown.

**Where it applies:**

- **Product extraction** states the rule.
- **The Metadata verifier** states it, and adds that the visible control verifies
  availability from the snapshot. A lack of stock text alone does not make
  availability unverifiable.

**What is unchanged:**

- the completion guard, which still refuses anything but `completed: true`;
- the schemas, the agreement checks, the policy and the 21 steps.

The fictional storefront already matches the rule. Its only unavailable product
shows `Out of stock` text and a disabled `Add to cart` button; every other product
shows an enabled button and no stock text.

**Checks:**

- `po-cart-ai-reader` requires the rule's phrases in the verifier instructions.
- The metadata check, through the installed SDK, real browsers and the fixture,
  requires:
  - the rule in each product extraction request;
  - `Add to cart` in the snapshot the model receives;
  - the rule's phrases in each verifier request.

## Owner-reviewed profiles

**Why the pre-check refused:** a read-only G9 pre-check refused with `Profiles
changed since the baseline`. Two things used browsers outside any gate on
2026-11-04:

- the paid matrix created 12 profiles;
- offline metadata checks of this change created 17.

One of those offline runs reused the name of a historical profile from 2026-10-11:
the same fixture IDs met a recycled random port. No gate records any of these
profiles, and the run evidence does not name them.

**The new rule:** by owner decision, these 30 profiles are accepted narrowly.
`PROFILES_REVIEWED` pins each name to a digest of every fingerprint entry under it,
which includes mode, size, mtime, inode and content hash.

- **Accounted:** a reviewed profile is accounted only while that digest holds
  exactly.
- **Never accounted:** the active profile, lock files and every other profile stay
  under the existing rules.
- **Source pin:** the audit suite pins the list's exact text and its count of 30.

The new cases:

- accept an exactly pinned profile;
- refuse a changed or added entry under it, another unpinned profile, a pinned
  active profile, and an unrecorded lock for a pinned profile.

**Planted defects: 4 of 4 caught** — the active-profile exclusion dropped, the
digest comparison ignored, the digest narrowed to the directory entry, and the
reviewed set unused.

**Lesson:** browser-based checks run outside a gate change the shared profile
directory. After this change, until the paid run, the only browser use is G9 itself
and then the paid matrix.

## G9 binding

- **Gate:** `consumedGateRoots` and `CONSUMED` add `…-20261101`, and the gate and
  audit bind `…-20261104`.
- **Allowances:**
  - the prior paid allowance is the one the 2026-11-04 matrix consumed,
    `metadata-repair-acceptance-20261101/allowance.json`;
  - the next one is `metadata-repair-acceptance-20261104/allowance.json`;
  - the retired-unused pin for the 2026-11-01 allowance is unchanged and no longer
    applies.

**Read-only live check,** with writes blocked:

- the migrated-state check passed;
- `baseline_holds()` passed:
  - baseline `8ee75de7…`, with preflight idle;
  - the 46 historical locks exact, and 24 gate locks accounted;
  - 1,302 gate profiles and the 30 reviewed profiles accounted.

## Next

1. **After this merges:** G9 preparation on the frozen merged source. No merges
   until the paid run finishes.
2. **The owner invokes G9 once, on AC power.**
3. **Only if G9 passes everything:**
   - start the loopback application and storefront with
     `PANTRACK_CART_BROWSER_LOCAL=enabled PANTRACK_CART_WORKER_LOCAL=enabled pnpm dev:cart`;
   - confirm both answer HTTP 401, and check the paid build;
   - ask for fresh explicit authorization;
   - then create the allowance and run the one remaining matrix.

Rollback reverts this commit. The consumed roots and allowances, the observation
baseline, the profiles and the ledger are untouched.
