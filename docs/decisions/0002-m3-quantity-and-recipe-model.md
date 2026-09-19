# Decision: M3 quantity, unit, recipe, and count model

- Status: accepted
- Date: 2026-09-19
- Milestone: M3
- Workstream: A1

## Context

Pantrack currently stores inventory and recipes as JSON. Stock units are free
text, quantities use JavaScript floating-point numbers rounded to three decimal
places, and saving a recipe overwrites its previous value. A sales import checks
that an opening count exists, but it does not compare the sale occurrence time
with that count. A physical count replaces the estimate without retaining the
previous estimate or the measured variance.

Those behaviors cannot provide the quantity truth required by provider-neutral
sales ingestion or explain historical inventory after a recipe, unit, or count
changes. M3 therefore needs an exact quantity model, explicit conversions,
immutable recipe history, and an auditable count cutoff before M4 applies sales
events to inventory.

This decision defines the target domain model and the additive migration plan.
It does not authorize a schema migration, an external integration, or any live
data operation.

## Decision

### Quantity representation

Every classified quantity belongs to exactly one dimension:

| Dimension | Canonical unit | Canonical scale |
| --- | --- | --- |
| `count` | `each` | 0 decimal places |
| `mass` | gram (`g`) | 6 decimal places |
| `volume` | milliliter (`mL`) | 6 decimal places |

Canonical quantities are signed fixed-point integers. Domain code uses
`bigint`; JSON and database boundaries encode the integer as a base-10 string.
The scale is derived from the dimension and is not supplied by a client. Count
inputs and count conversions must produce whole `each` values. Mass and volume
inputs may contain at most six decimal places.

The shared domain shapes introduced by later A work use these meanings:

```ts
type UnitDimension = 'count' | 'mass' | 'volume'

type ExactQuantity = {
  dimension: UnitDimension
  minor: string // canonical signed integer encoded in base 10
}

type UnitRef = {
  id: string
  dimension: UnitDimension
}
```

Parsing rejects exponents, `NaN`, infinity, negative zero, excess precision,
and canonical results outside the signed 64-bit range. Counts, physical stock,
incoming stock, capacities, and targets are nonnegative. Recipe modifier deltas
and reconciliation variances may be signed.

Configured recipe quantities and pack conversions retain both the canonical
quantity and an immutable snapshot of the manager-entered decimal text and unit
reference. Calculations use only the canonical quantity; explanations may show
the entered snapshot.

### Curated and custom units

The curated catalog is:

| Dimension | Stable unit IDs |
| --- | --- |
| Count | `each` |
| Mass | `mg`, `g`, `kg`, `oz_mass`, `lb` |
| Volume | `mL`, `L`, `tsp_us`, `tbsp_us`, `fl_oz_us`, `cup_us`, `pint_us`, `quart_us`, `gallon_us` |

Stable IDs distinguish ambiguous labels such as a measured US cup from a
counted drinking cup. Display labels may be localized later without changing an
ID or conversion.

Curated conversions use exact rational factors relative to the canonical unit.
For example, one pound is exactly `453.59237 g`, and one US gallon is exactly
`3785.411784 mL`. Conversion factors are represented as integer numerator and
denominator pairs. The result is rounded to the canonical scale once, half away
from zero. Frozen canonical values are never reconverted during consumption.

A manager may define a product-specific custom unit with:

- a stable ID and display label;
- one of the three supported dimensions; and
- a positive rational conversion to that dimension's canonical unit.

Custom definitions are scoped to one company and product. They cannot be
silently reused for another product. Cross-dimensional conversions, including
density-based mass-to-volume conversions, are not supported. Changing a custom
conversion creates a new version and never reinterprets historical values.

Purchase unit, stock/display unit, and recipe-entry unit are distinct. Supplier
labels such as case, bag, carton, and sleeve describe purchase units; each must
have an explicit product-specific pack quantity in canonical stock units.

### Unit configuration changes

Inventory configuration is versioned. A same-dimension display-unit change
does not change the canonical on-hand or incoming balance. A custom conversion
change creates a new configuration version, after which new recipe drafts and
pack settings must reference the new version.

