# B6 Clover adapter — local evidence (2026-09-24)

**Scope:** B6's local, fake-backed adapter. No Clover account, sandbox merchant,
live order, remote migration, Worker deployment, supplier, or production data was
used. M5 remains open until B7's separately approved sandbox evidence exists.

## Contract and behavior

The owner chose to treat a fully paid Clover order as ingredients used, even
without a separate preparation record. The [M4 decision](decisions/0003-m4-sales-ingestion.md#b6-clover-paid-order-decision-owner-2026-09-24)
records this Clover-only policy. Payment time is the stock-cutoff time; a paid
order without that time is held for confirmation. Partial payment does not
consume. Initial sync considers only orders created at or after connection.

The adapter binds source company, sandbox environment, and merchant on the
server; it sends a redacted complete order revision to `pantrack.sales.v1`.
Native item/variation and modifier mappings are separate from existing CSV
mappings, so old mappings cannot silently authorize native deductions. Unknown
items or modifiers hold the whole sale. The M4 service handles duplicate
delivery, immutable applied events, positive revisions, and reviewed
corrections. Refunds and cancellations do not automatically restore stock.

Migration `0013_low_stick.sql` adds native mappings, sync state, and a unique
environment/merchant index on Clover connections. The existing connection
row and encrypted credential remain unchanged; the migration invents no
checkpoints or native mappings. A duplicate merchant already bound to two
companies makes the migration fail for review, rather than choosing one.

The owner-only Sync now route and Clover order webhook share the same bounded
polling path. Polling filters a fixed modified-time window, pages up to 2,000
orders, and advances its checkpoint only after all fetched events are durably
received. It overlaps subsequent scans by one hour. A provider or application
failure leaves the checkpoint unchanged and records a safe error. Clover's
`X-Clover-Auth` code and app/merchant binding are checked before webhook work.
The webhook body only triggers an authenticated order read; it is never used
as an inventory instruction. No background scheduler was provisioned in B6.

`PANTRACK_CLOVER_SYNC_ENABLED=enabled` is required to run sync and is also
limited in code to `CLOVER_ENVIRONMENT=sandbox`. The gate is absent from hosted
development secrets. The exact inventory preview remains off there.

## Checks

- `pnpm typecheck` — passed.
- `pnpm test` — passed, including the new B6 migration, adapter, and webhook
  fixtures. The focused fixture proved stock 10→9 for one paid sale, no second
  deduction from polling or repeated webhook, mapped modifier use, safe holds
  for unknown item/modifier, no refund restoration, unpaid cancellation as a
  no-op, a positive later revision, initial cutoff, and no
  checkpoint advancement after a fake provider outage.
- `pnpm db:check` — passed with 14 migrations; fresh D1-compatible SQLite
  schema matches the generated snapshot and journal.
- `pnpm build` — passed with the new Clover webhook route.
- `pnpm db:migrate:local` — applied `0013` successfully to the existing local
  development D1 database.
- `pnpm test:local` — passed the served local smoke test.

These checks use mocked Clover responses. They do not prove Clover's actual
field shapes, permission grants, webhook delivery, paging behavior, or sandbox
ingredient amounts. B7 must compare provider event IDs and expected versus
actual ingredient use in a fictional sandbox, including cancellation/revision
and missed-event recovery. Clover's documented filters, pagination, webhooks,
and single-use refresh/recovery behavior informed the adapter:
[orders](https://docs.clover.com/dev/reference/ordergetorders-3),
[filters](https://docs.clover.com/dev/docs/applying-filters),
[webhooks](https://docs.clover.com/dev/docs/webhooks), and
[refresh/recovery](https://docs.clover.com/dev/docs/refresh-access-tokens).

## Rollback and handoff

Keep the sync gate off to stop all new Clover reads immediately. An app rollback
does not undo `0013`; retain its additive tables and index, and use a new
forward migration for any schema repair. If an existing database has duplicate
merchant bindings, inspect and resolve them with the owner before applying
`0013`. Do not rewrite a used migration or delete historical sales and stock.

B7 needs a fictional Clover sandbox app/merchant, HTTPS OAuth callback and
webhook URL, Read Merchant, Read Inventory, Read Orders, and payment-time read
permission. Configure app ID, secret, encryption key, and webhook auth code in
server secrets, never in chat or Git. Only then enable the sandbox sync gate
for B7. The remote development D1 still has migrations through `0012`; its
Worker has not been redeployed with B6. Do not enable the new Worker code there
before applying `0013` to that development database.
