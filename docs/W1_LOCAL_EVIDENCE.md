# W1 — Quick ingredient waste: local evidence

Date: 2026-09-30. Workstream A, W1 in the
[waste/menu analysis roadmap](WASTE_AND_MARGIN_ROADMAP.md).
Status: implemented and verified locally; usability acceptance remains open.

## Outcome and boundaries

Staff can open **Record waste** throughout the workspace, choose an ingredient,
enter a quantity and reason, and save without leaving an unfinished order.
Favorites, recent ingredients, search, and manager-configured quantity shortcuts
make repeated entries quick. A compact panel supports phone/tablet layouts and
the existing light and dark themes. Reasons are spilled, spoiled/expired,
preparation error, and other; notes are optional. Time defaults to now.

Only ingredients with an active classified exact stock unit and opening balance
are offered. Prepared-item recipe waste, linked corrections, waste history/cost
reports, offline queues, and margin analysis remain separate roadmap outcomes.
No supplier or POS was contacted, no order or sale was created, and no remote
migration, deployment, pilot data, or production change was performed.

## Contracts and implementation

- `GET /api/waste` returns company-scoped ingredient names, units, versions,
  shortcuts, and server time. It excludes prices, balances, and staff history.
- `POST /api/waste` permits owner/manager/employee membership in that company.
  The session supplies the actor. Strict input permits only waste quantity,
  reason, note, time, and the frozen operation/version identity. Staff cannot
  use this endpoint for counts, receipts, purchases, or recipe edits.
- `/api/waste/shortcuts` requires manager/owner access. Up to six shortcuts
  use the ingredient's current stock unit. Revision/configuration checks reject
  stale saves; reclassification hides earlier shortcuts until reconfigured.
- Both routes use the existing `PANTRACK_EXACT_INVENTORY_PREVIEW=enabled` gate.
  Successful responses are private/no-store. Mutation attempts/results are
  audited by company, session actor, and operation reference.
- A structured reason is stored in the exact movement transaction with its
  stock effect. Replay compares the entire receipt, including reason, actor,
  note, quantity, unit, time, and expected version, before confirming success.
  Competing saves cannot silently overwrite stock.
- Existing receipts are confirmed before current unit conversion, so a later
  custom-unit revision cannot invalidate an earlier saved entry's safe retry.
- Movement confirmation reads the committed receipt rather than treating D1's
  acknowledgment change count as proof. The legacy projection remains in the
  active stock unit even when a compatible historical entry unit is used.
- The browser freezes and persists the request in per-person/company tab
  storage before sending. Storage failure stops submission. An uncertain
  network/server/authentication result retains that request, disables editing,
  and offers **Retry same save**. Reload restores it; nothing is submitted
  automatically. Favorites/recent preferences cannot block pending recovery.
- A confirmed success offers **Record another**. Known stock/count/version
  failures preserve entered details. Offline entry does not claim success.
  An unfinished entry prompts before discard/company switching. A pending
  confirmation remains with its original company in that browser tab.

Relevant code: [recorder](../src/components/workspace/waste-recorder.tsx),
[service](../src/lib/d1-waste.ts), [contract](../src/lib/waste-contract.ts),
[client retry](../src/lib/waste-client.ts),
[authorization](../src/lib/authorization.ts), and
[exact movement service](../src/lib/d1-inventory-management.ts).

## Schema and compatibility review

[Migration `0018`](../drizzle/0018_w1_quick_waste.sql) adds a nullable
`inventory_events_exact.waste_reason` column and the `waste_shortcuts` table.
The table has a company/product primary key, company-scoped operation uniqueness,
and a composite foreign key to the immutable inventory configuration. Its
revision supports guarded updates. No used migration was rewritten.

The generated [snapshot](../drizzle/meta/0018_snapshot.json) and
[journal](../drizzle/meta/_journal.json) were reviewed: one added table, one added
column, no removed tables, and ordered index 18 after `0017`. All 19 migrations
match the schema and apply to a fresh database. A compatibility test applies
`0018` over an earlier exact waste event and proves that it survives with a null
reason; existing events are not assigned invented reasons.

Both ordinary local D1 and the isolated W1 review database have applied `0018`.
Development Cloudflare D1 was not changed. A later authorized hosted rollout
must review/apply pending `0016`–`0018` before serving this code.

## Verification

The following completed successfully in this worktree after the final code
review:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | All 35 suites passed |
| `pnpm db:check` | 19 ordered migrations match the schema; fresh SQLite passed |
| `pnpm build` | Worker/client build passed |
| `pnpm db:migrate:local` | Local ledger current through `0018` |
| `VINEXT_NO_DEV_LOCK=1 pnpm test:local` | Local HTTP smoke passed |
| `node scripts/w1-review-fixture.mjs verify` | Exact fictional balances, valid foreign keys, zero orders/sales |
| `git diff --check` and changed-document relative link/anchor check | Passed |

The smoke command bypassed the CLI's development-server lock because another
local preview was already open. It did not bypass application authorization,
CSRF, or feature gates, and the existing server was preserved.
One final smoke startup attempt failed because its selected ephemeral port was
occupied and Vite moved to a different port than the harness expected. A fresh
retry of the same command passed; no application code change was needed.

