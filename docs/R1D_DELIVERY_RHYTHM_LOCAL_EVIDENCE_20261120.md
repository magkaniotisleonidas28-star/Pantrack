# R1d — Delivery schedule per supplier — local evidence

Recorded: 2026-11-20. Branch: `workstream-c/r1d-delivery-rhythm`, based on
`main` at `f5c4a4f`. This is step R1d of the
[stock levels roadmap](STOCK_LEVELS_AND_ALERTS_ROADMAP.md#r1--reliable-stock-levels)
under [decision 0011](decisions/0011-reliable-stock-levels.md) (point 2). It is
**local evidence only**: nothing was deployed and no hosted or live service
was used.

## What changed

- Each purchasing supplier profile has an optional **delivery schedule**:
  - "Order every" a whole number of days, 1–60;
  - "Delivery takes" a whole number of days, 0–60.

  The plan said 1–60 for both. Delivery allows 0 because some suppliers
  deliver the same day. Ordering every 0 days has no meaning.
- **Saved like every other supplier detail**: inside the supplier's versioned
  profile, with a change reason, through the existing save path. Each change
  is a new version, and older versions keep what they said. The schedule can
  be cleared again.
- **Optional and backwards compatible**: profiles saved before this step have
  no schedule and still read and save unchanged. A half-entered schedule (one
  number only) is refused in the browser before saving, and the server
  refuses anything outside the ranges.
- **Who can change it**: owners and managers of the company, exactly as for
  the rest of the supplier profile. Employees and other companies are refused.
- **Screen** ([purchasing suppliers](../src/components/workspace/purchasing-suppliers.tsx)):
  two fields with a short explanation. The saved supplier shows "Order every 7
  days · delivery takes 2 days" (or "the same day", or "Delivery schedule not
  set").
- **Rules** ([supplier contract](../src/lib/purchasing-supplier-contract.ts)):
  `deliveryRhythmSchema` and the plain wording helper `deliveryRhythmText`.

Unchanged: the database schema (no migration), mappings, order drafts,
documents and every other supplier field. R1e will use the schedule to suggest
levels.

## Verification

The complete local pipeline passed in this worktree on 2026-11-20 with the
final changes staged on base `f5c4a4f`:
- `pnpm typecheck`;
- `pnpm test` (187 suites, including the new
  [delivery schedule test](../tests/supplier-delivery-rhythm.mjs) and the
  existing purchasing supplier tests);
- `pnpm db:check` (54 migrations, none added);
- `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`;
- `pnpm a8:check:browser`.

ESLint reports the same single finding in `purchasing-suppliers.tsx` as
`main` (an unescaped apostrophe), and none in the other changed files. The new
test and contract are Prettier-clean. `purchase-order-drafts.css` is
compact-formatted on `main` and was only appended to.

The new test checks:
- **Schedule rules:**
  - no schedule, a cleared schedule, same-day delivery and both 60-day limits
    are accepted;
  - 0 or 61 days between orders, negative or 61 delivery days, fractions,
    text numbers, a missing half and extra fields are refused;
  - the plain wording, including "1 day" and "the same day".
- **Saving,** on the shared fictional supplier database:
  - version 1 without a schedule;
  - version 2 with "every 7 days, 2 days' delivery";
  - version 3 cleared;
  - history keeps all three, and version 1 is unchanged;
  - an out-of-range value and a stale version are refused.
- **Access:** anonymous, employee and another company's manager are
  refused; the owner can save.

A local Playwright check against fictional data passed at 1440 px and 390 px
wide:
- a half-entered schedule is refused with a clear message;
- the saved schedule shows "Order every 7 days · delivery takes 2 days" (or
  "the same day");
- no page errors and no sideways scrolling.

Screenshots were reviewed after moving the help text to span the full form
row.

## Not covered

- Hosted use and real suppliers.
- "Your suppliers" under Suppliers & automation is a separate, older list. The
  schedule belongs to the purchasing supplier profiles that products are
  mapped to, which R1e reads.
