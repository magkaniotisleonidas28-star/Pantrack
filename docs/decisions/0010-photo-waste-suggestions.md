# Decision: photo waste suggestions, confirmed by a person

- Status: accepted by the owner (product direction); implementation in steps
- Date: 2026-11-16
- Milestones: waste roadmap step W4 ([roadmap](../WASTE_AND_MARGIN_ROADMAP.md#w4--photo-waste-suggestions))
- Builds on: W1 ingredient waste and W2 menu-item waste (same save path,
  permissions and stock rules)

## Context

The owner asked whether waste could be recorded from a photo plus a short note,
for example a tray of end-of-day croissants, a spilled latte or spilled milk.
An AI reads the photo and note and proposes the entry. The person confirms it,
or corrects it, before anything is saved.

The Waste page already records an ingredient (such as milk) or a menu item
(such as a croissant or latte, with its recipe) with a whole quantity, a reason
(end of day, spilled, spoiled, preparation error, other) and an optional note.
Employees, managers and owners can use it.

## Decisions

1. **Photos from the start.** The owner chose photo plus note over a text-only
   first version, for ease of use and wider coverage.
2. **A suggestion is never a record.** The AI only fills in the existing waste
   form. Nothing changes stock until a person presses Save. The saved entry
   uses the existing W1/W2 path, so stock, recipes, sales-overlap checks and
   audit behave exactly as for a typed entry. The entry also records that it
   came from a suggestion, and whether the person changed it.
3. **Only real items.** The AI chooses from the company's own current waste
   items and reasons. A suggestion naming anything else, or an impossible
   quantity, is dropped and the person fills in the form. Text in a photo, such
   as a sign or label, is treated as picture content, never as instructions.
4. **Amounts the photo cannot show are asked, not guessed.** Counting pieces
   (croissants, muffins, cups) can come from the photo. Liquid amounts come
   from the note ("about half a carton"), or the form asks for them.
5. **Who can use it:** everyone who can record waste today (owners, managers
   and employees), with the same company and role checks.
6. **Photos are not kept.** A photo is resized and re-encoded in the browser,
   which removes hidden location data. It is sent once to read the suggestion
   and is not stored. The note, the suggestion, who confirmed it, and the
   estimated cost are stored with the request.
7. **Spending cap: $10 a month per company.** The cap is checked on the server
   before every paid request, and the estimated cost is recorded with each
   request. Once the cap is reached, photo suggestions stop until the next
   month and the normal form keeps working. The feature is **off by default**;
   the owner turns it on.
8. **Provider: the owner's existing OpenAI API account**, the one already used
   for AI cart preparation ([C4 evidence](../C4_PO_CART_AI_LOCAL_EVIDENCE.md)),
   so no new provider account is needed. The owner asked for this on
   2026-11-16.
   - **Model:** start with the cart's reviewed model family, `gpt-5.4-mini`,
     pinned to a dated version. W4e confirms from OpenAI's documentation that
     it accepts images, and its current price, before any paid run. A
     different model needs measured accuracy evidence and the owner's
     agreement.
   - **Key:** called only from the hosted server with a key stored as a server
     secret. The cart's key lives in a private file on the owner's computer for
     the local cart worker, so the server needs its own secret. The owner can
     paste the same key, but a separate key in the same account is recommended.
     It can then be turned off, or given its own OpenAI spending limit, without
     affecting cart preparation. Pantrack never asks for, reads or handles the
     key in chat or Git.
   - **Billing:** the API bills by use, separately from a ChatGPT subscription,
     and API billing is already enabled for this account.
9. **Built against a fake reader first.** Every step before the real provider
   uses a local fake that returns fixed suggestions, so nothing paid or
   external runs during development. Each paid test run needs the owner's
   fresh, explicit authorization.

## Consequences

- Photo recording adds a per-use cost and an external service dependency,
  bounded by the cap and switch.
- Accuracy is checked by the owner's confirmation step, not assumed. W4f
  measures how often suggestions needed correcting before calling the feature
  accepted.
- Keeping photos for proof is not part of this decision. If wanted later, it
  needs storage, a retention period and a new decision.
