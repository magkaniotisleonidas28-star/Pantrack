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
contract must be mapped and reviewed before using real POS data. The settings
version is supplied by the caller; persistent setting versions, author audit,
proposal storage/invalidation, and concurrent quantity reservations are still
to be implemented. A7 owns the later proposal lifecycle and Person C handoff.
M7 acceptance still waits for M5's reliable sandbox inputs.
