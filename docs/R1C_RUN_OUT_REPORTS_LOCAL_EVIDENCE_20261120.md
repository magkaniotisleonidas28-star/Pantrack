# R1c — "We just ran out" reports — local evidence

Recorded: 2026-11-20. Branch: `workstream-c/r1c-run-out-reports`, based on
`main` at `73df289`. This is step R1c of the
[stock levels roadmap](STOCK_LEVELS_AND_ALERTS_ROADMAP.md#r1--reliable-stock-levels)
under [decision 0011](decisions/0011-reliable-stock-levels.md) (point 6). It is
**local evidence only**: nothing was deployed, and no hosted or live service
was used.

## What changed

- **"We ran out" button** next to "Record waste", for everyone: owners and
  managers in the workspace header, employees in their own header. It opens
  "What ran out?":
  - choose one of the café's products that has stock set up;
  - add an optional note (up to 200 characters);
  - press "Report it".

  The report is saved, and a product already reported shows "Already
  reported". A second report for the same product joins the open one and says
  who reported it first. The button is hidden when exact inventory is off.
- **A report never changes stock.** Employees still cannot count stock.
- **Owners and managers** see "N products reported as run out" at the top of
  Inventory → Stock → Stock list, with who reported each, when, and the note:
  - **Confirm none left** ("Set oat milk to zero now?") records a count of
    zero at that moment. It goes through the existing count path, with the
    manager as the counter and the note "Confirmed run-out report". It closes
    every open report for that product.
  - **Dismiss** closes the reports without changing stock.
- **Saved together or not at all:** each "confirmed" outcome is written in the
  same database batch as the zero count, and only while stock is still at the
  version the count is saved against. If stock changes at that moment, or
  someone else resolves the report first, neither is saved. The report stays
  as it was, and the manager sees a clear message.
- **Repeats are safe:** a repeated tap or retry with the same reference
  returns the saved answer. A reference reused for different details is
  refused.

## Server and data

- Migration [`0053_run_out_reports`](../drizzle/0053_run_out_reports.sql)
  adds two tables:
  - **`run_out_reports`**: company, report id (the request reference),
    product, reporter id and email, note (200 characters or fewer), and time.
    It has an index by company, product and time.
  - **`run_out_resolutions`**: one row per report, keyed by company and
    report, linked to its report.
    - `confirmed` rows must carry the count id, and `dismissed` rows must not.
    - Only those two outcomes are allowed.
    - It is indexed by request reference, so a repeated request finds its
      saved answer.

  The tables are additive, and nothing existing changes. The service only
  inserts, so reports and outcomes form an audit trail.
- **Permission:** a new narrow `reportRunOut` for owners, managers and
  employees ([authorization](../src/lib/authorization.ts)). The new
  `run-out` route family uses it to list and report, and `operate` (owners
  and managers) to confirm or dismiss. Its mutations are audited like the
  other company routes.
- **Code:**
  - [service](../src/lib/d1-run-out-reports.ts);
  - [request rules](../src/lib/run-out-contract.ts);
  - [route](../src/app/api/inventory/run-out/route.ts): `GET` returns open
    reports and the products that can be reported; `POST` handles `report`,
    `confirm` and `dismiss`. It returns 404 when exact inventory is off.
  - [screens](../src/components/workspace/run-out.tsx), with
    [styles](../src/components/workspace/run-out.css).

## Verification

The complete local pipeline passed in this worktree on 2026-11-20 with the
changes staged on base `73df289`:
- `pnpm typecheck`;
- `pnpm test` (186 suites, including the new
  [run-out reports test](../tests/run-out-reports.mjs));
- `pnpm db:check` (54 ordered migrations match the schema and apply to a
  fresh database);
- `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`;
- `pnpm a8:check:browser`.

The new files, `employee-workspace.tsx` and `exact-inventory-panel.tsx` have
no ESLint findings. `workspace.tsx` has the same 5 errors and 1 warning as
`main`. Prettier is clean on the new files.

The run-out reports test runs on all migrations in an in-memory database. It
checks:
- **Reporting:**
  - a report never changes stock, events or counts;
  - a repeated tap returns the same report, and a reused reference with
    different details is refused;
  - a second report joins the open one;
  - products without stock, or from another company, are refused;
  - other companies see nothing.
- **Confirming:**
  - one zero count is recorded by the manager, with the note;
  - both racing open reports are closed;
  - a repeated confirm returns the saved answer without a second count;
  - a reused reference for a different action is refused;
  - an already resolved report is refused, and another company's report is
    not found.
- **Dismissing** changes no stock.
- **Simultaneous requests:**
  - stock changing just before the confirm saves neither the outcome nor the
    count, and the report stays open;
  - another manager dismissing at the same moment undoes the zero count.
- **Tables:** they refuse long notes, a confirmed outcome without a count, a
  dismissed outcome with one, unknown outcomes, and outcomes for missing
  reports.
- **Permissions:** all roles may list and report; only owners and managers
  confirm or dismiss; employees still cannot count stock.
- **Route:**
  - anonymous 401 and wrong company 403;
  - a role without permission 403;
  - employee report and list 200, with `private, no-store`;
  - employee confirm and dismiss 403;
  - invalid reference, a long note, and a product without stock 400;
  - manager confirm 200, then 409 when repeated with a new reference;
  - preview off 404.

One deliberate break was confirmed to fail the test, then restored: dropping
the "only while stock is unchanged" condition on the confirmed outcome.

A local Playwright check passed against fictional data in a preview copy:
- **As an owner (1440 px):** reported "Oat milk (demo)" with a note, saw the
  report on the stock list, confirmed none left, and oat milk was then zero.
- **As an employee (390 px)**, in a second fictional café: reported "Whole
  milk (demo)". A direct confirm request was refused with 403. No sideways
  scrolling.
- No page errors in either.

It was re-run after a final style fix. Screenshots were reviewed.

## Migration review

- **SQL:** two `CREATE TABLE` statements and two `CREATE INDEX` statements,
  with no triggers. They are generated by `drizzle-kit` from
  [the schema](../src/db/schema.ts), with the journal entry and
  `0053_snapshot.json`.
- **Fresh database:** `pnpm db:check` applies every migration to a fresh
  SQLite database. The test applies all 54 migrations in memory.
- **Compatibility:** the tables are new and nothing reads them except this
  feature. Older code ignores them.
- **Rollback:** turning exact inventory off hides the button and returns 404.
  A forward repair would be a new migration. The tables can stay empty or
  unused without effect.
- **Merge queue:** no other open pull request adds a migration (checked on
  2026-11-20).

## Not covered

- Hosted use and real staff.
- R1e will read reports from the last 4 weeks to raise a product's suggested
  spare stock.
