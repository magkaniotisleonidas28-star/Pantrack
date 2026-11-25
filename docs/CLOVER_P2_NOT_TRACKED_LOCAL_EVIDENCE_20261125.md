# Clover P2: Not tracked items and options — local evidence

Recorded: 2026-11-25. Branch: `workstream-b/clover-p2-not-tracked`, based on
`main` at `342579c` (after P1). It is **local evidence only**: nothing was
deployed, no Clover account (sandbox or live) was contacted, and Clover sync
stays off on every hosted site.

This is step P2 of the
[Clover pilot connection roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md),
following [decision 0012](decisions/0012-clover-pilot-connection.md) item 3.
The owner chose "You mark 'Not tracked'" on 2026-11-22 and asked to start P2
after P1 merged on 2026-11-25.

## What changed

- **Marks** ([store](../src/lib/d1-clover-not-tracked.ts),
  [migration](../drizzle/0055_clover_not_tracked.sql)):
  - an owner or manager marks a Clover **item** or **option** Not tracked,
    for the connected merchant;
  - **Undo** removes the mark;
  - every mark and undo is logged with who and when, in
    `clover_not_tracked_changes`;
  - repeating either changes nothing and logs nothing.
- **How a sale is applied**
  ([lookup](../src/lib/d1-sales-runtime.ts),
  [intake](../src/lib/sales-ingestion.ts)). Mapping returns a new
  `not_tracked` status after recipe links and option links. Then:
  - a Not tracked item's line takes nothing, options included;
  - a Not tracked option takes nothing on any item;
  - the rest of the sale still comes off stock;
  - a sale that is entirely Not tracked completes with nothing taken
    (`not_tracked_noop`);
  - an item or option that is new and unmarked still pauses the sale, as
    before.
- **Linking wins.**
  - A linked item can't be marked; the reply explains that its sales already
    come off stock.
  - Linking a marked item (`mapItem`) clears its mark, and the undo is logged.
- **Access** (`/api/clover/not-tracked`,
  [route](../src/app/api/clover/not-tracked/route.ts)):
  - `GET` lists the marks and what paused Clover sales are waiting on;
  - `POST` marks or undoes;
  - a new route family, `clover-not-tracked`, needs **operate**, so owners and
    managers can use it while staff can't
    ([authorization](../src/lib/authorization.ts));
  - attempts and outcomes are audit-logged like other Clover actions;
  - the rest of `/api/clover` stays owner-only.
- **Paused sales summary** ([logic](../src/lib/clover-unlinked.ts)):
  - Not tracked items and options no longer count as waiting;
  - sales that are now fully linked or Not tracked count as ready to try
    again.
- **Sales page** ([component](../src/components/workspace/clover-sales-status.tsx)):
  - the banner's button is now **Sort them out**;
  - each row has **Not tracked**; owners also have the recipe choice and
    **Link**;
  - a **Not tracked (n)** list shows each mark, who made it and when, with
    **Undo**;
  - managers now see the banner too, without the owner-only Clover pill or
    linking.

## Schema review

- **SQL:** two new tables; nothing existing is changed.
  - `clover_not_tracked`:
    - key: company, environment, merchant, kind and Clover ID;
    - also holds an optional name, who marked it and when;
    - `kind` is checked to be `item` or `option`.
  - `clover_not_tracked_changes`:
    - an append-only log of marks and undos;
    - `kind` and `action` are checked;
    - indexed by company, merchant and time.
- **Snapshot and journal:**
  - `0055_snapshot.json` adds exactly these two tables, with no changed or
    removed tables;
  - its `prevId` is the 0054 snapshot;
  - the journal adds entry 55 only.
- **Fresh database:** `pnpm db:check` applies all 56 migrations to a fresh
  SQLite database and matches the schema. `pnpm db:migrate:local` applied
  0055 to the demo database.
- **Compatibility:**
  - with no marks, sales behave exactly as before;
  - code from before this change ignores the new tables;
  - existing sales history is not touched.
- **Rollback / forward repair:**
  - to stop the effect, delete the rows in `clover_not_tracked`: lines pause
    again as before, and the change log is kept;
  - rolling back the code leaves the tables unused but harmless;
  - a fix goes in a new migration, never by editing 0055.

## Tests

[`tests/clover-not-tracked.mjs`](../tests/clover-not-tracked.mjs) syncs
against a mocked Clover sandbox with an in-memory database from all
migrations:
- **Before marking:**
  - a sale with a latte with "to go" plus a gift card pauses;
  - so does a gift-card-only sale;
  - the summary lists the gift card and "to go".
- **Access:**
  - signed out: 401;
  - staff, and another company's owner: 403, for both reading and marking;
  - a company without Clover: "Connect Clover first";
  - refused requests log nothing.
- **Marking:**
  - a linked item is refused, and so are bad IDs and unknown kinds;
  - the owner marks the gift card and a manager marks "to go";
  - repeating a mark changes nothing;
  - the log shows who marked each.
- **Sales paused before marking** are tried again once:
  - the mixed sale takes exactly the latte's cup (10 → 9);
  - the gift-card-only sale completes with nothing taken;
  - trying an applied sale again is refused.
- **New sales:**
  - two lattes plus a gift card plus "to go" take two cups (9 → 7);
  - a cookie that isn't marked still pauses its sale, with nothing taken;
  - syncing again changes nothing.
- **Undo** by a manager:
  - a later gift-card sale pauses again;
  - past sales are unchanged;
  - the log records the undo, and every change has a time.
- **Linking a marked item** with `mapItem` clears its mark and logs the
  undo.

The existing Clover, sales, A8, POS and authorization suites (27) pass.

## Browser check (local, fictional data)

The demo café was given a fictional sandbox Clover connection, with fictional
tokens encrypted with a throwaway local key, and the same seven paused sales
as the [banner evidence](CLOVER_UNLINKED_BANNER_LOCAL_EVIDENCE_20261123.md).
Clover menu names were answered inside the browser and sync was blocked, so
nothing reached Clover.

- **As owner:**
  - "2 Clover items and 1 option aren't linked yet · 6 sales are paused until
    they are linked or marked Not tracked."
  - **Gift card** marked Not tracked → "1 Clover item and 1 option … 5 sales"
    and "2 paused sales are ready to try again". The **Not tracked (1)** list
    showed "Gift card · Item · by seedy@sites.test · 11/25/2026" with
    **Undo**.
  - **Oat milk on Latte** marked → "1 Clover item … 3 sales", and 4 ready.
  - **Undo** on the gift card → "2 Clover items … 4 sales", and 3 ready.
- **As manager** (demo membership switched temporarily, then restored):
  - rows showed only **Not tracked**;
  - there was no Clover pill and no recipe choice;
  - no owner-only Clover request was sent.

  Item codes are shown instead of names, because looking up names on Clover's
  menu is owner-only.
- No page errors.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 192 suites (including the new `clover-not-tracked`) |
| `pnpm db:check` | Passed: 56 ordered migrations match the schema and apply to a fresh database |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed (0055 was applied earlier for the browser check) |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the changed files.

## Not covered

- **Names for managers.** Clover's menu is read with owner access, so
  managers see item codes until an owner has marked or linked with names.
- **Trying ready sales again in one step.** They are still tried one at a
  time in Record sales.
- **What Clover sends** for gift cards and "to go" on the sandbox café: step
  P5.
- **Hosted sites and real cafés.**
