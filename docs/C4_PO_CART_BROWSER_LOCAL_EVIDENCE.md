# C4 local browser worker evidence

Date: 2026-10-10. Workstream **C4**, one reviewable outcome: a separate Node 22
browser consumer prepares the fictional storefront through authenticated application
HTTP. D1 owns jobs, leases, attempts, results and final verification. This is offline
local evidence. C4/M8 remain unchecked; no deployment, model call, Browserbase,
Render, supplier account, purchase or inventory write is authorized or enabled.

## Durable contracts

Additive `0031_po_cart_local_browser.sql` adds immutable consumer kind, immutable
optional job browser configuration and append-only baseline/final observations.
Existing identities default to `fake`; rotation preserves kind and identity.
Omitted browser configuration retains fake behavior. Authentication determines kind;
headers cannot select it. Candidate reads and every committing batch enforce kind
alongside company/supplier/account, current credentials, permissions and sources.

The existing worker endpoint adds UUID- and fence-bound `recordBaseline`,
`finalizeCart` and bounded `hold` operations. Its strict schemas, streamed 32 KiB
limit, private/no-store responses, loopback/default-off gates and transaction-time
lease checks remain. Browser projections add configuration, account scope and
verification summaries. They contain no cookies, private session/control URLs,
profiles or full cart observations. Manager status retains immutable evidence.

A duplicate baseline SKU or a requested SKU already present holds before additions.
Every browser attempt requires a verified baseline. Verified line results leave
browser jobs `preparing`; only explicit final verification can make them `ready`.
The server checks every requested SKU, exact pack/price/quantity, unchanged unrelated
baseline items, no duplicates/unexpected items, and the **complete cart** total
against the authorized cap. Thus unrelated baseline items also consume that cap.
Invalid final observations persist as rejected evidence and hold the job.

## Browser execution and privacy

The adapter reuses the authenticated client's private fsynced journal, serialized
mutations, three retries, 60-second leases and 20-second heartbeat timer. The echo
fake adapter remains compatible. Reusable deterministic browser/session helpers
were extracted from the original preview; new application jobs never enter its
file-backed job state machine. The dedicated storefront persists fixture carts only.

After a claim, the browser uses a private persistent profile keyed by storefront,
company, supplier and account. A fixed account-profile process lock remains effective
when the application lease expires. Stale-lock reclamation is serialized; an orphaned
reclamation guard requires local review. Chromium's own profile lock additionally
prevents reuse of an active orphaned browser after a hard process kill.

Installed Stagehand 4.1.0 owns browser lifecycle; Playwright 1.61.1 performs deterministic
DOM reads and form operations. No model is invoked. An independent HTTP proxy and
request interception restrict traffic to known paths on the configured loopback
storefront. Checkout, other origins, tunnels and redirects outside those paths are
blocked. Upstream interruption closes the proxy response and browser response waits
are bounded.

Each line is independently matched to one exact available product. A fresh begin
acknowledgement and current matching ownership precede one addition; the product is
rechecked, then the cart is reread. Exact observed results are journaled before
publication. Additions are never retried. Lost begin replies, interrupted additions
and unknown outcomes retain uncertainty and exposure. Restart may replay known HTTP
results, but cannot reuse a saved browser-call grant or restart attempted browser
work. Known baseline observations are retained privately for safe pre-attempt recovery;
a new process without that evidence holds rather than replacing the durable baseline.

A fresh complete cart observation goes to `finalizeCart`. Automation closes the
browser on completion or handled failure, preserving profiles and private evidence.
Expired practice sign-in creates a `sign_in_required` hold; there is no automatic
login or interactive resume. Cancellation cannot undo an issued addition and prevents
later results, further additions and readiness. SIGINT/SIGTERM stop automation;
hard-kill uncertainty remains subject to explicit reconciliation and lease recovery.

## Local commands

The ordinary `pnpm dev:cart` preview remains separate. Start the dedicated,
default-off local profile, then run served-D1 acceptance in another terminal:

```sh
pnpm dev:cart-browser-worker
pnpm cart:browser-worker:check:http
```

For a private manual fixture, seed the reviewed PO, exact permission, browser job,
two browser credentials and fixture session. The command prints paths and the worker
command; it never prints session tokens or credentials:

