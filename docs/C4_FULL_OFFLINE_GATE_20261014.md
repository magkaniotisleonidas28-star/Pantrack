# C4 fresh complete offline gate attempt

Date: 2026-10-14. Workstream **C4**, one frozen-source offline gate invocation.
C4/M8 remain open. The original second-addition timeout remains unresolved.

## Contract and preparation

This task authorizes one attempt at the existing 21 steps, in their existing
order, stopping at the first unexpected failure. It authorizes no retry, resume,
extra browser probe, paid inference, supplier access, checkout, deployment or
historical held-job recovery. Expected injected faults count only when their
existing safety assertions pass.

The fixed private root is
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014/`.
It was absent before preparation. The incoming dirty worktree is preserved in
`source-before/`, `source-before.json`, `incoming-work.patch` and
`incoming-status.txt`. Baselines cover 11,130 protected artifacts, 477 historical
carts and 36,029 business rows plus five bookkeeping row states across six local
databases. Both real
budget locations and every historical consumed record are fingerprinted.

The runner rejects arguments, filters, resume and root overrides. Exclusive,
durable `task.json` creation permanently consumes the invocation, and every step
is durably consumed before its preview, fixture or command starts. The six-step
preparation report and its logs are validated before creation. Source checks run
through setup, between steps, immediately before fixture/browser work and during
execution. A source change permanently stops the invocation.

The internal harness changes reuse the verified receiver-safe browser connector
and ownership-checked cleanup. Preview child exit, process-group clearance and
free ports are separate assertions. Newly issued fictional credentials are
captured before SQL/private-file writes, revoked independently, and checked for
HTTP 401 while the fixture application is available. In-memory fixtures retain
synthetic SQLite state before closure. Final overall success can be written only
after independent credential, process/resource, consumption, evidence and
preservation audits succeed.

Inference-capable children install the loopback/redirect transport boundary
before importing the SDK and use explicit mocked inference and fictional keys.
Storefront restrictions remain; manager UI contexts allow only their local
application and fixture origins. Private reports retain counts, statuses,
booleans and fingerprints. Parsed Metadata capture remains bounded and separate;
reports exclude prompts, DOM dumps, provider envelopes, credentials, raw errors
and process commands. Existing scenarios, prompts, schemas, completion guards,
delays, timeouts and deliberate fault/restart behavior are preserved.

There is no public API, schema or migration change. The shared test fixture and
manager supervisor changes serve only this local harness contract. Supplier
submission and automatic purchasing remain disabled.

## Verification

The ten focused non-browser suites passed: full-gate consumption/stop behavior,
connector receiver binding, preview cleanup, browser network boundary, provider
diagnostics, Metadata evidence, evaluation preflight, compatibility,
second-addition repair and manager supervisor. They cover partial issuance,
interruption, evidence failures, cleanup failures and expected injected faults.

All six preparation commands passed, sequentially: `pnpm typecheck`, `pnpm test`
(**93 suites**), `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local` and
`pnpm test:local`. The successful preparation, freeze and gate share **543 files**,
SHA-256 `859ded2ddd73c444fd1d2bd72af28cf91b972db3f410f61320bb0d0e06e73da6`.
Before execution, preservation passed; one Cloudflare bookkeeping row changed
separately from preserved business rows during ordinary local smoke setup.

## Gate outcome

**Failed and retained.** The invocation consumed two steps and stopped at
Step 2, reliability job 5 (`rows`, Stagehand, 1,500 ms mocked delay). No retry,
resume, repair, later step or extra browser probe ran. The private report retains
`passed: false` and `status: audit_failed`; independent inspection does not
replace or upgrade that report.

| Step | Observed result |
| --- | --- |
| 1 — Metadata | Passed all 16 fresh cases: four exact ready carts, twelve baseline-preserving holds/restarts and 88 completed mocked requests. Independent SQLite/store/ledger inspection verified 12 unique matching attempts/results and all 16 revoked credentials. |
| 2 — Reliability | Four ready jobs passed with exactly ten completed mocked requests each. Job 5 stopped at the second addition stage after six completed mocked requests. It has two recorded addition calls/attempts, one verified result and one unresolved result. Only the first requested product actually reached its cart. |
| 3–21 | Not run: both served matrices, the 50-case AI safety suite, all three four-fault modes, all six repeated pipeline commands and all seven remaining browser/manager/session/reconciliation/launcher regressions. Preparation pipeline success is separate. |

The failed cart preserves `EXISTING` (box × 1, 350 minor units) and contains
`DEMO-COFFEE` (case of 6 × 1 lb × 1, 5,400 minor units). It contains no oat or
cups addition. The second attempt has no result. Its job remains `review_needed`,
its account ownership remains held and its 25,000-minor-unit fictional reservation
remains reserved. Inventory and commitments are unchanged. Do not replay either
attempt or clear the held exposure. Acceptance diagnostics were off as specified;
the retained addition-stage evidence does not identify the underlying error or
establish that this is the original reliability-job-25 timeout's cause.

All 21 fresh browser jobs had complete page interception, zero unauthorized
external-page requests and zero checkout submissions. The gate completed **134
mocked requests** (88 Metadata plus 46 reliability), with zero real inference.
No new UI screenshots were generated because their later steps were not reached.
The Metadata diagnostic streams, synthetic SQLite snapshots, storefronts,
journals and mocked ledgers remain private and fingerprinted.

The final credential audit has a separate **introduced harness defect**. Its
cleanup SQL omitted the active-status predicate and attempted to UPDATE all ten
already-revoked served credentials. The existing credential transition trigger
correctly rejected those terminal updates. The audit therefore records ten failed
SQL cleanup attempts, even though all ten independent HTTP checks returned 401.
Read-only database inspection confirms all ten were already revoked with
timestamps; the child cleanup had succeeded. This defect is uncorrected under
the stop rule. The report remains failed and a source-only repair with a regression
for repeated terminal revocation is the next unblocked C4 task.

Process/resource cleanup passed: preview child exit, process-group clearance and
free ports 5181/5182 are separately recorded. All 21 exact task profiles and their
recorded worker processes are absent in an independent process snapshot. Preview
cleanup used SIGTERM only, with no escalation. Independent source and reference
checks verified the unchanged 543-file fingerprint and 104 evidence references.
All 26 actual fixture credentials are revoked: 16 in retained synthetic databases
and ten in served D1. No cleanup limitation or live task process remains; the
failed final audit itself is retained as a limitation of the harness evidence.

Preservation passed for all 11,130 protected artifacts and 477 historical carts.
All **36,029 baseline business rows** remain; the baseline's five bookkeeping row
states are recorded separately. Two Cloudflare `_cf_METADATA` row states changed
and one credential-event sequence counter advanced to the verified maximum event
ID. There are 351 new fictional served-cart business rows, plus 16 ordinary-local
smoke rows; synthetic in-memory states are retained separately. Neither historical
business data nor a held job was repaired. Both real budget fingerprints and all
historical consumed records remain unchanged; real reserved exposure is still
**$0.921518**. This invocation is permanently consumed with 19 unrun steps.

Private evidence includes `pipeline-final.json`, `freeze.json`, `task.json`,
`report.json`, step logs/process records/evidence indexes, `metadata-independent-audit.json`,
`reliability-independent-audit.json`, `credential-http-audit.json`,
`independent-credential-db-audit.json`, `process-audit.json`,
`independent-resource-audit.json`, `independent-records-audit.json`,
`database-delta.json`, `preservation.json` and `final-audit.json`. The runner's
reports and fingerprints have not been rewritten after the stop.

## Rollback and handoff

Use this root's `rollback-manifest.json` for source-only rollback. Restore only
its `restore` files from `source-before/` and remove only its `remove` files.
This preserves all inherited dirty work. Preserve **all** runtime artifacts,
consumed records, carts, profiles, reservations and holds. No migration rollback
is needed. Source rollback invalidates the verification fingerprint and grants
no new invocation or paid allowance.

This offline attempt creates or consumes no paid allowance. Any real-model
matrix requires a separate explicit decision; hosted, supplier, pilot and
production evidence remain separate. C4/M8 stay unchecked.