A dimension change is allowed only while a product has no inventory events,
incoming stock, count, or recipe reference. Once any of those exist, changing
dimension is incompatible and is rejected. The manager must create a new
product or complete a separately reviewed data migration. Neither zero nor
negative estimated stock makes an incompatible change safe.

### Recipe versions

A recipe has a stable company-scoped lineage ID and one or more versions. Each
version contains its immutable ingredient list, unit/configuration references,
canonical quantities, entered-value snapshots, author, and timestamps.

Versions have these states:

- `draft`: mutable and never eligible for consumption;
- `active`: immutable and eligible during its effective interval; and
- `archived`: immutable, unavailable for new configuration, but retained for
  historical resolution.

Activation is an atomic, forward-only action using server time. It archives the
previous active version at the same instant. Active intervals are half-open:
`[activeFrom, activeTo)`. A sale exactly at a new version's `activeFrom` uses
the new version. Backdated activation and edits to active or archived versions
are prohibited. Archiving without a replacement leaves the lineage without an
active version for later sales.

A sale selects the recipe version active at the sale's occurrence time, not at
receipt or import time. If no version covers that time, consumption is held.
Every new manual or CSV import must include a manager-confirmed occurrence time;
the UI may default it to the current time but the server must receive it
explicitly. Existing stored imports remain unchanged and are never recalculated.

### Modifier versions

A modifier has a stable lineage scoped to one base recipe lineage. Its versions
follow the same draft, active, archived, and forward-only activation rules as a
recipe. A modifier version contains signed canonical ingredient deltas and the
corresponding entered-value snapshots.

For a sale, Pantrack selects the base recipe version and each requested modifier
version at the occurrence time, multiplies them by their event quantities, and
sums all deltas by product. A substitution explicitly removes the base
ingredient and adds its replacement. The final quantity for every ingredient
must be nonnegative. A missing version, duplicate identity that violates the
event contract, incompatible unit, or negative result holds the entire
consumption request; no ingredient is partially deducted.

### Physical counts and reconciliation

Each physical count records:

- company and product identity;
- measured canonical quantity and entered-value snapshot;
- manager-supplied `effectiveAt`;
- server-generated `recordedAt`;
- actor and optional note;
- estimated quantity immediately before the count, when one exists; and
- signed variance: `measured - estimatedBefore`.

`effectiveAt` cannot be in the future. It must be strictly later than the
previous count and every already-recorded stock-changing event for that product.
An event at the same instant makes ordering ambiguous and also blocks the
backdated count. Pantrack does not reconstruct the ledger automatically; the
manager instead records a current documented correction.

The first count is the opening count. It establishes the product's cutoff and
has no estimate or variance. A later count sets current on-hand to the measured
quantity, records the reconciliation, and resets accumulated estimated usage
and its uncertainty without rewriting prior events.

A sale with `occurredAt <= latestCount.effectiveAt` is held with reason
`before_count_cutoff` and makes no inventory change. A sale after the cutoff may
be applied through the atomic A2 consumption contract.

### Required held and error outcomes

The later A2 contract must distinguish at least:

- `unit_unclassified`;
- `unit_incompatible`;
- `recipe_version_not_found`;
- `modifier_version_not_found`;
- `negative_modifier_result`;
- `before_count_cutoff`; and
- `invalid_occurrence_time`.

These are reviewable outcomes, not generic exceptions and not permission to
partially apply consumption.

## Migration plan

M3 uses expand, backfill, verify, and cutover stages. Every database change is
additive and enters the single migration queue only in A3.

### 1. Expand

Add company-scoped structures for:

- product custom units and versioned inventory configurations;
- canonical inventory balances and immutable inventory events;
- recipe lineages, versions, and version ingredients;
- recipe-scoped modifier lineages, versions, and deltas; and
- physical-count reconciliations and their cutoff/effective timestamps.

Constraints must preserve company ownership, immutable activated versions,
non-overlapping activation intervals, and exact string-encoded canonical
quantities. Existing tables and columns are not removed or rewritten.

### 2. Backfill without interpretation