```sh
pnpm cart:browser-worker:seed --layout rows --scenario normal
pnpm cart:browser-worker --credential PRIVATE_CREDENTIAL_FILE --journal PRIVATE_JOURNAL_FILE --fixture PRIVATE_SESSION_FILE --once
```

Use `--visible` to observe the fictional browser. Files remain under ignored
`.sites-runtime/po-cart-workers`, with 0600 files and 0700 profiles/directories on
POSIX; Windows relies on the current account ACL. Raw credentials/session material
never enter worker arguments, API responses or captured worker output. The seed
uses only the isolated local placeholder D1 binding. Issue/revoke/rotation remain
local fixture administration; served acceptance revokes its credentials afterward.

The independent real-browser process acceptance command is:

```sh
pnpm cart:browser-worker:check
```

Browser acceptance requires installed Chromium and is separate from the normal
Node-only test pipeline, preserving CI's existing browser-install assumptions.

## Verification

The complete current-worktree pipeline passed, including **68 test suites**:

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
```

Acceptance and regressions passed:

- All three new operations reject anonymous, wrong-company/account, wrong-worker,
  stale-lease and forged-kind access. Commit-time revocation, expiry, identity-version,
  source/pause, membership removal and cancellation roll back subsequent writes.
  Manager browser enqueue retains owner/manager, employee denial, company and CSRF
  coverage. Fake credentials cannot consume browser jobs or bypass final verification.
- Exact final-cart negative cases cover missing/requested/duplicate/unexpected SKUs,
  changed baseline, price, pack, quantity and cap. Configuration, kind and evidence
  are immutable. Browser credential rotation retains identity/kind/receipts.
- `pnpm cart:browser-worker:check` passed 36 local real-browser cases: both layouts
  across all eight scenarios, competing claims, lost acknowledgements, pre-attempt
  recovery, lost begin grants, known/unknown crash outcomes, baseline/cart changes,
  revoked/source/canceled/expired authority, a live account lock after lease expiry,
  final changes after all line results, cancellation after an issued addition and
  a hard kill after the storefront changed but before the response was known.
  No line was added twice; uncertainty and exposure were retained.
- `pnpm cart:browser-worker:check:http` passed seven served-D1 cases: competing processes, both layouts in normal/malicious cases,
  lost baseline/result/finalization replies, lost begin with zero additions,
  expired sign-in and interrupted addition holds. Inventory/incoming and active
  quantity/spending reservations remain unchanged.
- Fresh local D1 applied all 32 migrations, with nine new browser triggers and no
  foreign-key violations. Wrangler-split populated upgrade preserved every existing
  column/row across 99 tables, including ready fake jobs, credentials and receipts.
  Generated schema, snapshot and journal match; prior migrations are unchanged.
- Typecheck, schema check, build, local migration apply, local HTTP smoke, existing
  manager job/authorization HTTP checks, fake-worker served-D1 checks and all 16
  original offline browser scenarios passed in this worktree. `pnpm cart:check`,
  `pnpm cart:check:http`, `pnpm cart:worker:check:http`,
  `node scripts/po-cart-jobs-http-check.mjs` and
  `node scripts/po-cart-authorization-http-check.mjs` passed.
- `pnpm exec openspec validate --all --strict` passed all nine existing changes.
  `git diff --check`, relative documentation links and privacy/scope review passed.
  The ordinary profile returned private/no-store `404` for worker transport. Local
  preview processes and orphaned fictional test browsers were stopped; private
  profiles/evidence remain, and manual/served fixture credentials were revoked.

## Rollback and handoff

Disable worker transport and stop browser workers. Restart the ordinary local
profile to restore its default-off transport configuration. Preserve jobs,
credentials, cart ownership, immutable evidence, receipts, journals, profiles and
unresolved commitments/exposure. End any browser left by a hard kill before private
profile recovery; never treat lease expiry as permission to reuse an active profile.
Do not delete or rewrite used migrations. Any schema correction uses a later
additive migration; rejected/unknown outcomes stay held for explicit reconciliation.

No A/B domain writer or manager UI changed. Shared schema, package and status edits
belong to this C4 contract. Next unblocked slice: connect manager Prepare/status
controls and practice sign-in/review to the durable workflow. Hosting, real mappings,
financial policy, permitted supplier access, AI evaluation, confirmation/receiving
and external/pilot acceptance remain separate gates. See the
[integration roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md) and
[previous transport evidence](C4_PO_CART_WORKER_LOCAL_EVIDENCE.md).
