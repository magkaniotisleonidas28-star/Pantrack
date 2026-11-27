# Clover refunds that include a tip — local evidence

Recorded: 2026-11-26. Branch: `workstream-b/clover-refund-tip`, based on
`main` at `1887485` (after the [busy-period fix](CLOVER_SYNC_BUDGET_LOCAL_EVIDENCE_20261126.md)).
It is **local evidence only**: nothing was deployed, and no Clover account
was contacted. This fixes a finding from the P5 sandbox session of
2026-11-25/26 (step P5 of the
[Clover pilot roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md)).

## The finding

On the sandbox test merchant, the owner refunded a $5 latte paid in cash with
a $1 tip. Clover returned:
- `paymentState` `REFUNDED`, with the line marked refunded;
- one refund with `amount` 600 and `tipAmount` 100;
- an order `total` of 500.

The P1 rule compared the refund amount with the order total. 600 is more than
500, so Pantrack paused the refund as `clover_refund_mismatch` ("Refund
details don't add up"). Nothing was taken or put back, but an ordinary refund
asked the owner for review.

The cause: Clover's refund amount includes the tip given back, while the order
total doesn't include tips.

## What changed

[`normalizeCloverOrder`](../src/lib/clover-orders.ts):
- **The tip is taken out first.** Each refund counts as `amount − tipAmount`
  before the refunds are added up and compared with the order total. A refund
  with no `tipAmount` counts as before.
- **A refund of only the tip** gives nothing back for the items. The order
  stays as sold and reads exactly like the paid order, so no refund is
  recorded and nothing asks for review.
- **Still paused for review** (`clover_refund_mismatch`):
  - refunds whose item amount is more than the order;
  - a `tipAmount` that is negative, in part cents, not a number, or larger
    than its refund.

Refunds still put nothing back on the shelf
([decision 0003](decisions/0003-m4-sales-ingestion.md)), and a
readable refund still takes the next revision after the sale, as before. There
is no migration, and no API, permission or schema change.

## Tests

[`tests/clover-refund-tip.mjs`](../tests/clover-refund-tip.mjs) uses an
in-memory database from all migrations and a mocked Clover sandbox.
- **How each refund is read:**
  - the sandbox case (600 with a 100 tip on a 500 order) is a full refund, the
    same before and after Clover marks the order refunded;
  - 300 with a 100 tip is a partial refund;
  - a refund keeping the tip (500, tip 0), two refunds adding up to items and
    tip, and a refund with no tip field are full refunds;
  - a tip-only refund reads exactly like the paid order;
  - seven refunds that don't add up stay paused, including 600 with no tip.
- **The sandbox case through the real sync:** the tipped latte takes its cup;
  the refund then arrives on the same modified time and is received as its own
  revision, not paused; no sync error; no cup is put back; a further sync adds
  nothing.

Run against the code before the fix, the first check fails
("a full refund with its tip is a full refund"). The existing refund checks in
[`tests/clover-b6-local.mjs`](../tests/clover-b6-local.mjs) and
[`tests/clover-unreadable-orders.mjs`](../tests/clover-unreadable-orders.mjs)
pass unchanged.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 196 suites (including the new `clover-refund-tip`) |
| `pnpm db:check` | Passed: 57 ordered migrations match the schema; no new migration |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the changed source file or the new test. After
Prettier removed one blank line from the new test, `pnpm test` was run again
and passed, 196 suites.

## Not covered

- **The refund already paused on the development site** (order
  `4H2AW0KE5DR9G`) stays paused after a release: the order won't be read
  again. It can be dismissed on the Sales page.
- **Refunds of tips on card payments and partial refunds in Clover:** only
  the cash full refund was seen in the sandbox; the rest follows Clover's
  field meaning and is tested locally only.
- **The hosted re-run** needs a release and the owner's go-ahead.
