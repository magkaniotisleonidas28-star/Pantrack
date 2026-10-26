# C7/M10 groundwork — owner spending limits, Part 1 (server rules)

Date: 2026-10-25. Scope: Part 1 of the
[owner spending limits plan](C7_OWNER_SPENDING_LIMITS_PLAN_20261025.md).
Status: local, fictional implementation verified. **No checkbox advances; C4/M8
and C7/M10 remain open.**

> **Correction (2026-10-25, Part 2):** this Part 1 evidence ran on `node:sqlite`, which
> allows LIKE/GLOB patterns of up to 50,000 bytes. Cloudflare D1 allows only 50. The ISO-time
> GLOBs in `0035` therefore made every owner-set time zone, policy and owner-window
> reservation fail on D1. Fixture-policy paths never evaluated them. Migration `0036`
> recreates the three guards with an exact canonical `strftime` check, and a new suite
> fails any active pattern over the limit. See the
> [Part 2 record](C7_OWNER_SPENDING_LIMITS_SCREEN_LOCAL_EVIDENCE.md#d1-pattern-limit-repair).
> The results below are unchanged, but they did not prove D1 compatibility.

## In plain terms

The café owner can now set four spending limits for Pantrack's test-only cart
preparation: per order, per day, per month and in progress. The owner also sets
the café's time zone, so Pantrack knows when a day or month starts.

- **Only the owner** can see or change these settings.
- **Loosening needs the password.** Raising or removing a limit, setting limits for
  the first time, or changing the time zone needs a fresh password confirmation.
- **Tightening never does.**
- **Every change is kept forever**, with who made it and when, and is added to the
  security log automatically.
- **Pantrack refuses carts that would go over a limit.** It says which limit
  applies. Only the owner sees the amounts; a manager just sees which limit
  blocked them.
- **The database makes the final check at the moment of saving.** Two orders
  submitted at the same instant can't both slip through on the last of today's
  budget.
- **Work cancelled before preparation began gives its budget back.** Work that
  started always counts, even if it was later cancelled or settled.

There is no owner settings screen yet; that is Part 2. Everything stays inside
the test-only preview, which is off by default. There are no payments, no real
suppliers and no purchasing.

## Changes

| File | Change |
| --- | --- |
| [`0035_owner_spending_limits.sql`](../drizzle/0035_owner_spending_limits.sql) | New, additive, local only. Details below. |
| [`po-cart-spending-limits-contract.ts`](../src/lib/po-cart-spending-limits-contract.ts) | Request schemas, IANA time-zone validation, exact local day/month windows, the loosening rule and the shared usage SQL |
| [`d1-po-cart-spending-limits.ts`](../src/lib/d1-po-cart-spending-limits.ts) | Owner-only `get`, `setLimits` and `setTimeZone`, with replay-safe operation identity, expected versions and recent-password checks |
| [`/api/po-cart-spending-limits`](../src/app/api/po-cart-spending-limits/route.ts) | Gated like the other cart routes: `PANTRACK_CART_PREVIEW=enabled` on `127.0.0.1`, with the existing company wrapper and CSRF checks |
| [`d1-po-cart-authorizations.ts`](../src/lib/d1-po-cart-authorizations.ts) | Owner-set policies get a clear `limit_exceeded` pre-check, and the authorization payload records its window. Test policies keep the exact original shape and behavior. |
| [`reauthentication.ts`](../src/lib/reauthentication.ts) | The existing 5-minute `recentlyVerified` rule, moved unchanged into a dependency-free module; `auth.ts` re-exports it |
| Fixture SQL (8 sites in tests and local check scripts) | Positional policy inserts now name their columns |

### Migration `0035`

- It adds `company_time_zones`, which is append-only: an update or delete aborts.
  Versions are sequential, the writer must be an owner, and names are
  shape-checked.
- It adds nullable columns to `po_cart_budget_policies`: `per_day_minor`,
  `per_month_minor`, `actor`, `created_at`, `operation_id` and `fingerprint`.
- It recreates `po_cart_policy_insert_guard`:
  - A row without an actor keeps the old fixture shape. Such a row cannot follow
    an owner-set row.
  - An owner-set row needs all of these:
    - a current owner;
    - a time zone;
    - a per-day limit;
    - per order ≤ per day ≤ per month, when a month limit is set;
    - per order ≤ in progress;
    - its replay identity.
- Audit triggers write `security_audit` for every owner-set policy and every
  time-zone version.
- It recreates `po_cart_reservation_guard`. For owner-set policies, it also
  requires the authorization's stored window to:
  - use the current time-zone version and name;
  - have well-formed ISO bounds;
  - contain the authorization's own `created_at`;
  - nest the day inside the month;
  - give 22–26 hour days and 28–31 day months.

  It then sums the caps for the day and the month. Work cancelled before it
  started is excluded; started work counts, including after reconciliation
  releases it.

## Verification

| Suite | What it proves |
| --- | --- |
| [`po-cart-spending-limits`](../tests/po-cart-spending-limits.mjs) | See the list below. |
| [`po-cart-spending-limits-api`](../tests/po-cart-spending-limits-api.mjs) | HTTP denial for anonymous, employee, manager, wrong-company and unknown users. The default-off and loopback gates, actual CSRF/origin checks, strict intent, the password rule over HTTP, conflicts and private responses. A manager refusal carries no amounts. |
| [`po-cart-spending-limits-migration`](../tests/po-cart-spending-limits-migration.mjs) | `0035` split by Wrangler's statement splitter keeps each trigger whole. Fresh and populated upgrades keep every table and test policy, and retained permission stays valid. New authorizations under a test policy keep the legacy shape. The owner's first limits count retained exposure. Foreign-key and integrity checks pass. |
| [`po-cart-spending-limits-reconciled`](../tests/po-cart-spending-limits-reconciled.mjs) | Started work released by reconciliation still counts for the day and month, in both the pre-check and the guard. The exact remaining budget is allowed. |

The main suite covers:

- **Windows:** exact US spring-forward and fall-back days, Tokyo, a year end and
  a linked name (`Asia/Kolkata`). First-instant and last-instant properties hold
  for six further zones, including a skipped midnight and 30-minute DST.
- **Access:** owner-only reads and writes.
- **Password rule:**
  - a missing, stale or recovery-session confirmation is refused;
  - tightening needs no password;
  - first setup and each loosening kind do.
- **History:**
  - exact replay returns the original receipt, and a conflicting replay is
    refused;
  - stale versions conflict;
  - edits and deletes, fixture rows over owner rows, manager writers and invalid
    orderings are refused by the database;
  - every change is audited.
- **Enforcement:** each of the four limits refuses at exactly one cent over and
  allows exactly at the limit, at the café's local midnight and month boundary.
  Cancelled-before-start work frees budget, and started work does not.
- **The database guard decides:**
  - with the service pre-check bypassed, the guard still refuses daily and
    monthly overruns and seven kinds of tampered window;
  - a time-zone change between the check and the commit is refused;
  - of two concurrent authorizations for the last daily budget, exactly one
    commits;
  - an owner demoted at commit time saves nothing.
- **Company isolation.**

**Seventeen planted defects were each caught:**

1. no daily sum in the guard;
2. no monthly sum, caught after a guard-bypass case was added (it first
   survived);
3. counting cancelled-before-start work in the guard;
4. not counting released started work;
5. ignoring the time-zone version and name;
6. any window length;
7. a fixture row superseding an owner row;
8. a manager writing an owner row;
9. no audit;
10. loosening never asking for the password;
11. 24-hour days;
12. a manager managing limits;
13. a time-zone change without the password;
14. accepting a recovery session;
15. managers seeing amounts;
16. no pre-check;
17. the pre-check counting cancelled-before-start work.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **117 suites** (113 plus 4 new) |
| `pnpm db:check` | Passed, 36 ordered migrations |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Applied `0035` through Wrangler |
| `pnpm test:local` | Passed |
| All six commands again, after merging `origin/main` (`47922df`, the saved-draft export and history work, with no migration) | Passed, **122 suites** |
| Existing cart suites (authorization, API, persistence, jobs, sources, reconciliation and their migrations) | Passed |
| `pnpm cart:worker:check:http` against `pnpm dev:cart-worker`, in an isolated clean clone | Passed, with ports freed |
| `pnpm cart:manager:check:launcher`, in the same clone; it uses the edited browser fixture | Passed |

**Not claimed:** `scripts/po-cart-authorization-http-check.mjs` and
`scripts/po-cart-jobs-http-check.mjs` against `pnpm dev:cart`. In the isolated
clone, they fail the same way on unchanged `main` (`9229f9f`), before any limit
code runs:

- the authorization check's anonymous request returns 503, not 401;
- the jobs check's Wrangler fixture command exits 1.

This is a pre-existing check or environment issue and is left for separate
follow-up. Served checks were run in the clone so that real `.sites-runtime`
profiles, locks and evidence stay unchanged for the observation baseline.

## Limits, rollback and next

- This is local fictional evidence only. Nothing was deployed, no remote data
  changed, and no supplier, model, payment or checkout was involved.
- Pantrack still cannot limit spending at a supplier's own checkout, and the API
  says so.
- The password check runs in the service against the session's recorded
  confirmation time. The database independently enforces owner membership at
  commit time.
- **Rollback:** turn off `PANTRACK_CART_PREVIEW`. Never delete versions or rewrite
  `0035`; forward repair uses a new migration.
- **Next (separately reviewed):** Part 2, the owner settings screen. Check for
  overlap with the concurrent signed-in manager integration first. The other
  contributor confirmed that their export work needs no migration, so `0035` is
  the only schema change in the queue.
