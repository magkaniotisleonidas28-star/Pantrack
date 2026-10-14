# BUG-05: managers can recover interrupted sales

Date: 2026-10-11. B5/M4 recovery with the B7/M5 consumer.
Scope: [BUG-05 in the fix checklist](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-05--expired-processing-events-have-no-runtime-recovery-path).
Baseline `438cbad` includes local BUG-02/03/04 above main `161d08f`.
Branch: `workstream-b/bug05-sales-recovery-20261011`; worktree:
`work/bug05-sales-recovery-20261011`. Fixing commit:
`9073ee24515cde572bf57eefe349e86c9172a877`.

## Runtime action and outcome

An expired `processing` sale previously rejected both another claim and Retry;
no runtime caller reached safe recovery. The new HTTP regression reproduced
that state and failed before the fix because `action:'recover'` returned 400.
The fixed endpoint returns the reconciled status with an explicit outcome.

Owner/manager POST `/api/sales/events` accepts exactly `companyId`, `action:
'recover'`, `eventKey`, and a nonempty reason. Both route and domain enforce
authorization. The action targets one company-bound event, uses server time,
refuses an active lease, atomically fences an expired worker, and checks the
original immutable inventory application key. It never submits to a supplier
or invokes an external provider.

- No committed application: the sale remains `failed/interrupted`, stock stays
  unchanged, and a manager may review and explicitly use Retry.
- A committed application: append the safe recovery result, mark the sale
  applied, preserve the original failed attempt and inventory result, and make
  no new stock deduction. New revisions use the confirmed original baseline.
- Unreadable outcome: return 503 with review guidance, retain the worker fence
  and unresolved sale, and permit another recovery check. No automatic retry.

Expiry transition/audit records the authenticated manager and reason once.
The audit now depends on the actual winning state update, preventing duplicate
audits when concurrent recoveries use different timestamps. Reconciliation
retains BUG-02's separate immutable system audit. Repeated recovery is safe.
Status summaries add optional `leaseExpiresAt`; employee responses still expose
only their existing safe status/time fields. Store recovery options add event,
limit, actor and reason; the default limit is 100 and the runtime action uses 1.
GET status/history has no recovery writes. No polling/webhook/scheduler was added.

The actual Sales & exceptions screen offers **Check interrupted sale** after
expiry, or to recheck an interrupted failure. It explains whether saved stock
changes exist. Retry stays a separate manager action. The server checks expiry
even if the browser clock is wrong. Refresh updates the displayed lease/status.

## Local evidence

- Original six focused suites passed before editing. New served regression
  failed before the fix (400 instead of 200), then passed.
- `pnpm test sales-recovery-runtime sales-ingestion-contract
  sales-event-store-contract b4-sales-inventory clover-b6-local m2-security
  sales-inventory-outcome-recovery`: seven suites passed. The new test serves
  the actual route with fictional authentication/company bindings and the real
  migrated SQLite stores, mapping and inventory service. Deferred barriers
  cover pre/post-commit termination, late workers, duplicate/concurrent runtime
  calls, different-timestamp audit races, explicit retry, newer revisions,
  unexpired leases, unreadable outcomes, one-event bounds, anonymous/employee/
  wrong-company rejection, reason/identity validation, disabled gate and
  read-only GET. In-memory/D1 recovery option behavior is also covered.
- `pnpm typecheck`, `pnpm test` (81 suites), `pnpm db:check` (35 migrations),
  `pnpm build`, `pnpm local:setup`, `pnpm db:migrate:local` and `pnpm test:local`
  passed in this worktree. The final focused run includes the added memory
  parity assertions. App smoke checks used only fictional local data.
- Isolated Edge exercised the real UI and served API: absent stock stayed at
  10 until clicking Retry made it 9; committed stock stayed at 9 during recovery
  and offered no Retry after confirmation. Desktop/narrow screenshots were
  inspected; no browser script errors. The harness/screenshots are ignored under
  `.sites-runtime`. Authentication is a fixture boundary in this check; hosted
  browser, real identity provider and deployed recovery are not verified here.
- Full diff review, `git diff --check` and changed relative links passed.

## Integration, repair and rollback

No new migration or change to the v1 inventory request/result fingerprint.
This branch depends on [BUG-02's outcome fence and ledger contract](BUG02_SALES_OUTCOME_RECOVERY.md)
and retains [BUG-03's unresolved-sale readiness block](BUG03_UNRESOLVED_SALES_READINESS.md).
Integrate the stacked fixes in dependency order. No branch was pushed or merged
to main in this task. Supplier submission, hosted Clover sync and deployment
configuration were not enabled. No live provider or remote database was changed.

No historical real sale was recovered. Before any separately authorized remote
use, apply/verify BUG-02's migration and release checks; keep purchasing paused
while unresolved sales remain. Recovery preserves recorded ledger results; it
cannot reconstruct already incorrect historical stock or uncertain original
consumption. Handle those through reviewed, audited physical corrections.

If recovery needs to be disabled, hide/refuse the new action while retaining
the fence and historical results. Do not roll back to unsafe unfenced stock
application or guess whether an old worker committed. Forward-fix the outcome
check. Next unblocked checklist item: BUG-06 count-receipt race.
