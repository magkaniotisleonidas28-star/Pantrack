# C4 connector binding and preview teardown: source-only repair

Date: 2026-10-14. This source-only outcome is locally verified. **Real browser
compatibility, the original timeout and C4/M8 acceptance remain unverified.**

The prior [runner investigation](C4_SECOND_ADDITION_REPAIR_20261014.md) stopped
before CDP connection because its default Playwright method lost its receiver.
This task corrects that implementation error and improves preview shutdown
verification. It creates no browser job or allowance and does not resume either
consumed investigation. Their failed reports and eleven unused slots each remain
unchanged, along with all retained carts, profiles, reservations and holds.

## Changes and contracts

The [shared helper](../scripts/cart-preview/browser-session.ts) calls the default
Playwright connector through `chromium.connectOverCDP(...)`, preserving its
receiver. The adjacent Stagehand launcher uses the same wrapper pattern. Injected
test hooks remain supported, and launch options, browser settings, interception,
Metadata prompt, completion guard and timeouts are unchanged. This corrects the
shared path used by deterministic, AI-reader and human local-browser consumers;
none received a new real-browser walkthrough here.

The [cleanup helper](../scripts/po-cart-worker/second-addition-cleanup.mjs) observes
the captured child process's `exit` event as the authoritative exit signal. It no
longer requires a command fingerprint to remain unchanged while a preview exits.
Before each signal it verifies the live leader's PID, parent, identity and detached
process group. Zombie/missing leaders receive no escalation. It observes exit for
five seconds after SIGTERM and another five seconds after an eligible escalation,
including when the escalation fails. Descendants may finish within that observation
budget; an orphaned group is reported as incomplete and never adopted for signaling.
Unparseable process observations fail closed.

Child exit, process-group clearance and port availability are separate report
fields. The [runner](../scripts/po-cart-second-addition-check.mjs) retains its
original `investigationStatus` and case failure when cleanup also fails.
`processesStopped` reflects child/group verification; `previewCleanupVerified`
additionally requires free ports and no cleanup failures. Fixed categories are
`ownership_unverified`, `signal_failed`, `exit_timeout`, `group_remaining`,
`port_occupied`, `observation_failed` and `spawn_error`. Reports project only fixed
fields and categories; raw errors, commands and process identities are not saved.
Credential revocation remains independent of cleanup success.

Only internal script interfaces changed. There is no public API, database schema,
migration, supplier integration or purchasing behavior change. No live supplier,
paid inference, deployment, checkout or retained-job recovery occurred.

## Verification

The [connector regression](../tests/po-cart-connector-binding.mjs) exercises the
default path through the installed Playwright method with its channel stubbed
before network access. It checks the launcher receiver too. A separate check of
the saved before-source reproduced the original receiver error with a mocked
launcher: zero browser jobs and zero CDP channel dispatches. The corrected test
reaches the stubbed channel and verifies browser-handle/proxy cleanup. It does
not replace the receiver-dependent method with a standalone mock.

The [preview regressions](../tests/po-cart-preview-cleanup.mjs) use mocked child
processes and controls. They cover normal/forced exit, zombie command changes,
delayed exit events, PID reuse, unverifiable ownership, signal/observation errors,
timeouts, delayed/surviving descendants, already observed exit and spawn failure.
They assert post-exit verification, no signals to unrelated processes or adopted
descendants, separate occupied-port reporting, preservation of the original
failure, bounded private projections and revocation after cleanup failure. The
previous preview test was moved into this expanded focused suite; existing browser
ownership, partial-launch, network, diagnostic and investigation coverage remains.

Focused connector, preview, browser-network, provider-diagnostic, preflight and
second-addition suites passed. The complete sequential local pipeline passed:
`pnpm typecheck`, `pnpm test` (**91 suites**), `pnpm db:check`, `pnpm build`,
`pnpm db:migrate:local` and `pnpm test:local`. A read-only local process observation
also parsed successfully. Documentation links and `git diff --check` passed.

Frozen source: **538 files**, SHA-256
`a2879a60f579e4499f28abc257aba2e1ab700bf6e1c573ca164f81a4f37e7ccf`.
All six pipeline steps and the final source audit use this fingerprint.

These checks prove the binding correction and modeled cleanup behavior. They do
not establish the cause of the earlier preview verification failure, real browser
startup/reliability, or a cause for the original second-addition timeout. No full
21-step gate, browser probe or matrix ran. Earlier C2 cold-start failures retain
their separate evidence and limits.

## Preservation and handoff

The fresh baseline preserves all 17 incoming dirty files. Independent comparison
verified **10,518 protected artifact states**, **465 historical carts**, **35,148
historical database rows** and **35 historical gate references** across six local
databases. Historical business rows, holds, attempts, results and reservations
retain their hashes. One ordinary-local `_cf_METADATA` bookkeeping row changed;
it is excluded from the unchanged-row count. No credential-event sequence counter
changed. The standard HTTP smoke leaves its documented new fictional local company.

Both real budget locations and consumed allowances retain their fingerprints;
real reserved exposure remains **$0.921518**. No credential was issued or browser
fixture provisioned by this task. The two consumed diagnosis roots and their
failed reports were not rewritten. No new execution allowance was created.

Private evidence is under
`.sites-runtime/po-cart-workers/connector-source-repair-20261014/`: source snapshots,
`baseline.json`, `database-before.json`, `storefront-before.json`,
`binding-before.json`, `pipeline-final.json`, `preservation.json`,
`documentation-check.json`, `final-audit.json` and `rollback-manifest.json`.
Rollback restores only this task's changed existing files from `source-before/`
and removes only its two new tests and this evidence document. Preserve inherited
dirty work, every runtime artifact and consumed record. No migration rollback is
needed; source rollback reinstates the known connector defect and invalidates the
new verification fingerprint.

The next unblocked C4 step is to propose a separately bounded real local-browser
compatibility/investigation allowance. Neither existing root can resume. A full
fresh acceptance gate, paid validation, supplier access, checkout and retained-job
recovery remain separate decisions. C4/M8 stay unchecked.
