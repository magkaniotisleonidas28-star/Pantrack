# Decision: shared recipe option sets on top of versioned recipe modifiers

- Status: accepted by the owner (product direction); implementation in steps
- Date: 2026-11-14
- Milestones: A/B recipe and sales consumption (decision 0002), M4 sales ingestion
- Builds on: [decision 0002](0002-m3-quantity-and-recipe-model.md) (base recipe plus
  signed modifier deltas)

## Context

The owner reviewed a local preview of recipe setup on 2026-11-14 and asked that
a menu item's recipe hold only what never changes, with choices handled as
modifiers. Facts about the café's Clover menu, from the owner:

- **Sizes are separate Clover items** ("Iced Latte Medium", "Iced Latte
  Large"), so each size is its own Pantrack recipe.
- **Clover always forces a milk choice.**
- **Syrups are optional and several can be added** to one drink.
- **Ice is optional:** Clover sends "Light ice" or "No ice" only when changed;
  nothing is sent for regular ice. Light or no ice adds more of **whichever
  milk was picked**.
- **Milks plus syrups exceed 16 options** per item.

Pantrack already stores immutable, versioned base recipes and per-recipe
modifiers, publishes a whole recipe with its modifiers and "exactly one"
choice groups atomically (`publishRecipe`), maps Clover items and
(item, modifier) pairs to them, and holds a sale whose modifier is unknown.

## Decisions

1. **Base recipe = fixed ingredients.** Choices are modifiers.
2. **Shared option sets with per-item overrides.** An option set (for example
   "Milk: Medium iced") holds named choices and their amounts once and is
   attached to many items; an item can override a choice's amount. Each item
   can also have **its own modifiers** (for example "Extra shot").
3. **Sets generate ordinary per-recipe modifiers.** Attaching or editing a set
   republishes each attached item through the existing atomic publisher, so
   consumption, history, Clover mapping and holds keep working unchanged. An
   edit applies from then on; past sales keep the versions active when they
   occurred.
4. **Two kinds of set.** "Must pick one" sets (milk) publish as an existing
   choice group; "optional add-ons" (syrups, ice) publish as plain modifiers,
   several of which may be applied to one item.
5. **No-stock-change options** are modifiers with no ingredient changes, so a
   Clover option such as "extra hot" can be mapped instead of holding the sale.
6. **"More of the picked choice"** (light ice adds more of the milk picked)
   needs consumption to read another modifier on the same line. It is a
   separate engine change with its own tests.

## Implementation steps

1. **Groundwork (this step):** raise the per-item limit from 16 to 64
   modifiers and 40 options per choice group; compare the active modifier set
   with one JSON value so a republish binds a constant number of parameters
   (D1 allows 100 per statement); allow modifiers with no ingredient changes.
   Evidence: [recipe option limits](../RECIPE_OPTION_LIMITS_LOCAL_EVIDENCE_20261114.md).
2. **Stored option sets:** additive migration for sets, attachments and
   overrides; owner/manager API with anonymous, wrong-company and
   forbidden-role tests; republish of attached items
   ([evidence](../RECIPE_OPTION_SETS_LOCAL_EVIDENCE_20261114.md)); item editor UI
   ([evidence](../RECIPE_OPTION_SCREENS_LOCAL_EVIDENCE_20261115.md)).
3. **"More of the picked choice"** in sales consumption
   ([evidence](../RECIPE_CHOICE_EXTRAS_LOCAL_EVIDENCE_20261116.md)); see the
   amendment below.
4. **Clover linking per choice:** link a Clover option to a set choice once,
   creating the (item, modifier) mappings for every attached item. Built as
   links resolved at sale time against the item's recipe, so items attached
   later are covered too; a per-item modifier mapping still takes priority
   ([evidence](../RECIPE_OPTION_CLOVER_LINKS_LOCAL_EVIDENCE_20261116.md)).

## Consequences

- Option sets add setup convenience without a second consumption model.
- A set edit creates new recipe versions for every attached item.
- Choice and modifier names stay fixed per modifier identity, as today.
- Until step 3, light/no ice can be set up as a fixed-product or no-change
  option only.

## Amendment: percentage of the picked choice — 2026-11-16

The owner chose a **percentage** rather than a fixed amount for "more of the
picked choice", so one ice set serves every size: a larger item's larger milk
amount gets a larger extra.

- A choice in an **optional add-ons** set may set a whole percentage from 1 to
  100 ("Light ice: 25% more of the picked choice"). Pick-one choices cannot.
- Applying the set to an item links that percentage to the item's **one**
  pick-one choice group, whether it comes from a set (milk) or is the item's
  own. An item with no pick-one choice, or more than one, is not updated and
  says why; choosing among several is not supported yet.
- Each recipe modifier version may carry one stored extra (choice group and
  percentage) in `recipe_modifier_extras` (migration `0048`), immutable once
  activated like its ingredient changes.
- Sales consumption adds, per occurrence of the modifier, that percentage of
  each ingredient change of the option picked in that group on the same line,
  using the picked option's own published amount (including per-item
  overrides), rounded half away from zero to the smallest stored unit. A line
  without its required pick is held as before, so no extra is guessed.
- Past sales keep the version and percentage active when they occurred.
