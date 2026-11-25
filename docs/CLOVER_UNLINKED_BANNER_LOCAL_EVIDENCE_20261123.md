# Unlinked Clover items banner — local evidence

Recorded: 2026-11-23. Branch: `workstream-c/clover-unlinked-banner`, based on
`main` at `19bd9dc`. It is **local evidence only**: nothing was deployed, and
no Clover account, sandbox or live, was contacted.

The owner approved the shortlist from the Mobbin research of 2026-11-23 ("the
ideas you mentioned from the shortlist sound promising"), then asked to "start
on the first shortlist idea". That idea:
- a banner for Clover items that aren't linked, with a way to link each one;
- a Clover status pill showing when Pantrack last checked.

It supports the
[Clover pilot connection](CLOVER_PILOT_CONNECTION_ROADMAP.md). **Not
tracked** is step P2 of that plan. It needs a migration, so it is not part of
this change. The banner gains a **Not tracked** button with P2.

## What changed

- **Finding what's unlinked**
  ([logic](../src/lib/clover-unlinked.ts)):
  - Pantrack re-checks the latest 200 paused Clover sales against today's
    links. It uses the same lookup rules as sales processing
    (`D1SalesMappingPort`), and checks each item and option once.
  - It reports each Clover item that isn't linked, and each option on a
    linked item that isn't linked, with how many paused sales wait on it and
    when it last sold.
  - A paused sale counts as **ready to try again** only when two things are
    true:
    - it was paused for links alone (unknown item, variation or option);
    - everything in it is linked now.

    A sale also paused for, say, a missing opening count is not counted as
    ready.
- **Clover status** (`GET /api/clover`, owners only as before) now includes
  `unlinked`: the entries, the number of sales waiting, the number ready, and
  whether more than 200 paused sales exist. If the summary can't be worked
  out, it is left empty and the rest of the status still loads.
- **Sales page** ([component](../src/components/workspace/clover-sales-status.tsx),
  [styles](../src/components/workspace/clover-sales-status.css)), for owners
  when Clover is set up:
  - **Pill** beside the page title. It reads one of:
    - "Clover · checked 4 min ago";
    - "Clover · not checked yet";
    - "Clover connected · sync off";
    - "Clover sync problem";
    - "Clover not connected".

    **Sync now** appears when sales sync is on.
  - **Banner**: for example, "2 Clover items and 1 option aren't linked yet.
    6 sales are paused until they are. Nothing was taken from stock."
  - **Link items** opens a list. Each row has the Clover name, its paused
    sales, when it last sold, a recipe (or recipe option) choice and **Link**.
    When an option isn't in the item's recipe yet, the row says "Add this
    option to the recipe first."
  - Opening the list looks up names on Clover's menu, at most 10 pages. If
    Clover can't be reached, item codes are shown instead.
  - A green note, "4 paused sales are ready to try again", has **Review**,
    which goes to the paused-sales list in Record sales.
- **Home**: owners see a To-do item such as "2 Clover items and 1 option
  aren't linked yet" with **Link**. The Clover card says "Last checked 8 min
  ago" instead of a full date.

Linking uses the existing `mapItem` and `mapModifier` actions. There is no
change to API permissions, schema or sales processing. Past sales and stock
are not changed by linking. Paused sales are still tried again from Record
sales, one at a time, as before.

## Tests

[`tests/clover-unlinked.mjs`](../tests/clover-unlinked.mjs) covers:
- **Rules:**
  - unlinked items and options, counted and sorted;
  - options on an unlinked item are not checked;
  - each lookup runs once;
  - which paused sales count as ready;
  - unreadable stored sales are skipped.
- **Wording:** "4 min ago", the five pill states, and the banner headline.
- **Clover status, with an in-memory database:**
  - only the connected merchant's held Clover sales are counted;
  - applied sales are ignored;
  - a sale stored without readable lines is skipped;
  - a new link takes effect at once;
  - a manager gets 403, another company's owner gets 403, and a signed-out
    visitor gets 401;
  - a company without Clover gets no summary.

## Browser check (local, fictional data)

The demo café was given:
- a fictional sandbox Clover connection, with fictional tokens encrypted with
  a throwaway local key;
- a last check 4 minutes earlier;
- seven paused sales: muffin ×3, gift card ×1, latte with oat milk ×2, and a
  plain latte whose item was already linked.

Requests from the page for Clover menu names were answered inside the browser
with fictional names. Sync was blocked, so nothing reached Clover.

- **Home**: the To-do showed "2 Clover items and 1 option aren't linked yet ·
  Link them so 6 paused sales can come off stock."
- **Sales**:
  - the pill read "Clover · checked 4 min ago", with **Sync now**;
  - the banner read "2 Clover items and 1 option aren't linked yet · 6 sales
    are paused until they are";
  - the green note read "1 paused sale is ready to try again".
- **Link items** listed:
  - Blueberry muffin: 3 paused sales;
  - Oat milk on Latte: 2, "Add this option to the recipe first.";
  - Gift card: 1.
- **Linking the muffin** to a recipe saved it. The muffin left the list, the
  banner changed to "1 Clover item and 1 option … 3 sales are paused", and the
  green note changed to "4 paused sales are ready to try again".
- **Phone width (390 px)**: the pill, banner, list and note stack cleanly
  above the bottom tab bar.
- No page errors.

## Verification

Run in this worktree with the source frozen and staged:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 190 suites (including the new `clover-unlinked`) |
| `pnpm db:check` | Passed, no schema change |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no migrations to apply |
| `pnpm test:local` | Passed |
| `pnpm a8:check:browser` | Passed |

ESLint reports no problems in the new and changed files, apart from one
warning that was already on `main` (an unused `companyName` in the home
page).

## Not covered

- **Not tracked** (Clover pilot step P2, needs a migration).
- Trying all ready sales again in one step; they are still tried one at a
  time in Record sales.
- A "no sales for 2 hours" warning, which needs opening hours.
- Real Clover names and data, the hosted site, and real phones.