[Focused waste tests](../tests/waste-recording.mjs) cover exact quantities,
required/changed reasons, repeated and concurrent saves, insufficient stock,
invalid units/precision/time, count cutoffs, misleading D1 acknowledgment counts,
lost acknowledgment after commit, retry after a later count or custom-unit
revision, custom units,
shortcut revision races/reclassification, legacy projections, and client retry
identity. [Route security tests](../tests/m2-security.mjs) cover anonymous,
wrong-company, forbidden-role, expired-session, CSRF, gate-off behavior,
session-derived actor, narrow response fields, audit, and unchanged denial of
broad employee inventory writes. These are local contracts, not remote D1 proof.

## Fictional Safari walkthrough

The isolated fixture contained 10,000 mL milk, 2,000 g espresso beans, and 100
cups, with shortcuts for a 200 mL spill, 18 g shot, and one cup. Owner, manager,
and employee views were inspected using the ordinary role protections.

Observed:

- Record waste remained visible with the sidebar collapsed. A staged one-pack
  order draft stayed unchanged after waste recording and discard.
- Favorites persisted; recent items and search/empty results worked.
- Quantity/reason/optional note, confirmed success, Record another, and manager
  shortcut saving worked. Employee entry offered no shortcut management.
- An excessive quantity showed an error without clearing the form or stock.
- Desktop light/dark, a 390 × 844 phone viewport, and an 820 × 844 tablet viewport
  were reviewed. Buttons and inputs remained contained and the panel scrolled.
  A Safari overlay-animation issue found during review was fixed for this panel.
- Stopping only the W1 server before Save produced an uncertain outcome with
  frozen details. Restarting/reloading restored the same pending entry. Manual
  retry confirmed one deduction; it did not create an additional movement.
- Common favorite-item tasks from open to confirmed save took **6.48 seconds**
  for milk and **6.137 seconds** for employee beans entry using native automation
  actions and observations. These preliminary measurements include automation
  overhead and do not prove real-worker usability during a busy shift.

Final local ledger after five successful entries:

| Ingredient | Waste entries | Remaining stock | Balance version |
| --- | --- | --- | --- |
| Milk | Three × 200 mL, spilled | 9,400 mL | 4 |
| Espresso beans | 18 g, preparation error | 1,982 g | 2 |
| Cups | One cup, other | 99 cups | 2 |

The fixture verification found zero orders, zero sales events, and no foreign-key
violations. Screens were inspected directly; no screenshots containing account
or browser details were committed.

### Remaining usability evidence

Accessible labels/button semantics and visible focus styles were inspected,
but a full keyboard-only walkthrough did not complete. Safari's automation kept
native key focus in its responsive-width toolbar after an accessibility click;
coordinate focus attempts then returned `noWindowsAvailable`. This is a recorded
tool blocker, not a keyboard pass. Manually verify Tab order, keyboard ingredient
selection, reason choice, save, error recovery, and closing the panel.

Physical-device touch/virtual keyboard behavior, actual worker timing, and owner
acceptance remain open. No hosted, pilot, or production UI evidence is claimed.

## Reproduce the isolated review

Use the existing [local setup](LOCAL_DEVELOPMENT.md). For a fresh isolated
review database, apply the local migrations and seed fictional data:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .sites-runtime/w1-review-state
node scripts/w1-review-fixture.mjs seed
PANTRACK_W1_REVIEW=enabled node node_modules/vite/bin/vite.js --port 5175
```

Open <http://127.0.0.1:5175/> and use the local-only sign-in fixture. The seed
refuses to overwrite a populated company database. The current preview already
contains the five entries above; do not reseed it.

```sh
node scripts/w1-review-fixture.mjs verify
node scripts/w1-review-fixture.mjs role employee
node scripts/w1-review-fixture.mjs role owner
```

Role switching affects only `local_seedy` in the isolated fictional company;
an inert fictional owner remains so normal ownership constraints stay active.
The serve-only review flag selects that isolated local state and exact gate.
It is ignored by production builds/managed hosting and changes no hosted gate.

## Handoff

A owns the quick flow, exact event reason, shortcuts, and `0018` schema handoff.
C's membership/CSRF/audit boundary is preserved and now includes the narrow
waste permission. B's sales contract and POS adapters are unchanged. W2 must
agree recipe/preparation identities and sale overlap with B before adding
prepared-item waste; W3 must introduce linked, audited corrections rather than
editing this ledger. Supplier submission and automatic purchasing stay disabled.

Next unblocked step: manual keyboard and worker/device review, then record owner
acceptance of the reviewed local W1 scope. W2 is a separate implementation task.
Toast/Baldor access does not block this local usability review.

**Rollback/forward repair:** disable the exact preview to stop new entries and
retain the additive schema and ledger. Do not drop movement records or silently
restore stock. A code rollback after structured-reason events exist must retain
the full receipt comparison, including reason; the previous comparison could
confirm changed-reason retries incorrectly. Prefer a reviewed forward repair.
Shortcut settings keep the latest configuration operation receipt; a superseded
configuration retry may conflict and needs refresh, with no stock effect.
