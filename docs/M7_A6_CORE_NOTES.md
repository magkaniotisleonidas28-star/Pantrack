# A6 local review snapshot slice

This slice adds a pure `pantrack.replenishment-review.v1` calculation. It creates
an immutable, JSON-safe review snapshot from caller-supplied exact quantities,
inventory/config/settings versions, supplier identity and SKU, and a fictional
sales-readiness input. No API, database table, supplier call, scheduling, or
purchase action uses this module yet.

The snapshot also freezes the fictional supplier mapping ID/version and an
optional fictional per-pack price estimate. It multiplies the final suggested
whole-pack count by that price using integer minor currency units, so caps and
minimums are reflected in the line total without floating-point rounding. A
missing price leaves the total unset and adds `price_not_checked`. A fixture
price is only an estimate; neither it nor the snapshot is a supplier quote.

The snapshot records target, on hand, confirmed incoming, pack quantity,
capacity, shelf-life ceiling, whole-pack shortfall, pack policy, source versions,
and the final suggested pack count. Capacity, shelf life, and maximum packs cap
the count. Minimum order and order multiple may increase it only inside those
ceilings. If a required minimum or multiple cannot fit, the suggestion is zero
and an explicit review reason identifies the conflict. Missing opening count or
expired stock also yields zero. Stale counts, degraded/unknown sales, or held
events preserve the arithmetic but flag review. Every result is review-only;
none is an authorization to submit an order.

The sales-readiness shape is a fixture boundary. Person B's accepted health
contract must be mapped and reviewed before using real POS data.

## Versioned settings storage

Migration `0014` adds an empty, company/product-scoped settings history. It does
not change or backfill legacy inventory or recipes. Each save inserts a new
version with an inventory-config reference, actor, reason, time, and stable change
ID. The insert checks the expected versions and active config. Repeating the
same change ID and payload returns the original version; a different payload is
rejected. Database triggers reject updates and deletes of saved history. The
store accepts writes only for a server-derived owner or manager actor and keeps
reads inside that actor's company. No route calls it yet.

For a local rollback, restore the database snapshot made before applying `0014`.
After data has been written, preserve the history and use a new forward-repair
migration rather than dropping or rewriting `0014`. If a future Wrangler remote
apply stops while parsing the two triggers, inspect the migration ledger and
actual schema before retrying; use the documented
[development D1 trigger recovery](M2_SETUP.md#development-d1-trigger-migration-recovery)
only with separate authorization for that database. Remote apply and restore
have not been tested for this slice.

## Read-only bridge to exact inventory

The A6 D1 review bridge now reads the latest saved settings and active exact
balance for one company/product. It uses the configuration's canonical purchase
pack quantity, confirmed incoming balance, physical-count time, and balance
version. It derives the shelf-life ceiling from saved daily use and shelf days,
then calls the pure snapshot builder. The snapshot includes the exact inventory
config ID/version and settings change ID/version. A second read rejects a result
if those source versions changed during calculation. This is a best-effort read
check, not a reservation; A7 must revalidate versions when it adds lifecycle
actions. The bridge makes no writes and exposes no API or supplier action.

Supplier details, price estimates, and sales health are explicitly
company-scoped fictional fixtures, and the frozen snapshot records that
provenance. Person B's accepted health contract still needs a reviewed mapping
before real POS input is used. Real supplier mappings and prices are not
connected. Lot-level expiry evidence is not available in this bridge; the
snapshot records `expiry_not_checked` as a review reason and grants no approval.
Durable proposal storage/invalidation remains open. A7 owns the later proposal
lifecycle and Person C handoff.
M7 acceptance still waits for M5's
reliable sandbox inputs.
