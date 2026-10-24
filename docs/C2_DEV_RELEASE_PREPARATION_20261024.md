# C2 development-release preparation — 2026-10-24

## Outcome and authorization boundary

The technical preparation for the next `pantrack-dev` release is complete.
The application candidate is frozen, the current hosted state has been read,
the backup has been restored locally, and all eleven pending migrations have
passed a populated-data rehearsal. **The online release has not been executed.**

Owner confirmation of current data use, automatic-build configuration and the
specific maintenance/migration/deployment operation is still required. No
milestone checkbox advances from this preparation. This packet implements one
C2 outcome; A8/M7 and C3–C5/M8 acceptance remain separate.

| Item | Prepared target or observed state |
| --- | --- |
| Application source | `911fcb14c1ec7e210be864dd36fbee77d267a770` (`main` when preparation began). |
| Worker | `pantrack-dev`, account `46a94b92309dd488dadd02f6ae70e0ff`. |
| Website | <https://pantrack-dev.christospsimadas25.workers.dev>. |
| D1 | `pantrack-dev-db`, `9b50014b-f929-4f03-a187-599df6e438b1`. |
| Active Worker | `ed5e9c65-31b7-432f-bff9-bf4df45e9b68`, 100% traffic; deployed `2026-10-05T02:50:23Z`, release `65373b3`. |
| Remote ledger | 24 entries, exactly `0000`–`0023`; `0024`–`0034` remain pending. |
| Runtime gates | Exact inventory enabled; Clover sync disabled; PO/cart preview gates absent. Supplier submission and automatic purchasing stay server-blocked. |
| Bindings and scheduling | Expected D1 binding and nine secret-binding names present; no cron schedules. Secret values were not fetched or replaced. |
| Automatic builds | Correct Worker-tag trigger/build reads returned 403. Configuration remains unverified; lack of permission is not evidence that automatic deployment is off. |

The existing Wrangler OAuth login can read this Worker and D1. No credentials
need to be pasted into chat. The two remote SQL metadata queries and final ledger
recheck each reported zero rows written and `changed_db=false`.

GitHub verification was refreshed for the application commit: both Windows and
Ubuntu completed the full [Repository checks run](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/39869805536)
successfully. Supabase Preview also passed; that does not verify sign-in,
recovery callbacks or signed-in hosted behavior.

## Backup, restore and upgrade rehearsal

All private artifacts are under Git-ignored
`.sites-runtime/c2-release-preparation-20261024/`. Its Windows ACL restricts access
to the current user, SYSTEM and local administrators. SQL exports, restored
databases, authentication metadata and raw logs must remain private.

- `before.sql`: 259,167 bytes, SHA-256
  `8d9ec196876b34314c7f186cc18ab841d2b2b82cc21ae579c7d04f48e2db6189`.
