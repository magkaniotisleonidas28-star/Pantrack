# C4 delayed second-addition investigation with the display on

Date: 2026-10-15. Workstream **C4**, one bounded offline investigation.
**Not reproduced with display on; cause unresolved. C4/M8 remain open.**

All twelve fresh fictional browser jobs passed with exactly sixty completed
mocked inference requests. Each job reached the exact ready cart with three
additions, three matching attempts and three verified results. Inventory and
25,000-minor-unit reservations remained unchanged. There were zero real provider
requests, external page requests or checkout submissions. This investigation
does not supply a cause-specific repair or a complete acceptance gate.

The [latest failed gate](C4_FULL_OFFLINE_GATE_20261014.md), partial cart,
unresolved second attempt, reservation, ownership hold and failed report remain
historical evidence. The earlier screen-off timing is correlation with unresolved
causality; passing with the display on does not establish that the display caused
either historical failure.

## Implementation and fixed matrix

The dedicated [CLI](../scripts/po-cart-second-addition-display-on-check.mjs) fixes
the private root to
`.sites-runtime/po-cart-workers/second-addition-display-on-task-20261015/`.
It accepts no arguments, root override, retry or resume. Exclusive fsynced
invocation and case-slot records precede power, preview and fixture setup.
The existing [runner](../scripts/po-cart-worker/second-addition-investigation.mjs)
and [case executor](../scripts/po-cart-worker/second-addition-case.mjs) accept
optional internal configuration; their historical roots and defaults remain.
Execution requires this task's fresh successful six-command pipeline, matching
log hashes and frozen source. Source checks run during setup, before worker
execution and mocked requests, on a one-second polling timer, and after cleanup.

| Cases | Diagnostics | Reader order | Layout order |
| --- | --- | --- | --- |
| 1–4 | Passive | Stagehand, deterministic | Rows, compact |
| 5–8 | Form | Stagehand, deterministic | Rows, compact |
| 9–12 | Off | Stagehand, deterministic | Rows, compact |

Every Stagehand mocked response receives **1,500 ms** delay, with ten requests
per successful job. Deterministic controls delay application GET responses by
**1,500 ms**, matching the reliability harness. Reports distinguish
`mocked_provider_response` from `application_get_response`. The first case is
passive/Stagehand/rows. The global request guard allows at most sixty requests;
the matrix allows at most twelve fresh jobs. No attempted addition is replayed.
Any unexpected failure, interruption, source change, missing evidence or cleanup
failure stops subsequent cases permanently. Off-mode failures can remain
diagnostically inconclusive.

The [power guard](../scripts/po-cart-worker/display-on-power.mjs) holds a
task-owned `caffeinate -di -w <runner PID>` assertion. It verifies the exact
process identity and both display/system idle-sleep assertions, checks display-on
power-log evidence before browser startup and before/after every case, and samples
ownership/assertions during execution. Missing, stale or unavailable evidence,
display-off, sleep/wake activity or assertion loss makes the run inconclusive.
All **25 power-log checks** and **448 assertion samples** passed during the
525-second assertion lifetime. No saved power setting was changed and the
display was never intentionally turned off. Cleanup released the assertion.

Passive/form timelines retain bounded private provider phases, heartbeat and
ownership observations, click dispatch, request/response and verification events.
Off mode writes no diagnostic timeline. Existing mocked inference, loopback and
redirect restrictions, prompts, browser actions/timeouts and purchasing controls
remain unchanged. Supplier submission and automatic purchasing stay disabled.

## Preparation and local evidence

The [non-browser regression](../tests/po-cart-display-on-investigation.mjs) covers
matrix order, fixed delays, real mocked-response delay propagation, the request
bound, durable consumption/refusal, source/pipeline binding, interruption and
stop behavior, power-log failures, assertion identity/lifecycle and independent
final cleanup actions. Existing partial-issuance regressions and the
[repaired credential audit](C4_CREDENTIAL_AUDIT_REPAIR_20261015.md) verify that SQL
failure cannot suppress HTTP verification or later credential cleanup.

