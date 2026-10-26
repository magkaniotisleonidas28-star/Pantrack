# C7/M10 groundwork: owner spending limits — plan (2026-10-25)

Status: **plan only.** No code, schema or runtime change has been made, and no
checkbox advances. C4/M8 and C7/M10 remain open.

## In plain terms

Pantrack can prepare supplier carts for a manager to check out. Today a
"spending guardrail" stops it from preparing carts above a set amount. However,
the amounts are test values written into the tests ($500 per order, $1,000 in
progress), and nobody can set or change them.

This work lets the **café owner set real limits**:

- the most one order can be;
- the most all orders started **in one day** can add up to;
- the most all orders started **in one month** can add up to;
- the most that **orders still in progress** can add up to.

Pantrack's server will refuse to prepare any cart that would go over one of these
limits. Only the owner can see or change them. Loosening a limit asks for the
owner's password again. Every change is kept permanently, with who made it and
when.

Everything stays inside the existing test-only cart preview, which is off by
default and uses fake companies and fake money. Nothing goes live and no real
purchase becomes possible. The work is split into two pieces. Part 1 is the
server rules and Part 2 is the owner's settings screen. Each piece is reviewed
separately.

## Owner decisions (2026-10-25)

| Question | Decision |
| --- | --- |
| Timing | Build now as **local groundwork for C7/M10**, with fake data only. C7's other parts remain open. These include payment responsibility, payment setup, final-price reconciliation and pilot use. |
| Limits | All four: per order, per day, per month and in-progress total. |
| Clock for days and months | The owner sets the café's **time zone** once. It is stored so later features, such as C6 weekly reminders, can reuse it. |
| Password confirmation | Only when **loosening**: raising or removing a limit, setting limits for the first time, or changing the time zone. Tightening never asks. |

## Where it fits