- The export contains every captured application table, index and trigger. The
  first overly broad restore assertion also expected D1's reserved `_cf_KV`
  table; that failed attempt is retained. The corrected application restore
  excludes `_cf_KV` and platform bookkeeping, as required by
  [Cloudflare's import guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
- The reviewed restore recreated the captured application schema and all
  **66 application/ledger tables, 474 rows**. A second SQL round trip matched all
  row hashes and schema objects. Integrity and foreign-key checks passed.
  There were no exported integer cells outside JavaScript's safe integer range.
- Applying each unchanged migration in order preserved every existing row.
  The sole replacement of a pre-existing business-schema object is the declared
  `0034` sales receipt trigger. Forty new application tables remained empty.
  A local simulation then appended eleven migration receipts, preserving the
  original 24 ledger records and producing the expected 35-entry ledger.
- `restore-reviewed.sql` SHA-256:
  `efb1d2729b51b9d5e357d5fa7f3b315f044c7e1e914685ba8ad15dae1a3e349b`.
  This is a private local restore artifact, not a command to overwrite live D1.
- A current Time Travel bookmark was captured privately. Capture another at
  cutover; bookmark validity depends on the account's retention. A
  [Time Travel restore](https://developers.cloudflare.com/d1/reference/time-travel/)
  overwrites the database and needs a separate recovery decision.

The preparation backup is rehearsal evidence. After maintenance has stopped new
writes, execution must take a fresh backup, schema/ledger capture and bookmark
and repeat the preservation checks against that exact cutover snapshot.

## Ordered migration review

Used SQL, snapshots and journal entries are unchanged. The complete range was
reviewed against the observed `0023` baseline, rather than reviewing only `0034`.

| Migration | Resulting scope | New application tables | Wrangler splitter observation |
| --- | --- | --- | --- |
| `0024_supplier_simulation.sql` | Review-only supplier simulation, reservations and audit. | 7 | Trigger boundaries preserved. |
| `0025_purchase_order_drafts.sql` | PO drafts, lines, operations and events. | 4 | Trigger boundaries preserved. |
| `0026_purchasing_supplier_registry.sql` | Supplier/mapping versions and registry audit; updates a newly introduced PO guard. | 6 | Trigger boundaries preserved. |
| `0027_purchase_order_draft_review.sql` | Revision snapshots and guarded draft review; backfills only the new PO tables. | 1 | Multiple triggers merged into one splitter group. |
| `0028_po_cart_authorizations.sql` | Durable permission, policies, reservations and commitments. | 7 | Trigger boundaries preserved. |
| `0029_po_cart_jobs.sql` | Jobs, owners, attempts, results and audit. | 6 | Multiple triggers merged into one splitter group. |
| `0030_po_cart_worker_transport.sql` | Worker identity, hashed credentials and credential events. | 3 | Trigger boundaries preserved. |
| `0031_po_cart_local_browser.sql` | Browser evidence; additive columns on newly introduced cart tables. | 1 | Trigger boundaries preserved. |
| `0032_po_cart_browser_sessions.sql` | Private session/observation/operation records and guards. | 3 | Trigger boundaries preserved. |
| `0033_po_cart_reconciliation.sql` | Reconciliation evidence and guarded release of uncertainty. | 2 | Trigger boundaries preserved. |
| `0034_sales_inventory_outcome_fence.sql` | Replaces receipt supersession and requires the current sales attempt for new inventory applications. | 0 | Four statements; each trigger remains complete. |

Wrangler 4.92.0's exported splitter exposed the `0027` and `0029` grouping issue.
Do not rewrite those used migrations or assume remote batch parsing from local
success. Use the established **unchanged SQL file-import path**, in order,
with schema verification and one ledger receipt per completed file. The earlier
[W1/W2 release](C2_W2_HOSTED_RELEASE.md) and
[trigger-import recovery](M2_SETUP.md#development-d1-trigger-migration-recovery)
document this transport and its verification rules.

Fresh **local** Wrangler migration application nevertheless completed all 35
migrations. Its resulting application schema exactly matched native SQLite:
351 schema objects, including 184 triggers. This verifies the local result;
it does not establish the remote parser's behavior.
The upgraded copy of the actual hosted backup also matched all 351 expected
schema objects and all 105 application-table contracts. Index creation order
was normalized by name while preserving uniqueness, columns and predicates.

## Frozen candidate and completed checks

The prepared candidate contains 146 files under private `candidate/client` and
`candidate/server`. Its manifest SHA-256 is
`24a8d0113a082cda5d3e6ab3948303b46548f9cad75c5b3af6f55e2b44b7113c`.
The private Wrangler configuration points at these copied files and the exact
existing Worker/D1 target. Preview `.dev.vars` is excluded. Deployable files
were scanned for the available private local credential values and OAuth token;
none matched. The manifest remained unchanged after the checks.

| Check run in this checkout on October 24 | Result |
| --- | --- |
| Five focused upgrade/recovery/readiness/purchasing suites | Passed. |
| `pnpm db:check` | Passed: 35 ordered migrations, matching schema and fresh SQLite. |
| `pnpm build` | Passed. |
| Fresh private `wrangler d1 migrations apply --local` | Passed all 35; resulting schema/triggers independently compared. |
| Current-build and frozen-copy `wrangler deploy --dry-run --keep-vars` | Both passed; no upload/deployment occurred. |
| Exact candidate/maintenance `wrangler versions upload --dry-run --keep-vars` | Passed for both prepared configurations; remote upload acceptance remains an execution check. |
| Frozen production bundle served by local Wrangler | Passed seven HTTP checks with synthetic runtime settings: home/auth 200, anonymous and forged-fixture APIs 401, local sign-in fixture 404. |
| Prepared maintenance bundle served by local Wrangler | Passed five paths: 503, `Cache-Control: no-store`, `Retry-After: 60`. |
| Current hosted application | Passed seven read-only HTTP checks of the old active release. |
| Final read-only recheck | Active deployment, original 24 ledger entries, binding names/types and gates unchanged. |

The first local production-bundle probe had no `APP_ORIGIN` and returned 500.
That failed harness attempt is retained. A separate local-only configuration
with fictional runtime values passed; those values are not in the frozen release
configuration and must never replace hosted secrets. These HTTP checks do not
test Supabase authentication or signed-in writes. The complete six-command
desktop pipeline remains the separately recorded
[October 22 evidence](C2_LOCAL_READINESS_20261022.md); it is not relabeled as a new
full desktop run today.

Documentation verification passed `git diff --check`, 273 relative file links
and nine section anchors. Milestone checkboxes are unchanged. Private evidence
is untracked, and the frozen candidate manifest still matches.

## Execution checklist — only after specific release authorization

1. **Resolve owner decisions.** Confirm development/test versus real business
   use, maintenance availability, and the Cloudflare Builds connection. If a
   repository trigger exists, pause its deployment path before cutover through
   an explicitly authorized configuration change. Do not push preparation commits
   while an unverified trigger might deploy incompatible code ahead of schema.
2. **Revalidate exact inputs.** Check the target account/Worker/D1, active Worker
   version, `0023` ledger prefix, original schema, nine secret-binding names and
   disabled Clover/purchasing gates. Recheck the frozen file manifest and all
   eleven migration hashes. Stop on drift, unexpected schedules/queue consumers,
   another migration operator, or a newer application source.
3. **Stage the candidate, then enter maintenance.** Upload the frozen candidate
   with `--keep-vars`, record its version ID and verify the returned bindings and
   gates before any schema mutation. Do not activate it or visit its preview URL
   against the old schema. If upload fails, stop with the current app intact.
   Upload the prepared maintenance version with `--keep-vars`, record its ID,
   then activate that exact ID at 100%. Verify 503/no-store/Retry-After on app,
   API and ingestion paths. Stop new sales application and recovery, allow
   in-flight work to settle, and verify
   no processing sales lease remains. Retain existing held/failed outcomes.
4. **Capture cutover recovery evidence.** Take a fresh private export, complete
   schema/ledger and Time Travel bookmark. Restore the export locally and bind
   the preservation comparison to this snapshot. Do not copy a practice database
   into hosted D1 or reset stock, history, sessions or recovery fences.
5. **Import one migration at a time.** Follow the table's order using unchanged
   files. After each import, compare the complete expected schema, trigger
   definitions and original-table counts. Only after a matching result add and
   verify that file's single `d1_migrations` receipt. A timeout or uncertain
   response requires read-only reconciliation; do not blindly replay DDL or
   insert an optimistic ledger entry. Stop and retain maintenance on partial or
   unexpected results.
6. **Verify the upgraded database.** Require exactly 35 ordered ledger records,
   expected schema/guards, empty new purchasing/cart tables, integrity and
   foreign-key checks. Export again and compare every original row/column with
   the cutover backup. Only the eleven new ledger receipts may differ in old
   application tables; platform bookkeeping is recorded separately.
7. **Activate the staged candidate.** Recheck its recorded version ID and target
   bindings/gates, then activate that ID at 100%. No split traffic with the old
   sales runtime.
   Do not upload local test variables or enable POS sync, PO/cart previews,
   purchasing, schedules or supplier/model execution.
8. **Verify hosted behavior.** Recheck the deployment/version and ledger, home
   and auth pages, anonymous/forged-header rejection, disabled fixture and gated
   purchasing behavior. The owner signs in normally and reviews retained
   inventory/history. Record any separately authorized fictional write/recovery
   walkthrough independently; HTTP status alone does not close A8 or C4.

The following are command templates for the authorized operator, not a record
that these remote mutations ran. The pinned CLI help was checked locally.
Record returned version IDs; replace placeholders only with those recorded IDs.

```powershell
$releaseNode = '.sites-runtime/tools/node-v22.23.2-win-x64/node.exe'
$releaseEvidence = '.sites-runtime/c2-release-preparation-20261024'

# Stage the candidate first; verify its returned version metadata without activation.
& $releaseNode --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js versions upload --config "$releaseEvidence/candidate/server/wrangler.json" --keep-vars --tag c2-911fcb1-20261024

# Maintenance upload, followed by activation of its recorded version.
& $releaseNode --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js versions upload --config "$releaseEvidence/maintenance/wrangler.json" --keep-vars --tag c2-maintenance-20261024
& $releaseNode --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js versions deploy '<maintenance-version-id>@100%' --config wrangler.jsonc --yes

# Use a NEW private execution folder for the cutover backup and metadata.
# The first migration below is an example; repeat separately in reviewed order.
& $releaseNode --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute pantrack-dev-db --remote --config wrangler.jsonc --file drizzle/0024_supplier_simulation.sql
# Verify expected schema and preservation BEFORE recording this receipt.
& $releaseNode --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute pantrack-dev-db --remote --config wrangler.jsonc --command "INSERT INTO d1_migrations(name) SELECT '0024_supplier_simulation.sql' WHERE NOT EXISTS(SELECT 1 FROM d1_migrations WHERE name='0024_supplier_simulation.sql')"

# After all migrations, ledger and preservation checks pass:
& $releaseNode --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js versions deploy '<candidate-version-id>@100%' --config wrangler.jsonc --yes
```

Uploading a version and activating traffic are separate operations; a normal
`wrangler deploy` combines them. This checklist deliberately controls activation.
See [Cloudflare's version model](https://developers.cloudflare.com/workers/versions-and-deployments/).

## Failure handling, limits and next handoff

Before schema mutation, the captured original Worker is the application recovery
point. Once migration work starts, retain maintenance on any uncertainty and
inspect the actual database state. After `0034`, the old runtime omits the sales
attempt marker and cannot safely resume ingestion. Do not drop the guards,
rewrite old migrations, repair historical balances in bulk, or automatically
restore old sessions. Use a reviewed compatible runtime or additive forward
repair, following [BUG-02's rollout/rollback rules](BUG02_SALES_OUTCOME_RECOVERY.md#compatibility-repair-and-rollback).

A [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
does not roll back D1. A database restore could replace newer data and must be
separately authorized with current auth-fence and business-state review. The
local restore test is not a remote disaster-recovery acceptance claim.

No remote migration, Worker upload/deployment, live POS/supplier call, paid model
call or purchase occurred during preparation. Source/application contracts are
unchanged. The only repository instruction change prevents repeated PowerShell
`rg` wildcard mistakes; application SQL and migration metadata are untouched.

**Next:** obtain the owner answers and explicit authorization for the exact
prepared development release, then execute this checklist. Hosted A/B regression
evidence and A8/M7 follow; C4/M8 and all purchasing gates remain open.
