# W4c photo waste screens — local evidence

Recorded: 2026-11-16. Branch: `workstream-c/photo-waste-w4c`, based on `main`
at `b9ae755`. Step W4c of the
[photo waste plan](WASTE_AND_MARGIN_ROADMAP.md#w4--photo-waste-suggestions),
following [decision 0010](decisions/0010-photo-waste-suggestions.md). **Local
evidence only, with the offline fake reader**; no paid or external service was
contacted. No migration: the outcome columns came with `0051` in W4b.

## Changed behavior

- **Waste page: "Record waste from a photo"**
  ([`photo-waste-suggest.tsx`](../src/components/workspace/photo-waste-suggest.tsx)),
  shown only when photo suggestions are available:
  - The person takes or chooses a photo and adds a short note, then sees the
    suggested entries ("5 × Croissant · End of day", "Oat milk · amount
    needed · Spilled"), each with **Check and save**. **None of these are
    right** dismisses the suggestion.
  - The panel stays on the page after an entry is saved, marking it
    **Saved**, so a photo with several items can be worked through.
  - Retrying after an error reuses the same request, so the server never
    reads or bills it twice.
- **Photo preparation in the browser**
  ([`photo-prepare.ts`](../src/lib/photo-prepare.ts)):
  - resized to at most 1568 px on the longest side and redrawn as JPEG,
    lowering quality until it fits the 1.5 MB limit;
  - redrawing keeps only pixels, so location and other hidden details are not
    sent;
  - photos that cannot be opened get a plain message.
- **Checking in the normal forms:**
  - **Check and save** opens the existing café-item form, or the ingredient
    form for stock such as milk, filled in and marked "Suggested from your
    photo. Check … before saving".
  - Saving uses the unchanged W1/W2 path. Suggestions never save by
    themselves.
- **Outcome for accuracy** (W4f), via `POST /api/waste/suggestions/outcome`:
  - after a save, the page records **confirmed** when the item, number and
    reason were kept, otherwise **edited**; filling in a blank liquid amount
    still counts as confirmed;
  - **None of these are right** records **discarded**;
  - "edited" outranks "confirmed", "discarded" counts only until something is
    saved, and only the person who asked can record it. The report never
    blocks waste entry.

  This replaces the plan's wording "links the entry to its suggestion": the
  saved entry is already in the waste and audit history, and the per-request
  outcome is what W4f measures.
- **Availability:** `GET /api/waste/items` now includes `photoSuggestions`.
  It is true only when a reader is configured, and locally only with
  `PANTRACK_WASTE_READER=fake`.
- **Ingredient waste labels** now show standard units by their short name
  ("fl oz", not "fl_oz_us"), matching the easier-units change.
- **Fake reader:** it now matches a product's main name and ignores details
  such as "· barista", so "spilled oat milk" finds "Oat milk · barista".

## Verification

The complete local pipeline passed in this worktree on 2026-11-16 with the
changes staged: `pnpm typecheck`, `pnpm test` (181 suites), `pnpm db:check`
(52 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`.

- [`tests/waste-suggestions.mjs`](../tests/waste-suggestions.mjs) adds:
  - outcome rules: discarded, then confirmed, then edited, in the right order
    of precedence;
  - refusals for another person, another company, an empty suggestion, an
    unknown request and an invalid value;
  - someone else's refused attempt leaves the record unchanged;
  - an outcome time is recorded;
  - the fake reader matches a main name.
- [`tests/m2-security.mjs`](../tests/m2-security.mjs) adds the outcome route:
  signed out (401), another company's member, a wrong-company manager or a
  cross-site request (403), a different person in the same company (404), an
  invalid value (400), and the person who asked (200).
- **Mutations:** three deliberate mutations of the outcome rules made the
  tests fail:
  - confirmed overwriting edited;
  - discarded overwriting a save;
  - any person recording the outcome. This one was caught only after the
    unchanged-record check was added.
- **Local browser check** against `pnpm dev` with the fake reader and fixture
  sign-in, using a browser-made JPEG and fictional local items:
  - the photo sent was a 21,656-byte JPEG with no EXIF block;
  - "5 croissants end of day" suggested **5 × Croissant · End of day**, opened
    the café-item form with 5 and the banner, and saved, showing "Stock was
    deducted once";
  - the panel kept the suggestion with **Saved**;
  - "spilled oat milk" suggested **Oat milk · barista · amount needed**, opened
    the ingredient form with the banner and "Quantity (fl oz)", and saved with
    8 fl oz;
  - both outcomes were recorded as `confirmed`;
  - at 390 px wide there was no sideways scrolling;
  - no page errors and no requests outside the local site.

## Not covered

- Owner switch and the $10 monthly cap (W4d).
- The real OpenAI reader (W4e); real photos; hosted D1.
