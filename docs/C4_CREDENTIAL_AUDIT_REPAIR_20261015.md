# C4 credential-audit idempotency repair

Date: 2026-10-15. Workstream **C4**, one source-only cleanup repair.
**C4/M8 remain open.** The [failed full gate](C4_FULL_OFFLINE_GATE_20261014.md),
its consumed invocation, partial cart, unresolved attempt, held ownership and
25,000-minor-unit fictional reservation remain historical evidence.

## Contract and behavior

The final audit previously attempted to update already-revoked credentials. The
existing database trigger correctly rejected those terminal transitions. The
cleanup loop also skipped HTTP verification if SQL execution threw.

The focused internal [credential audit helper](../scripts/po-cart-worker/credential-audit.mjs)
now requires the captured credential ID, worker ID **and `status='active'`** for
revocation. Successful SQL execution with no matching active row is safe: already
revoked rows retain their timestamp and events, and credentials captured before a
failed insert have no row to update. Each credential must independently pass SQL
execution and HTTP 401. A SQL exception or unsuccessful command does not suppress
its HTTP check; either failure still allows the remaining credentials to be cleaned
up and checked.

The [gate runner](../scripts/po-cart-ai-gate.mjs) supplies the existing local Wrangler
execution. Report fields remain `passed`, `count`, and `results`, with only
`credentialId`, `revoked`, and HTTP `status` per result. `revoked` continues to
mean successful SQL execution, including a safe no-op. Secrets and raw errors are
excluded. The HTTP timeout remains 10,000 ms. There is no public API, schema,
migration, browser behavior, prompt or timeout change.

## Local verification

Node 22.23.2 and pnpm 11.25.0 were used in the current worktree. Before the repair,
the existing full-gate, worker API, preflight and preview-cleanup suites passed
(four suites). The new [non-browser regression](../tests/po-cart-credential-audit.mjs)
uses the existing fully migrated SQLite fixture and a loopback HTTP server that
forwards bearer headers to the real worker authorization route. It proves:

- The old SQL is rejected against an already-revoked credential.
- Active credentials revoke once; repeated cleanup preserves timestamps and events.
- Captured-but-never-inserted credentials safely return 401 without creating rows.
- Both IDs constrain cleanup, including quoted identifiers; unrelated credentials
  and another credential belonging to the same worker remain unchanged.
- SQL exceptions/unsuccessful execution, HTTP exceptions/disconnects, non-401
  responses and mixed batches fail the audit while later SQL/HTTP checks continue.
- Reports contain no bearer secrets or raw errors; foreign-key checks remain clean.

`pnpm test:focused po-cart-credential-audit po-cart-full-offline-gate
po-cart-worker-api po-cart-worker-guards po-cart-worker-client
po-cart-evaluation-preflight po-cart-preview-cleanup` passed all seven suites.
The six preparation commands then passed sequentially on the same source:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **94 suites** |
| `pnpm db:check` | Passed, 35 ordered migrations and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no pending local migrations |
| `pnpm test:local` | Passed, ordinary fictional loopback HTTP smoke |

The repaired source fingerprint is **545 files**, SHA-256
`3c238d1d14a9f04c2773e8774892673f740ae5e0a5bacce3c13e1fe8112d64b1`.
This is a preparation fingerprint, not a new gate freeze. The retained failed
gate's 543-file freeze and reports remain untouched and do not validate this
changed source. No browser job, held-job replay, real inference, supplier access,
checkout, display-setting change or deployment occurred. This repair creates
or consumes no execution allowance.

## Preservation and private evidence

Evidence and source-only rollback snapshots are separate from the consumed gate,
under `.sites-runtime/po-cart-workers/credential-audit-source-repair-20261014/`.
The folder was created before editing; its name retains the October 14 task date
across midnight. It contains `source-before/`, `source-before.json`,
`incoming-work.patch`, `incoming-status.txt`, `rollback-manifest.json`, baseline
artifact/cart/database fingerprints, focused logs, the six command logs and
`pipeline-final.json`, `screen-off-correlation.json`, `audit.py`,
`database-delta.json` and `preservation.json`. Private files use mode 0600 and
directories use 0700.

The read-only preservation audit passed for **12,509 protected artifacts**, all
**482 historical carts**, and all **36,396 baseline business rows** across six
local databases. The failed gate remains `passed: false`, `status: audit_failed`,
with two consumed steps, nineteen unrun steps and all **104 evidence references**
unchanged. Its partial cart, held account and reservation remain unchanged.
Both real budget fingerprints and historical consumed records are preserved;
real reserved exposure remains **$0.921518**.

The preparation smoke added **16 ordinary fictional business rows** only in the
ordinary local database. One Cloudflare bookkeeping row state changed; those
changes are recorded separately in `database-delta.json`. There are no new
served-cart business rows and no historical business row changes. `git diff
--check` and all **229 relative file/section links** in the four changed documents
passed. All inherited source outside the declared repair files is unchanged.

## Screen-off observation

The read-only macOS power log records the display turning off on October 14 at
**11:07:56 PM EDT**. The retained failed reliability journal was saved at
**11:08:12 PM EDT**, about sixteen seconds later. No system sleep event is recorded
during the gate's **11:04:06–11:08:20 PM EDT** interval. These observations establish
temporal correlation only; **causality is unresolved**. Neither the original
timeout nor the second-addition failure has a causal fix from this repair.

## Rollback and next handoff

Use this repair folder's `rollback-manifest.json`: restore only its `restore`
files from `source-before/` and remove only its `remove` files. This restores the
inherited dirty work without reverting earlier repairs. Preserve every runtime
artifact, consumed record, credential event, cart, reservation and hold. No
migration rollback is needed. Source rollback invalidates this verification
fingerprint and grants no new execution allowance.

The next separately scoped task is controlled browser investigation or a fresh
complete acceptance gate on reviewed source. Neither is authorized here. Paid
execution remains blocked; local preparation does not prove hosted, supplier,
pilot, production or real-model acceptance. No milestone checkbox advances.
