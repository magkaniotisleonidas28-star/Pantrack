# C4 fresh bounded browser investigation

Date: 2026-10-14. Workstream **C4**, one completed local investigation.
**Result: “not reproduced; cause unresolved.” C4/M8 remain open.**

All twelve fresh normal cases passed against the
[repaired connector and teardown](C4_CONNECTOR_SOURCE_REPAIR_20261014.md).
The first passive/Stagehand/rows case exercised real local SDK startup; no
separate browser probe ran. This proves compatibility for this local run and
does not explain the original reliability-job-25 timeout or the historical
preview verification failure. No cause-specific repair was made.

## Scope and runner contracts

The single-use root is
`.sites-runtime/po-cart-workers/second-addition-compatibility-task-20261014/`.
It was absent before preparation. Exclusive durable task creation and consumption
of each slot precede preview or fixture creation. All twelve slots are now
consumed; there is no resume, root override or allowance restoration. Both prior
consumed investigation roots and their eleven unusable slots each are unchanged.

The [runner](../scripts/po-cart-second-addition-check.mjs) validates all six
successful pipeline steps and their log fingerprints. An internal source check
immediately before durable creation binds the task to that pipeline's fingerprint.
The same fingerprint is checked throughout setup and the matrix, including
immediately before fixture creation and worker execution. A detected change
permanently stops the invocation, even if source is subsequently restored.

Explicit mocked inference, fictional provider credentials, the loopback-only
fetch guard and redirect rejection remain in force. Storefront restrictions,
checkout blocking, Metadata prompt, completion guard, action/startup timeouts and
resource cleanup are unchanged. The fixture now captures each newly generated
credential in memory before SQL/private-file writes, allowing revocation and an
HTTP 401 check after partial issuance. Revocation runs independently of browser
cleanup. This runner suppresses raw failure messages in its worker journal; its
reports retain only fixed categories, timestamps, counts, statuses, booleans and
fingerprints. No screenshots, DOM, prompts, provider bodies, raw errors or process
commands were captured in this investigation's reports.

Changes are limited to internal scripts/tests and evidence documentation. There
is no public API, schema, migration or deployment change. Supplier submission and
automatic purchasing remain disabled. Paid inference, supplier access, checkout,
retained-job recovery and the full 21-step gate were outside this task.

## Verification and matrix

The eight focused suites passed: connector receiver binding, preview cleanup,
browser network boundary, provider diagnostics, evaluation preflight,
second-addition investigation/repair and the new
[compatibility regressions](../tests/po-cart-second-addition-compatibility.mjs).
The new non-browser regressions cover the fixed root, incomplete/mismatched
pipeline, source changes between validation and durable creation, checks before
fixture/worker execution, argument rejection, durable refusal after use and
partial credential capture. They create no browser jobs.

The complete sequential local pipeline passed before any browser execution:
`pnpm typecheck`, `pnpm test` (**92 suites**), `pnpm db:check`, `pnpm build`,
`pnpm db:migrate:local` and `pnpm test:local`. Preservation checks passed before
source was frozen. All pipeline steps, the task, matrix and final source audit
share **539 files**, SHA-256
`d708c337d4e8fffa1816d8daa2d1015fd5dc9a43067751771d97677b3543d55f`.

Cases ran in the specified order, with normal fixtures and zero injected delay:

| Diagnostics | Reader | Layout order | Passed jobs | Completed mocked requests |
| --- | --- | --- | --- | --- |
| passive | Stagehand | rows → compact | 2 | 20 |
| passive | deterministic | rows → compact | 2 | 0 |
| form | Stagehand | rows → compact | 2 | 20 |
| form | deterministic | rows → compact | 2 | 0 |
| off | Stagehand | rows → compact | 2 | 20 |
| off | deterministic | rows → compact | 2 | 0 |

Independent read-only database/storefront inspection verified every exact
baseline-plus-three-line cart: preserved `EXISTING`, then `DEMO-COFFEE` × 1,
`DEMO-OAT` × 2 and `DEMO-CUPS` × 3, with the reviewed packs/prices. All **36 unique
attempts** have matching exact intents and independently verified results. Baseline
and final durable observations match all twelve carts. Inventory and commitments
remain empty for each new company; each original $250 fictional reservation is
unchanged and retained. No purchase or delivery was confirmed.

Every case has complete page interception coverage, zero external-page requests,
zero checkout submissions and successful resource/process cleanup. Passive/form
diagnostics are healthy and complete; off mode has verified absence in all four
cases. Eight private streams contain 837 numeric/status events in total, each
within its existing bounds. All six Stagehand cases completed exactly ten mocked
requests each; deterministic cases made none. Real inference requests: **zero**.
The proxy separately recorded 427 blocked Chromium background requests and 99
blocked local telemetry requests; these are distinct from page-request counters.

All **24 newly issued credentials** were revoked. The runner verified HTTP 401
while the owned application preview was available; a separate read-only HTTP
audit independently captured all 24 responses. Final database inspection confirms
revoked status and timestamps. Cleanup succeeded independently: acquired browser,
CDP driver and proxy resources closed; exact task browser profiles have no live
processes. Preview child exit, process-group clearance and ports 5181/5182 being
free are separately verified. Only SIGTERM was needed for the owned preview;
no escalation or unrelated-process signal occurred. Pre-existing observed browser
and workerd identities are unchanged.

## Preservation, rollback and handoff

The fresh baseline preserves the incoming dirty worktree. Independent comparisons
verified **10,558 protected artifact states**, **465 historical carts**, **35,163
historical database rows**, **35 historical gate references** across six local
databases, and 685 unrelated source/document files. Historical business rows,
attempts, results, holds, reservations and failed reports retain their hashes.
Both real budget locations and consumed allowances retain their fingerprints;
real reserved exposure remains **$0.921518**.

Bookkeeping is recorded separately: two `_cf_METADATA` rows changed, one per
application database, and one `sqlite_sequence.po_cart_worker_credential_events`
counter advanced to the verified maximum event ID. These are excluded from the
unchanged-row count. Expected new fictional data consists of twelve isolated
companies/jobs/carts, 36 attempts/results, 24 credential identities/credentials
and their supporting authorization/audit rows: 852 new business rows in the cart
database. The standard HTTP smoke leaves one ordinary-local fictional company
and its supporting rows, 16 new business rows. Existing data was not repaired or
replayed. New carts, reservations, ownership, profiles and evidence remain retained.

Private evidence under the new root includes `source-before/`, `baseline.json`,
`incoming-work.patch`, `database-before.json`, `storefront-before.json`,
`pipeline-final.json`, `preservation-before-execution.json`, `freeze.json`,
`task.json`, `report.json`, per-case journals/diagnostics/mock ledgers,
`cases-audit.json`, `credential-http-audit.json`, `process-audit.json`,
`database-delta.json`, `preservation.json` and `final-audit.json`.

For source-only rollback, restore exactly the eleven existing files listed in
`rollback-manifest.json` from this root's `source-before/`; remove only this
evidence document and the new compatibility test. Preserve inherited dirty work
and **all** runtime evidence, consumed records, carts, profiles, reservations and
holds. No migration rollback is needed. Source rollback invalidates this
verification fingerprint and restores the older runner's root; it grants no
execution allowance and cannot resume either prior invocation.

The next unblocked C4 item is to scope a **fresh complete offline acceptance
gate** against the intended source. This bounded matrix does not replace that
gate or authorize paid validation. Any browser follow-up needs its own scope;
real-model, hosted, supplier, pilot and production evidence remain separate.
