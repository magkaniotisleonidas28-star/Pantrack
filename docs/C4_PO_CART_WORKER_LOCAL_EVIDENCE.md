# C4 authenticated local worker transport evidence

Date: 2026-10-09. Workstream **C4**, one bounded outcome: separate Node 22 fake
workers consume durable preparation jobs over authenticated loopback HTTP without
D1 access. This is local fictional evidence only. C4/M8 and supplier purchasing
remain open; no deployment, paid service, model, supplier access or order occurred.

## Behavior and contracts

- Additive `0030_po_cart_worker_transport.sql` adds immutable company/supplier/account
  worker identities, unique SHA-256 credential hashes and append-only credential
  audit. Generated schema/snapshot/journal match; migrations through 0029 are preserved.
- Local fixtures generate 256 random bits, store raw credentials only under ignored
  `.sites-runtime/po-cart-workers`, and default to one-hour expiry. Files use mode
  0600 and created directories 0700 on POSIX; Windows uses the local account ACL.
  Issue/revoke audit is automatic; rotation records an additional event and preserves
  identity, ownership and permanent operation receipts. There is no credential API/UI.
- `/api/internal/po-cart-worker` requires both `PANTRACK_CART_PREVIEW=enabled` and
  `PANTRACK_CART_WORKER_TRANSPORT=enabled`, and hostname `127.0.0.1`. Local servers
  bind to loopback. The transport gate is absent/off in normal and hosted configuration.
  Bearer authentication is independent of manager sessions. Browser Origin/Fetch
  Metadata and preflight are rejected, with no CORS access grant.
- GET accepts only optional `jobId`, returning current scoped worker status or a
  queued/expired candidate (null means idle). POST accepts only claim, heartbeat,
  beginAttempt, recordResult and recoverExpired with UUID and fence requirements.
  Company/worker/supplier/account are derived, never caller-supplied. JSON bodies
  are byte-limited to 32 KiB including streamed UTF-8 input.
- Explicit projections expose job ID/state/revision/validity, ownership/lease/fence,
  authorized lines, currency/cap and attempt/result summaries. They exclude full PO
  snapshots, notes, membership data, credentials, arbitrary observations and full audit.
  Success/error responses use private/no-store; 401, 404, 409 and 503 distinguish
  credential failure, unavailable scope/resource, conflicts and temporary failures.
- The existing job service now accepts trusted worker access resolved by the server.
  Current credential status/expiry/identity version and exact job scope are predicates
  inside every committing batch. Read/replay paths reauthenticate, including after
  status assembly. Existing manager APIs and authorization/source/fencing guards remain.
- The Node client receives a credential-file path and communicates only with loopback
  HTTP, with redirects disabled. It has no D1 binding or database credential. Mutations
  serialize; leases remain 60 seconds, with heartbeat every 20 seconds during processing.
  Private fsynced atomic journal updates precede operation transmission and save known
  fake outcomes before result publication. A process lock prevents concurrent use of
  one journal. Network/temporary errors retry at most three times with the same UUID.
- Only a fresh matching begin acknowledgement, `providerCallAllowed=true` and current
  matching ownership permit a fake call. Retried/resumed begins never permit a call.
  Restart safely republishes known outcomes and holds unknown attempted writes. Expired
  never-attempted work alone can requeue. Started/uncertain/canceled work retains its
  cart, quantity commitments and exposure; late results cannot revive canceled work.

## Local commands

The self-contained acceptance command seeds fictional SQLite behind the actual
route implementation and starts separate HTTP-only Node worker processes:

```sh
pnpm cart:worker:check
```

For the served local D1 acceptance, start the explicitly enabled local profile in
one terminal, then run the check in another. It creates its own fictional company,
permission and job, privately issues credentials, starts two workers, and tests
rotation/revocation. Credentials are revoked when the check completes.

```sh
pnpm dev:cart-worker
pnpm cart:worker:check:http
```

For private manual fixtures against that isolated preview database:

```sh
pnpm cart:worker:credential issue .sites-runtime/po-cart-workers/demo.json FICTIONAL_COMPANY_ID
pnpm cart:worker --credential .sites-runtime/po-cart-workers/demo.json --journal .sites-runtime/po-cart-workers/demo-journal.json
pnpm cart:worker:credential rotate .sites-runtime/po-cart-workers/demo.json
pnpm cart:worker:credential revoke .sites-runtime/po-cart-workers/demo.json
```

Pass paths only; never pass a raw token in arguments or print credential/journal
contents. These commands use local placeholder D1 and no remote flags. Ordinary
`pnpm dev:cart` preserves the independent browser preview with worker transport off.

## Verification

- Missing/invalid/expired/revoked credentials, cookies/forged identities, wrong
  company/supplier/account, strict intent/query, duplicate query keys, loopback and
  default-off gates, streamed byte limits, private projections and uncached failures.
- Commit-time revocation rollback for **all five** mutations with real stock/incoming
  and active quantity/budget holds unchanged. Transaction-time expiry and identity
  version changes also reject commits. Revoked credentials cannot read/replay history.
- Concurrent duplicate begin requests return one call grant. Rotation retains the
  worker identity/receipt; stale workers, conflicting operations and canceled late
  results cannot commit. Existing source/pause and manager authorization tests pass.
- Separate processes prove competing claims, delayed claim replies, lost begin/result
  acknowledgements, UUID-preserving bounded retries, pending-claim restart, crash with
  unknown outcome, crash with known outcome, expired never-attempted/attempted recovery,
  and a real 20-second heartbeat during a 21-second fake operation. At most one fake
  call/attempt/result per line. Fake processing leaves stock/incoming/reservations intact.
- Populated upgrade preserves every row in 96 existing tables, including started
  authorization, job attempts and receipts. Wrangler statement splitting applies all
  11 new triggers; immutable scope/credential/audit rules and foreign keys pass.
  Fresh local D1 applies all 31 migrations and has 11 worker triggers with no foreign-key
  violations. Schema checker reports 99 application tables.
- `pnpm typecheck`, `pnpm test` (65 suites), `pnpm db:check`, `pnpm build`,
  `pnpm db:migrate:local`, `pnpm test:local` passed in this worktree.
- `pnpm cart:worker:check:http`, `node scripts/po-cart-jobs-http-check.mjs`,
  `node scripts/po-cart-authorization-http-check.mjs`, `pnpm cart:check:http` and
  `pnpm cart:check` (all 16 offline browser scenarios) passed.
- `pnpm exec openspec validate --all --strict`, `git diff --check` and changed relative
  links passed. Private fixtures/runtime logs stay ignored; secrets are excluded from
  worker arguments, responses and captured worker output.

## Rollback and next handoff

Disable `PANTRACK_CART_WORKER_TRANSPORT` and stop local workers. Retain credentials,
audit, jobs, receipts, journals, cart ownership and unresolved quantity/budget holds.
Do not delete used migrations or reset retained data. Schema repair uses a later
additive migration. Unknown outcomes remain held for explicit reconciliation.

Next unblocked C4 outcome: connect the fictional browser consumer to this tested
transport. Browser/session integration, hosting, owner credential management, real
mappings/financial policy, supplier permission, confirmation/receiving and pilot
acceptance remain separate. Inventory/proposal ownership stays with A; no A/B source
module or stock/incoming writer changed. Shared schema/package/status changes are
limited to this C4 transport handoff.
