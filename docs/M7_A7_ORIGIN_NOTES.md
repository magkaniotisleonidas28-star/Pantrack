# A7 immutable proposal origin — local slice

This A7 slice stores the first review-only proposal record in D1. It does not
complete A7 or M7. The server-side store builds the A6 snapshot from current
company-scoped exact inventory, versioned settings, and fictional sales,
supplier, and price fixtures. An owner or manager supplies a stable create ID;
an employee may read a same-company record but cannot create one. No API route
calls this store yet.

The initial status is `review_required` when the snapshot contains a review
reason, otherwise `draft`. The current D1 bridge always records
`expiry_not_checked`, so its saved records require review. The status is an
immutable origin value, not an approval or supplier state. Later A7 work will
record status changes as separate audit events.

The create operation rechecks the active inventory/config and latest settings
versions inside the insert statement. A source change between calculation and
insert leaves no proposal row. Repeating the same create ID, actor, product,
and fictional fixtures returns the original record even if inventory later
changes; conflicting reuse is rejected. The saved snapshot is recalculated
and validated when read. Records are scoped by company, and update/delete
triggers protect their history.

Migration `0016` adds only the empty `replenishment_proposal_origins` table,
indexes, foreign keys, and immutability triggers. It does not
backfill or modify older inventory, recipe, settings, or purchasing rows. For
local rollback before any origin is written, restore the pre-migration local
database snapshot. After origins have been written, preserve the history and
use a new forward-repair migration. As with `0014`, inspect the migration
ledger and schema before retrying any failed Wrangler trigger migration.
Remote migration and restore have not been tested or authorized.

Local verification on the original A7 branch passed TypeScript, 26 test suites,
the 16-migration schema check, the application build, Wrangler's local D1 apply
of its then-numbered `0015`, and the local HTTP smoke test. During integration,
B7's distinct `0015` had already been applied to development D1. The merge
owner preserved that used B7 migration, moved A7's unchanged additive SQL to
`0016`, regenerated its snapshot and journal entry, and verified 17 ordered
migrations on a fresh database. Local A7 databases that applied its former
`0015` need a fresh checkout database or a reviewed forward repair before
applying this merged sequence. Development D1 has not applied A7 `0016`.
The focused origin test also covers a
settings or inventory version changing between review calculation and insert.

This slice does not reserve unresolved quantities, invalidate older origins,
allow edits, create approval/sending states, or expose a supplier call. Those
are subsequent A7 outcomes. A8/M7 acceptance still waits for M5 input evidence.
