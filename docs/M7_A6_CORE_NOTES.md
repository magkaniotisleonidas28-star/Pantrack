# A6 local review snapshot slice

This slice adds a pure `pantrack.replenishment-review.v1` calculation. It creates
an immutable, JSON-safe review snapshot from caller-supplied exact quantities,
inventory/config/settings versions, supplier identity and SKU, and a fictional
sales-readiness input. No API, database table, supplier call, scheduling, or
purchase action uses this module yet.

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

The snapshot builder still receives settings and sales health from a caller.
Connecting persisted settings to exact inventory balances, mapping Person B's
accepted health contract, and durable proposal storage/invalidation remain
open. A7 owns the later proposal lifecycle and Person C handoff. M7 acceptance
still waits for M5's reliable sandbox inputs.
