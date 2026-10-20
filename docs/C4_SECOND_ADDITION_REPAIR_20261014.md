# C4 diagnostic runner repair and bounded investigation

Date: 2026-10-14. **Runner compatibility is not verified. C4/M8 remain open.**

The fresh investigation stopped on its first case, before CDP connection, page
interception, additions or mocked inference. Stagehand returned a browser handle,
so the previous debugging-port restriction was passed, but this implementation
introduced an unbound Playwright method call. The saved launch error is
`Cannot read properties of undefined (reading 'name')`. The installed Playwright
`connectOverCDP` implementation requires its receiver; the helper calls the
default method through `(hooks.connect ?? chromium.connectOverCDP)(...)`.
The regression mocks are plain functions and missed this receiver requirement.
This explains this follow-up's connection failure, not the original job-25 timeout.

The matrix is consumed and cannot resume. Eleven slots remain unused. Under the
freeze/stop contract, there was no second browser attempt, source repair or probe
after the failure. **“not reproduced; cause unresolved” is not a completed-matrix
result.** The original second-addition timeout remains unexplained.

## Outcome and implementation

This is one C4 outcome: repair the diagnostic runner and gather one new bounded
offline evidence set, limited to twelve browser jobs and sixty mocked requests.
The inherited uncommitted work was preserved. The prior investigation record,
including its eleven unused slots, is unchanged.

- The [transport boundary](../scripts/po-cart-worker/offline-boundary.mjs) is the
  runner's first import. It installs HTTP-only `127.0.0.1` access at any port,
  rejects credentials and other destinations before transport, forces
  `redirect: 'error'`, and supplies fictional provider credentials. Explicit mocked
  inference remains required. The fixture sign-in reads one bounded local HTTP
  response without following its redirect, so fetch remains strict.
- The [browser helper](../scripts/cart-preview/browser-session.ts) retains bounded
  network/lifecycle evidence from proxy creation, including partial startup. It
  attempts every acquired browser, CDP driver and proxy closure, awaits the proxy,
  retains timeout/error counts and emits `closed` only after successful closure.
  The [worker](../scripts/po-cart-worker/browser-adapter.ts) persists that evidence
  even when no session returns. The default CDP call still has the defect above.
- [Task cleanup](../scripts/po-cart-worker/second-addition-cleanup.mjs) checks the
  canonical exact profile, parent and process identity before each browser signal.
  It allows five seconds after SIGTERM and, if needed, five seconds after SIGKILL
  to verify exit. Profiles and stale Chromium locks are preserved. Credential
  revocation runs independently of browser/worker cleanup success and covers
  partial fixture issuance in the unique new company.
- The [case executor](../scripts/po-cart-worker/second-addition-case.mjs) and
  [reporter](../scripts/po-cart-worker/second-addition-investigation.mjs) keep the
  failure milestone separate from cleanup flags. Writer health, lifecycle
  completeness, page-network coverage and cleanup verification are independent.
  Observed counters survive startup failure; partial coverage never proves zero
  external-page requests or checkout submissions. Reports use fixed categories,
  timestamps, counts, statuses, booleans and source fingerprints.

Storefront origin/path/method restrictions, checkout blocking, Metadata prompt,
completion guard and action/startup timeouts are unchanged. There is no public API,
schema or migration change. No live supplier, paid provider, checkout, deployment,
recovery or full 21-step acceptance gate ran. Hosted, sandbox, pilot and production
evidence remain separate.

## Verification and fresh case

Frozen source: **536 files**, SHA-256
`a8090b33a37ddb3327c3fddf7d0939f29051bce855e39d7d8c14616704929597`.
The pipeline, investigation and final source check use this same fingerprint.

Focused checks passed for the two second-addition suites, browser-network boundary,
provider diagnostics and evaluation preflight. The new
[repair tests](../tests/po-cart-second-addition-repair.mjs) use mocked launchers and
process controls and create no browser jobs. They cover ephemeral local debugging,
redirect rejection and import-time fetch capture, partial launch/CDP failure,
delayed/erroring cleanup, graceful/forced exit, unverifiable ownership, unrelated
process preservation, post-signal verification, private/off-mode evidence, and
revocation after cleanup failure. Existing tests cover interruption, durable slots
and stopping on source, evidence, coverage, lifecycle or cleanup failure. Their
passing result does not prove compatibility with receiver-dependent SDK methods.