Every existing free-text stock unit becomes a product-specific
`legacy-unclassified` definition. Its label, quantity values, three-decimal
behavior, and recipe links are preserved exactly. The migration does not infer
that labels such as `cup`, `oz`, or `case` have a particular dimension.

Existing recipes become immutable legacy versions retaining their current IDs
and ingredient values. They are not eligible for the new integrated consumption
contract until a manager classifies the involved units and activates a reviewed
replacement version. Existing sales imports and inventory events remain
immutable. Missing historical estimates or count variances are recorded as
unknown rather than invented.

### 3. Verify and classify

Compatibility tests compare every pre-migration product, balance, recipe,
event, and sales import with its preserved representation. Managers then
classify units, enter explicit pack conversions, and create reviewed recipe
versions. Classification never alters a legacy event or prior sales usage.

### 4. Cut over through one domain service

After compatibility evidence passes, inventory, recipe, and count writes use a
single company-scoped service that writes the normalized records atomically and
maintains the legacy JSON projection during the M3 compatibility window. Reads
continue to expose the existing API shape where possible while adding explicit
version and exact-quantity fields through a separately reviewed contract.

Normalized records become authoritative only after A4 behavior and acceptance
tests pass. Removal of legacy JSON or compatibility projections is outside M3.
Before cutover, rollback selects the legacy read path. After cutover, failures
use an additive forward repair; migrations and historical records are not
rolled back destructively.

## Acceptance fixtures for A2-A4

| Scenario | Expected result |
| --- | --- |
| Convert `5 lb` to canonical mass | `2267.961850 g` |
| Convert `1 gallon_us` to canonical volume | `3785.411784 mL` |
| Configure a 1,000-item case | `1000 each` |
| Configure one cup of flour as 120 grams | Rejected as a cross-dimensional conversion |
| Activate recipe v2 at 12:00; receive a sale from 11:59 later | The sale uses immutable v1 |
| Apply an extra-shot modifier | Its positive coffee delta is added to the base recipe |
| Apply a milk substitution | The base milk delta is removed and replacement milk is added |
| Modifier total makes an ingredient negative | Entire request is held; inventory is unchanged |
| Sale time equals or predates the latest count cutoff | Held as `before_count_cutoff`; inventory is unchanged |
| Estimate is `12.500000 g`; count measures `11.000000 g` | Variance is `-1.500000 g`; on-hand becomes `11.000000 g` |
| Backdated count precedes an existing stock event | Count is rejected; manager is directed to a current correction |
| Existing unit label is `cup` | Preserved as unclassified; no count/volume meaning is inferred |

## Consequences

- Quantity arithmetic becomes deterministic and decimal safe, but later work
  must replace number-based domain calculations and carefully format bigint
  values at UI and JSON boundaries.
- Managers must classify legacy units before new integrated sales consumption;
  this deliberate friction prevents silent reinterpretation of inventory.
- Sale-time recipe selection makes delayed events explainable but requires an
  explicit occurrence time for manual imports and the M4 event contract.
- Forward-only activation and restricted backdated counts avoid historical
  rewrites. Corrections remain explicit audit events.
- Product-scoped modifier deltas avoid duplicating complete recipes while
  requiring validation of every combined result.
- A2 may now define the atomic idempotent consumption contract. A3 remains
  responsible for proposing and reviewing the exact additive SQL schema before
  generating a migration.

## Alternatives considered

- **JavaScript numbers rounded to three or six decimals:** rejected because
  repeated conversions and aggregation remain vulnerable to binary floating
  point error.
- **Arbitrary free-text units:** rejected because compatibility cannot be
  validated and similarly named units can have different meanings.
- **Automatic mass/volume conversion:** rejected because density is
  product-specific and unsafe to infer.
- **Import-time recipe selection:** rejected because delayed sales would use a
  recipe that was not active when the item was made.
- **Full recipe copies for every modifier combination:** rejected because the
  number of variants grows rapidly and obscures the consumption delta.
- **Automatic replay after a backdated count:** rejected because rebuilding an
  already-mutated ledger adds operational and audit ambiguity.
- **Automatic classification of legacy names:** rejected because labels such as
  `cup`, `oz`, `bag`, and `case` are ambiguous without product context.
