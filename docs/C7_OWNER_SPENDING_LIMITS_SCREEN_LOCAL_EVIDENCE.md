# C7/M10 groundwork — owner spending limits, Part 2 (owner screen and D1 repair)

Date: 2026-10-25. Scope: Part 2 of the
[owner spending limits plan](C7_OWNER_SPENDING_LIMITS_PLAN_20261025.md), plus a repair
to [Part 1](C7_OWNER_SPENDING_LIMITS_LOCAL_EVIDENCE.md) found while building it.
Status: local, fictional implementation verified. **No checkbox advances; C4/M8 and
C7/M10 remain open.**

## In plain terms

Owners now have a **Spending limits** page in the workspace menu. It appears only for
owners, and only when the test-only cart preview is switched on. The page:

- shows how much has been used **today**, **this month** and **in progress**, against
  each limit, with the café-time day and month;
- lets the owner set the café's **time zone** and the four **limits**, in dollars;
- asks for the owner's **password** before anything that loosens a limit, and before
  any time-zone change. Tightening a limit never asks;
- keeps a **change history**, and says plainly that Pantrack cannot limit spending at
  a supplier's own checkout.

Managers and employees don't see the page, and the server refuses them anyway.

**A real bug was found and fixed.** Pantrack's database, Cloudflare D1, refuses
text-matching patterns longer than 50 characters. One of Part 1's date checks was
longer. The offline test database allows much longer patterns, so every Part 1 test
passed, but on D1 an owner could never save a time zone or limits. A new migration
replaces those checks with a short, exact one. A new test now fails if any database
rule uses a pattern that's too long.

**A note on the local preview:** practice sign-in has no password, so the password
step can't succeed there. In the preview an owner can view and tighten limits, and
the screen shows the password prompt for anything else. The full "confirm your
password, then save" path is proven by the server and HTTP tests from Part 1. It
needs a real signed-in account to try by hand.

## D1 pattern-limit repair

[`0036_owner_spending_limits_d1_patterns.sql`](../drizzle/0036_owner_spending_limits_d1_patterns.sql)
drops and recreates three guards from `0035`, and nothing else changes:

- `company_time_zone_insert_guard`
- `po_cart_policy_insert_guard`
- `po_cart_reservation_guard`

Each 92-byte ISO-time `GLOB` becomes an exact canonical check,
`strftime('%Y-%m-%dT%H:%M:%fZ',x)` compared with `x`. Window bounds use `=`, so a missing
bound fails closed. `0035` is not rewritten.

| Evidence | Result |
| --- | --- |
| [`d1-pattern-limits`](../tests/d1-pattern-limits.mjs), new | It reads every active trigger, view and table after all migrations and fails any LIKE/GLOB literal over 50 bytes. **Before `0036` it failed** and named exactly the six patterns in the three guards; nothing older exceeds the limit. After `0036` it passes. |
| [`po-cart-spending-limits`](../tests/po-cart-spending-limits.mjs) | It adds a time-zone row and an owner policy whose `created_at` is malformed, and a window whose bounds use `+00:00` instead of `Z`. All are refused. |
| [`po-cart-spending-limits-migration`](../tests/po-cart-spending-limits-migration.mjs) | `0035` then `0036`, split by Wrangler, keeps each trigger whole. Fresh and populated upgrades pass. |
| Planted defects | Three new ones were each caught: no time-zone `created_at` format check, no policy `created_at` format check, and no window-bound format check. Part 1's 17 were re-pointed at the recreated guards in `0036` (the audit trigger stays in `0035`) and were each caught again. |
| Served on workerd's local D1 | Owner time-zone and policy rows, which previously failed with `LIKE or GLOB pattern too complex`, now save. A tightened limit saves through the API. |

## Owner screen

| File | Change |
| --- | --- |
| [`spending-limits.tsx`](../src/components/workspace/spending-limits.tsx) | New; details below. |
| [`spending-limits.css`](../src/components/workspace/spending-limits.css) | Usage figures, a single-column narrow layout, and one divider per section, which outranks the workspace-wide preview fieldset rule |
| [`workspace.tsx`](../src/components/workspace/workspace.tsx) | The panel is mounted for owners only. The **Spending limits** menu entry appears only when the panel reports the preview available. Unsaved limits count as unsaved work. |
| [`po-cart-spending-limits-ui-check.mjs`](../scripts/po-cart-spending-limits-ui-check.mjs) and `pnpm cart:spending-limits:check` | A new served browser check |

How `spending-limits.tsx` behaves:

- **Loading:**
  - it calls `/api/po-cart-spending-limits`;
  - 403 or 404 hides it quietly;
  - it shows current use with café-time windows, the time-zone form, the limits form
    and the change history;
  - the API's fixed note about external checkout is always shown.
- **Saving:**
  - the browser checks the order of the limits before sending: per order ≤ per day ≤
    per month, and per order ≤ in progress;
  - `reauthentication_required` opens a password prompt. The prompt is scrolled fully
    into view and focused, and it blocks other edits. It uses the existing
    `/api/auth` `reauthenticate` action, then resends the **identical** request with
    the same operation identity;
  - the password is cleared after every attempt;
  - an uncertain save offers **Retry the same save** with the same body;
  - nothing is stored in browser storage.

**Not changed:** the manager cart screen, owned by the concurrent manager integration.
It already shows the server's refusal text, such as "over the owner's daily spending
limit".

## Verification

| Command | Result |
| --- | --- |
| [`spending-limits-screen`](../tests/spending-limits-screen.mjs) | Wiring pins:<ul><li>owner-only, preview-gated menu and mount;</li><li>unsaved-work tracking;</li><li>same-request resend after confirmation;</li><li>password clearing;</li><li>exact retry;</li><li>only two new-identity sites;</li><li>no browser storage.</li></ul> |
| `pnpm cart:spending-limits:check` against `pnpm dev:cart-browser-worker`, in an isolated clean clone (real `.sites-runtime` unchanged) | **Passed 4 times on the final screen, with ports freed.** It covered:<ul><li>at 390 px and 1440 px: values, grouped amounts, current use and the external-checkout note, with no horizontal scroll;</li><li>a client ordering error saves nothing;</li><li>tightening saves without a password, and history shows the new owner version;</li><li>loosening and a time-zone change each open the focused, in-view password prompt;</li><li>an unconfirmable password leaves limits and time zone unchanged, and clears the field;</li><li>keyboard order through the limit fields;</li><li>with a second fictional owner keeping the company owned, a manager and an employee see no menu entry and get 403 from the API;</li><li>no page errors.</li></ul> |
| Visual review | Desktop, narrow and prompt screenshots. The review fixed a doubled section divider, ungrouped dollar amounts, and a prompt that could appear out of view. |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 124 suites on the branch; see the final row for after the merge |
| `pnpm db:check` | Passed, 37 ordered migrations |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Applied `0036` through Wrangler |
| `pnpm test:local` | Passed |

## Limits, rollback and next

- This is local fictional evidence only. Nothing was deployed, no remote data
  changed, and no supplier, model, payment or checkout was involved. Hosted D1 has
  not run `0035` or `0036`, because the C2 online release is deferred.
- The local preview cannot demonstrate a confirmed loosening, because practice
  sign-in has no password. Server and HTTP tests prove that path.
- **Rollback:** turn off `PANTRACK_CART_PREVIEW`. Never delete versions or rewrite
  `0035` or `0036`; forward repair uses a new migration.
- **Next:** the remaining C7/M10 outcomes, starting with payment responsibility, are
  owner decisions. C4 continues with the roadmap's separate outcomes.
