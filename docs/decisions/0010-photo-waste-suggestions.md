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
8. **Provider:** an Anthropic Claude model that reads images, called only from
   the server with a key the owner creates and stores as a server secret.
   Starting model: Claude Haiku 5.5 (`claude-haiku-5-5`) for cost. A move to a
   larger model needs measured accuracy evidence and the owner's agreement.
   Pantrack never asks for or handles the key in chat or Git.
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
