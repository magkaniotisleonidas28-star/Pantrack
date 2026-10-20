# C4 second-addition timeout: bounded offline diagnosis

Date: 2026-10-14. C4/M8 remain open. The original cause remains unresolved.

The new investigation stopped on its **first case, before browser connection**.
The investigation runner's fetch allowlist blocks the local debugging port needed
by Stagehand. This introduced a separate startup failure. The remaining eleven
slots were not used; there was no retry, automatic repair or additional browser
attempt. The twelve-case matrix did not complete, so **“not reproduced; cause
unresolved” is not a completed-matrix result for this task**.

## Contract and source

This bounded C4 outcome reviews reliability job 25 and saves a private diagnostic
report using at most twelve fresh normal jobs and sixty mocked requests. It does
not reopen/replay the failed job, change purchasing behavior, or authorize paid
requests. All five newer `origin/main` commits were incorporated by fast-forward
through `ec59dc2`, including Git-based source fingerprinting. Existing work was
clean and preserved; implementation is on
`workstream-c/c4-second-addition-diagnosis-20261014`.

The [single-use runner](../scripts/po-cart-second-addition-check.mjs),
[task/classification module](../scripts/po-cart-worker/second-addition-investigation.mjs),
[case executor](../scripts/po-cart-worker/second-addition-case.mjs) and
[focused tests](../tests/po-cart-second-addition.mjs) are new. Exclusive fsynced task
creation and durable slot consumption precede fixture creation. Existing records,
concurrent invocations and resumed slots are rejected. Reports project fixed
categories, timestamps, counts, statuses and booleans; ordinary diagnostics retain
no DOM, screenshots, prompts, credentials or provider bodies. Existing private
fixture credentials and worker journals keep their established formats.

The Metadata prompt/completion guard, browser actions/timeouts, authorization and
retry rules are unchanged. No public API, schema, migration, supplier integration,
deployment or purchase changed. Both the injected mocked provider and an independent
fetch guard prevent real provider transport. The guard's local-debugging restriction
is a known defect in this task's runner, not a supplier or application change.

Frozen source: **533 files**, SHA-256
`66974719dbfc6dbfd966a703c9591e9a99a1232271570ce9fbfc93218d8e8b98`.
The final pipeline, investigation and final source check share this fingerprint.

## Retained job 25: observations

The original fixture remains
`.sites-runtime/po-cart-workers/reliability-43328776-2d5d-48f4-a350-c78e16c86539/24/`.
Its journal, ledger, independent saved cart, attempts/results and audit timestamps
agree on these observations:

| Observation | Saved evidence |
| --- | --- |
| Requests | Six completed mocked requests: baseline, coffee and oat Extraction/Metadata |
| First addition | Attempt at 03:18:01.639 UTC; exact verified result at 03:18:02.899 UTC |
| Second addition | Durable attempt at 03:18:05.379 UTC; held at 03:18:15.519 UTC |
| Failure milestone | Addition; ten-second response wait timed out |
| Cart | Original unrelated row plus coffee; oat and cups absent |
| Durable outcome | Two attempts, one verified result, `review_needed/uncertain_write`; ownership and exposure retained |
| Safety | Saved inventory/reservation match; external-page and checkout counters both zero |
| Missing evidence | Diagnostics were off; no saved form, request, response or response-completion trace |

These timestamps are on 2026-10-14 UTC. Ledger timestamps mark reservations,
not response completion times. No request latency is inferred from them.
Classification is **insufficient evidence**: the response-wait error does not
prove whether the form submitted, the request reached the proxy, a response
arrived, or an observer missed it. A form/navigation issue, transport interruption
and response-observation issue remain hypotheses, with no evidence selecting one.
The failed job was neither reopened nor replayed.

## Fresh investigation and stop

The fixed order is passive → form → off; within each mode, Stagehand → deterministic
and rows → compact. Both readers use normal fixtures with zero injected delay.