- [M10](PANTRACK_MILESTONES.md#m10--purchasing-limits-and-financial-controls)
  asks for these items:
  - per-order, per-day and optional per-month limits;
  - reauthentication for high-impact limit changes;
  - an audit of every limit change;
  - owner-only access.
- The [permission matrix](MILESTONE_READINESS.md) gives spending limits to owners
  only; managers and employees are denied.
- The [integration roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md) says that owners
  control spending limits and that managers prepare orders.
- C7 itself is sequenced after M8 acceptance and the payment-responsibility
  decision. This groundwork does not change that order for C7's acceptance. It
  only builds the limit controls early, against fakes.

## What already exists

| Piece | Today |
| --- | --- |
| `po_cart_budget_policies` | This table is versioned and append-only: an update or delete aborts, and versions must be sequential. It holds per order and outstanding total only. |
| Enforcement | `po_cart_reservation_guard` checks the order cap and the outstanding total inside the same database batch as the authorization. Concurrent authorizations therefore cannot both slip under the total. |
| Authorization | It records the policy version it was checked against. A newer policy version makes older pending checks stale. |
| Re-authentication | `recentlyVerified` gives a 5-minute password confirmation. Ownership transfer already uses it, through Pantrack's single sign-in path. |
| Audit | `security_audit` and the `audit` helper. |
| Time zone | **None stored anywhere.** |

The separate supplier-simulation spending policy (migration `0024`) is unrelated
and stays unchanged.

## Part 1 — server rules (one reviewable outcome)

### Schema (one new additive migration; the number is assigned at merge time)

1. **`company_time_zones`** holds `company_id`, `version`, `time_zone`, `actor`
   and `created_at`.
   - It is append-only: versions are sequential, and an update or delete aborts.
   - The server validates the IANA name with `Intl`. The database checks its
     shape and length.
2. **`po_cart_budget_policies` gains columns** through `ALTER TABLE … ADD COLUMN`:
   - nullable `per_day_minor` and `per_month_minor`;
   - `time_zone_version`, `actor`, `created_at` and `reason`.
3. **Two kinds of row:**
   - Existing rows and fixture rows have no actor. They keep today's meaning:
     fictional test policy, with no day or month limit.
   - An owner-set row (actor present) must meet all of these:
     - the actor is a current owner;
     - a per-day limit is set;
     - per order ≤ per day;
     - per day ≤ per month, when a month limit is set;
     - per order ≤ in-progress total;
     - the time-zone version is the latest one.
4. **Recreated insert guard** for the two row kinds. This follows the Wrangler
   splitter rule for `CASE`/`END` whitespace and is verified through local
   migration apply.
5. **Recreated `po_cart_reservation_guard`.** Besides today's checks, it sums the
   caps of the same company's authorizations whose `created_at` falls inside the
   day window and the month window.
   - The windows are UTC instants computed by the server from the café's time
     zone. They are stored in the authorization payload with the time-zone
     version. The trigger requires the new authorization's own `created_at` to
     be inside them.
   - Cancelled-before-start authorizations are excluded, because nothing was
     prepared. Started work counts even if it is later cancelled, because money
     may have been spent.

### Service and API

- **New module** `src/lib/d1-po-cart-spending-limits.ts`, with a focused contract
  file.
  - `get`: owner only. It returns the current limits, the time zone, today's and
    this month's usage, and the version history.
  - `set`: owner only, with CSRF checks, a UUID operation identity for replay and
    an expected version. It classifies the change as tightening or loosening and
    requires `recentlyVerified` for loosening. It writes the version row and a
    `security_audit` entry in one batch.
  - `setTimeZone`: owner only. It always requires `recentlyVerified`.
- **Route** `/api/po-cart-spending-limits`, gated exactly like the existing cart
  routes: `PANTRACK_CART_PREVIEW=enabled` on `127.0.0.1`, off by default.
- **Authorization change:** `D1PoCartAuthorizations.authorize` computes the
  windows and checks each limit first. That gives a clear refusal naming the
  limit: `per_order`, `per_day`, `per_month` or `outstanding`. The trigger stays
  the final word under concurrency.
  - Owners see amounts in refusals.
  - Managers see only which owner limit blocked them, following the permission
    matrix.
  - Missing limits still block everything, as today.
- **Fixed explanation text:** Pantrack limits only what it prepares. It cannot
  enforce spending at the supplier's own checkout.

### Tests (offline, fictional)

- **Permissions:**
  - anonymous, wrong-company, employee, manager and revoked membership are
    denied;
  - an owner is allowed;
  - CSRF and cross-origin requests are refused.
- **Password rule:**
  - tightening works without the password;
  - loosening, first setup and time-zone changes need it;
  - a stale verification (more than 5 minutes) or a recovery session is refused.
- **History:**
  - updates and deletes of versions abort;
  - versions are sequential;
  - each change has its audit entry;
  - exact replay returns the original receipt;
  - a conflicting replay is refused.
- **Enforcement:** each of the four limits refuses at exactly one minor unit over
  and allows exactly at the limit.
  - **Concurrency:** two authorizations racing for the last daily budget; only
    one commits.
  - Cancelled-before-start work frees day and month budget, and started work
    does not.
- **Time:**
  - spring-forward and fall-back days in a DST zone, and a non-DST zone;
  - month and year boundaries;
  - a time-zone change during a day.
- **Compatibility:**
  - legacy fixture policies and every existing cart check keep working;
  - a populated upgrade preserves prior rows;
  - a fresh database, the Wrangler statement splitter and `db:check` pass.
- **Planted defects** confirm the tests catch:
  - a missing window;
  - a loosening change without the password;
  - a manager allowed;
  - cancelled-before-start work counted, or started work not counted.
- **The complete local pipeline** from `AGENTS.md`.

## Part 2 — owner settings screen (separate outcome, after Part 1)

- **An owner-only panel in the cart preview** with:
  - the four limits and the time zone;
  - today's and this month's usage;
  - the change history;
  - the fixed "cannot enforce at supplier checkout" note.
- **The existing password confirmation prompt**, reused for loosening.
- **Served checks** at desktop and narrow widths, with keyboard use and the
  manager/employee denial views.
- **No overlap:** before starting, check that this does not overlap the
  concurrent signed-in manager integration.

## Coordination and limits

- **Migration queue:** only one schema-bearing change may be in the merge queue at
  a time. Before Part 1's migration is generated, confirm with the other C4
  contributor whether their export snapshot needs a migration, and which merges
  first. `schema.ts` and the journal belong to the current merge owner.
- **Not included:**
  - payment setup or payment data;
  - final-price reconciliation;
  - any hosted, supplier, model or production change;
  - M10's other tasks.

  No milestone checkbox advances from this local fictional work.
- **Rollback:** turn off `PANTRACK_CART_PREVIEW`. Rows are never deleted. Forward
  repair uses a new migration.