`pnpm test:focused po-cart-display-on-investigation po-cart-second-addition
po-cart-second-addition-compatibility po-cart-second-addition-repair
po-cart-credential-audit po-cart-preview-cleanup po-cart-evaluation-preflight`
passed all seven suites. The fresh preparation pipeline then passed:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **95 suites** |
| `pnpm db:check` | Passed, 35 ordered migrations and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no pending local migrations |
| `pnpm test:local` | Passed, ordinary fictional loopback HTTP smoke |

Node 22.23.2 and pnpm 11.25.0 ran in this worktree. Preparation and all twelve
browser cases used **549 source files**, SHA-256
`05a3e99564b2415b03ffb6f4465a12672124d07997d1ff37666d04bba8f38da9`.
Executable source remained frozen throughout the run. No retry, separate startup
probe, confirmation run, full gate, paid inference, supplier access, purchase or
deployment followed.

## Preservation, cleanup and private evidence

The invocation is fully consumed. All new carts, attempts/results, reservations
and ownership holds are retained. The task uses the repaired SQL/HTTP helper for
case cleanup and a separate final audit of every capability captured before SQL
or private credential-file issuance. All **24 credentials** were revoked and
returned HTTP **401 before the preview stopped**. Repeated cleanup safely left
terminal credentials unchanged.

Private evidence contains inherited source snapshots and hashes, the incoming
dirty diff/status, historical artifact/cart/database baselines, focused and
pipeline logs, invocation/report records, per-case manifests/journals/mock
ledgers, diagnostic timelines, credential audits, power evidence, independent
job/process/preservation audits and source-only rollback instructions. Evidence
files use 0600 and private directories use 0700. Independent audit totals are
recorded in `preservation.json`, `database-delta.json` and `job-audit.json`.

The independent read-only job audit passed all twelve persisted carts,
attempt/result intents and observations, inventory, reservations, ownership holds
and mocked-request counts. Historical business preservation passed for all
**482 carts** and **36,412 baseline business rows** across six local databases.
The pipeline smoke added **16 ordinary fictional rows**; the investigation added
**876 separate served-cart business rows**. Three bookkeeping row states changed.
Real budgets, consumed records, prior reports and held-job evidence are preserved;
real reserved exposure remains **$0.921518**. Of **282,911 baseline artifacts**,
**282,894** matched their hashes; the seventeen exceptions are described below.

The independent process audit found zero remaining owned processes, preview-group
members or browsers using any of the twelve task profiles. Ports 5181/5182 were
free, and the task's assertion process and both assertions were cleared.

**Strict artifact preservation failed:** seventeen cache/QuotaManager files in
three older browser profiles changed after the baseline. Read-only inspection
found three unowned orphaned Chrome roots (27 associated processes), with process
start times on October 11, predating this October 15 task. These profiles do not
map to the new investigation jobs. Their activity is consistent with this drift;
the inspection does not prove which process wrote each file. No legacy process
was signaled and no historical file was restored. The initial failed audit is
retained as `preservation-strict-initial.json`; subsequent read-only comparisons
record the artifact exceptions explicitly. The twelve-case diagnostic result
stands, while blanket historical-artifact preservation is unproved.

## Rollback and next handoff

Use this task root's `rollback-manifest.json`: restore only its `restore` files
from `source-before/` and remove only its `remove` files. Preserve every runtime
artifact, consumed record, credential event, cart, reservation and hold. This
restores the inherited dirty work without reverting prior repairs. There is no
migration, public API or downstream application-contract change. Source rollback
invalidates this fingerprint and grants no new execution allowance.

The next unblocked C4 item is to separately scope a causal investigation/repair
or a fresh complete offline acceptance gate on reviewed source. Review the
unowned legacy browser processes and artifact-preservation boundary separately
before relying on a future blanket baseline claim. Neither a repair nor another
gate runs automatically. Paid/model, hosted, supplier, pilot and production evidence remain
separate; no milestone checkbox advances.