The final sequential local pipeline passed: `pnpm typecheck`, `pnpm test`
(**89 suites**), `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, and
`pnpm test:local`. The browser matrix ran only after those checks. These HTTP/unit
passes supply no explanation for earlier C2 cold-start framework failures.

The fixed order remains passive → form → off; within each mode, Stagehand →
deterministic and rows → compact, with normal fixtures and zero injected delay.
The new fixed root is
`.sites-runtime/po-cart-workers/second-addition-repair-task-20261014/`.
Exclusive durable task creation and slot consumption preceded preview/fixture
creation; the CLI accepts no root override or resume option.

| First case: passive / Stagehand / rows | Saved observation |
| --- | --- |
| Failure | Launch/CDP connection; `before_addition`, separate from cleanup |
| Requests and additions | Zero mocked/real inference requests; zero attempts/results/additions |
| Cart and stock | Single original cart row retained; independent manager inventory/reservation comparisons match |
| Durable state | `review_needed`; unique account ownership and $250 fictional exposure retained |
| Network | Proxy observed 16 blocked background requests; external-page/checkout counters observed 0, with **incomplete page coverage** |
| Evidence | Eleven private diagnostic events; writer and parsed stream healthy; lifecycle complete |
| Case cleanup | Browser handle closed, proxy closure awaited, no CDP driver acquired; process verification passed |
| Credentials | Both new credentials revoked and independently returned HTTP 401 while the application preview was available |
| Preview cleanup | Runner reported `cleanup_failed`, with `investigationStatus: stopped` and `previewCleanupVerified: false` |

Independent final inspection subsequently verified ports 5181/5182 free and zero
new task browser/preview processes. It preserves the runner's failed shutdown
verification instead of rewriting it as success. Its exact verification failure
was not retained, so its cause is unestablished. Pre-existing browsers/workerd were
left untouched. The investigation satisfies neither real SDK compatibility nor a
trustworthy completed matrix; those completion criteria remain open.

## Preservation, rollback and handoff

Independent comparison preserved **10,454 protected artifact states**, **464
historical carts**, **35,083 historical database rows** and **35 historical gate
references** across six local databases. All historical business rows, holds,
attempts, results and reservations retain their fingerprints. Two `_cf_METADATA`
bookkeeping rows changed, one per application database. One
`sqlite_sequence.po_cart_worker_credential_events` counter advanced with the new
fixture credential events; its value matches the maximum event ID. These three
system/counter changes are excluded from the unchanged-row count. The standard
HTTP smoke also leaves its documented new fictional company in ordinary local D1.

Both real budget locations and consumed allowances retain their fingerprints;
real reserved exposure remains **$0.921518**. No new real reservation or request
occurred. The old diagnosis root, this consumed task record, fixture, cart,
reservation, holds, journal, profiles and evidence remain retained.

Private evidence includes `baseline.json`, `incoming-work.patch`,
`database-before.json`, `storefront-before.json`, `pipeline-final.json`,
`task.json`, `report.json`, `preservation.json`, `final-audit.json`, and
`cases/0/diagnostics.jsonl` under the new root. The final audit records independent
cleanup separately from the runner result. Private before-source snapshots support
restoring only this follow-up's source/test/documentation changes; remove only its
new files when rolling back. Preserve inherited dirty work and every runtime
artifact, consumed record, cart and hold. No migration rollback is needed.

The receiver defect affects the shared default browser helper, including ordinary
deterministic and human local-browser consumers. Their browser compatibility was
not re-proved by the unit/HTTP pipeline; source rollback or correction is needed
before using them. Nothing was deployed.

The next unblocked C4 source-only outcome is to restore the Playwright receiver,
add a receiver-sensitive connector regression, and improve preview teardown
failure evidence/exit handling. This task performs no post-stop repair. Any later
browser matrix needs a separately scoped, new allowance; neither this root nor
the prior root can resume. Original-timeout diagnosis, a fresh full acceptance
gate, paid validation, supplier access and retained-job recovery remain separate.
