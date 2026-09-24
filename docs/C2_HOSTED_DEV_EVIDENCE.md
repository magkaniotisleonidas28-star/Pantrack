# C2 hosted development validation — 2026-09-24

This records one C2 validation slice against **development resources only**. It
does not complete the entire C2 checklist or authorize production use. The
deployed source was `main` at `6b6ac82`; the walkthrough used a fictional test
account, company, catalog item, recipe, and manual sales. No live POS, supplier,
payment, customer, or production data was involved.

## Target and preparation

- Cloudflare account: `46a94b92309dd488dadd02f6ae70e0ff`.
- Worker: `pantrack-dev` at
  `https://pantrack-dev.christospsimadas25.workers.dev`.
- D1 binding `DB`: `pantrack-dev-db`, database
  `9b50014b-f929-4f03-a187-599df6e438b1`.
- Before migration, D1 had migrations `0000`–`0011`, zero companies and users,
  zero sales events, and zero exact inventory events. `0012_tough_rage.sql` was
  the only pending migration. A D1 Time Travel bookmark was captured before the
  change: `00000005-00000000-000050f0-5acc9b27387b32b10b8fd70d4b965015`.
- `pnpm db:check` and `pnpm build` passed on the deployed source. The deploy
  dry run passed and showed the D1 and asset bindings. Inspection of the Worker
  bundle found no local `.dev.vars` or auth key material.

## Migration and Worker

`wrangler d1 migrations apply DB --remote` applied `0012_tough_rage.sql` (six
commands). A subsequent remote migration list reported no pending migrations.
The migration ledger contained `0012`, and D1 contained the three new
`sales_event_correction_*` tables and
`sales_event_occurrence_confirmations`.
`PRAGMA foreign_key_check` returned no rows after the walkthrough.

The Worker did not exist at preflight. Wrangler deployed it to the development
URL above (initial version `1e06e9d2-5f0f-4fcb-9246-3255a51e15f8`). Its
runtime received `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
an independently generated `AUTH_ENCRYPTION_KEY` through Wrangler secrets; no
secret values were printed or committed. Unauthenticated hosted requests
returned 200 for `/` and `/auth`, and 401 for `/api/companies` and
`/api/sales/events`.

## Fictional hosted walkthrough

The owner signed in through the hosted Supabase form in Safari. The hosted app
created one fictional company and seeded 12 sample products. With the exact
inventory preview temporarily enabled on this development Worker, the
walkthrough classified a sample hot cup as an individual unit, recorded a fresh
opening count of **10**, and activated a recipe consuming **one** cup per sale.

The first manual sale, `HOSTED-DEV-20260924-01`, used an occurrence time just
before recipe activation. It was safely held with `recipe_version_not_found` and
made no stock change. A second manual sale, `HOSTED-DEV-20260924-02`, occurred
after activation and applied, changing exact on-hand stock from **10 to 9**.
Repeating the second sale with the same reference, time, and quantity returned
an already-recorded message and left stock at **9**. Remote D1 confirmed two
sales events (one applied, one held), one inventory consumption application,
and exact balance `9`. The held fictional event remains in the review queue as
an identifiable test artifact.

After the walkthrough, `PANTRACK_EXACT_INVENTORY_PREVIEW` was **deleted** from
the development Worker secrets. A final secret-name list contained only the
four auth/origin names above, and a hosted page reload showed the ordinary
inventory screen. The exact preview is off.

## Scope and follow-up

This is direct evidence for development D1 migration, Worker boot, hosted
sign-in, fictional exact inventory consumption, held-sale safety, duplicate
protection, and disabling the preview. It does not prove hosted cross-company
or forbidden-role behavior, signup/recovery callbacks, native Clover delivery,
supplier integration, or production readiness. Local authorization and
concurrency evidence remains in [B5 local evidence](M4_B5_LOCAL_EVIDENCE.md).
The owner's reported M2 authentication/migration review still needs a separate
written C2 record before marking C2 complete.

The D1 migration is additive; do not rewrite it or assume an app rollback
undoes it. If the development Worker must be reverted, use Cloudflare Worker
version rollback and keep the preview disabled. If D1 needs repair, inspect
the ledger and schema first, then use a new forward migration. The captured
Time Travel bookmark is a recovery reference, not an instruction to restore
or discard the fictional walkthrough data.