Only passive/Stagehand/rows was attempted. The slot was consumed before preview
startup and fixture creation. It claimed the job, emitted launch/heartbeat
milestones, and hit the existing **60-second Stagehand initialization timeout**.
There were **zero addition attempts, additions and mocked provider requests**.
The cart retained its single original row; inventory and the $250 fictional
reservation matched their initial values. The never-attempted job remains
`preparing` with an expired lease and retained ownership/exposure; it was not
recovered or cancelled. Classification is **before addition**, separate from job 25.

Read-only inspection of installed Stagehand 4.1.0 shows that local startup captures
global fetch and polls an ephemeral loopback debugging port. This task's allowlist
permits only application/storefront origins. A stubbed fetch probe, with no browser
or provider request, confirms rejection of the required debugging endpoint and
continued rejection of provider transport. This explains the runner's startup
block; it supplies no cause-specific evidence about the original timeout.

The twelve-event private diagnostic file is mode 0600. It has no connected/closed
lifecycle or saved browser-network counters. Accordingly the result marks evidence
health and browser cleanup false, and runtime external-page/checkout counters
**unavailable**, not verified zero. Scoped cleanup subsequently stopped the new
browser; independent process inspection found none remaining. Both task-created
credentials were revoked, returned HTTP 401, and have revoked database records.
The task-owned preview stopped and ports 5181/5182 are free. No pre-existing process
was stopped. The consumed record permanently prevents using the eleven unused slots.

## Verification and preservation

The focused suite covers the six failure categories, report/diagnostic privacy and
bounds, actual worker off-mode behavior, exact manager-projection attempts/results,
exclusive/concurrent/crashed task records, durable slot bounds, interruption and
stopping on failure, source change, unhealthy evidence or cleanup failure. Four
focused diagnostic/preflight/reliability suites also passed. Their passing coverage
did not detect the local-debugging incompatibility before the browser run.

The final sequential standard pipeline passed: `pnpm typecheck`, `pnpm test`
(**88 suites**), `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local` and
`pnpm test:local`. An earlier pipeline was invalidated by a checker correction
during verification; it is not final-source evidence. No full 21-step browser gate
or paid matrix ran in this task.
This passing HTTP smoke supplies no causal resolution of the earlier C2 cold-start
framework failures recorded in [the status sync](C2_STATUS_SYNC_20261013.md).

Independent final comparison preserved **10,415 protected artifact states**,
**463 historical carts**, **33,333 historical data rows** and **35 historical gate
references**. One Cloudflare `_cf_METADATA` bookkeeping row changed during local
preview startup; it is explicitly excluded from the unchanged data-row count.
Historical attempts, results, ownership and reservations retain their hashes.
Both real budget locations and the consumed allowance retain their fingerprints;
the legacy budget and new paid allowance remain absent. Real reservations remain
**$0.921518**, with **zero new real requests or reservations**. The new fixture,
its zero-attempt cart and reserved exposure are retained.

Private evidence is under
`.sites-runtime/po-cart-workers/second-addition-task-20261014/`: `baseline.json`,
`historical-observations.json`, `pipeline-final.json`, `task.json`, `report.json`,
`startup-transport-analysis.json`, `runtime-cleanup-observations.json`,
`preservation.json` and `cases/0/`. Reports and diagnostics are private. No provider
output or private credential is included in this document.

## Handoff and rollback

The next unblocked C4 outcome is a **source-only review of the diagnostic runner's
local-debugging boundary and failed-launch cleanup**, with a focused compatibility
test. Any later browser investigation needs a separately reviewed fresh bounded
task; this record and its unused slots cannot be resumed. The original timeout
remains unresolved. Cause-specific repairs, all 21 acceptance gates and any paid
matrix remain separate follow-ups; C4/M8 remain unchecked and purchasing disabled.

Rollback removes only this task's four new source/test files and restores its
documentation edits against `ec59dc2`. Preserve the integrated upstream commits,
all evidence, consumed records, real budget reservations, carts and unresolved
holds. No migration rollback is needed.
