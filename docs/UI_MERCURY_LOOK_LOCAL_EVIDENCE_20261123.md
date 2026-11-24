# Mercury look and menu — local evidence

Recorded: 2026-11-23. Branch: `workstream-c/ui-mercury-look`, based on `main`
at `6ca85f5`. It is **local evidence only**: nothing was deployed and no hosted
or live service was used.

This is the first of four official changes from the owner-approved design
preview of 2026-11-23. The preview was based on research of comparable apps
on Mobbin. The owner compared six looks and chose the Mercury-style one:
"I think we can move forward with the mercury style". After two rounds of
fixes they said "looks good can you make it official". The four changes, one
pull request each, are:

1. **This change:** the look, the font and the menu.
2. The home page and the stock list (status labels, filters, phone rows).
3. Shorter wording across the site.
4. One combined Suppliers page.

## What changed

- **Look** ([styles](../src/components/workspace/workspace-look.css)), applied
  to the owner and manager workspace:
  - the top bar and side menu share one soft warm-grey surface;
  - each page sits on a white panel with rounded corners;
  - type is smaller and crisper;
  - buttons are rounded "pills", and secondary buttons are a soft grey;
  - cards and tables use thin lines;
  - the selected menu item is a small white tab.

  The light and dark modes both have matching colours.
- **Font:** Inter in place of Arial. It is hosted inside Pantrack through the
  `@fontsource-variable/inter` package (5.3.0, SIL Open Font License), so no
  request goes to Google or another outside service.
- **Side menu:**
  - grouped under small headings: **Today** (New order, Inventory, Sales,
    Waste), **Buying** and **Settings**;
  - it runs the full height of the screen and stays in view while long pages
    scroll;
  - it still expands on hover, as the owner chose on 2026-11-14.
- **Phones:**
  - a tab bar at the bottom (Order, Stock, Sales, Waste, More) replaces the
    old "Menu" row, and **More** opens the full menu;
  - pop-up dialogs slide up from the bottom.
- **Waste page:** café-item rows keep their inner padding, so the item name no
  longer touches the edge of its highlight.

Unchanged:
- every page's content, data and actions;
- the employee workspace;
- all APIs, permissions and stored data.

There is no migration.

## Tests and checks

[`po-cart-spending-limits-ui-check`](../scripts/po-cart-spending-limits-ui-check.mjs)
opened the phone menu with the old "Open workspace navigation" button. It now
uses the tab bar's **More** button.

## Verification

The complete local pipeline passed in this worktree on 2026-11-23, with the
changes staged on base `6ca85f5`:
- `pnpm typecheck`;
- `pnpm test` (188 suites);
- `pnpm db:check`;
- `pnpm build`;
- `pnpm db:migrate:local`;
- `pnpm test:local`;
- `pnpm a8:check:browser`.

A first run failed in `tests/spending-limits-screen.mjs`. It pins the
spending-limits menu entry's source text, which now carries its menu group
(`group:'Settings'`). The pin was updated and the full pipeline re-run.

ESLint shows the same findings in the changed files as on `main`: 5
pre-existing errors in `workspace.tsx`, and none new. Prettier passes on the
changed scripts and tests and on the new stylesheet. `git diff --check`
passed.

Browser checks on the demo café used desktop (1440×900) and phone (390×844)
windows:
- Inter loads from Pantrack itself (`document.fonts.check` is true);
- the Mercury look and the grouped menu render;
- the phone tab bar's **More** opens the full menu;
- no page errors.

## Not covered

- Hosted appearance, and real phones; checks used desktop and phone-sized
  browser windows.
- Steps 2 to 4, which follow as separate pull requests.
