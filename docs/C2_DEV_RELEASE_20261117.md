# Development release of `ac8de80` — 2026-11-17

**Authorization:** the owner asked to "put the most up to date version of
pantrack on the cloudflare workers website", then answered "I authorize the
online release now". The owner confirmed that the hosted app still holds only
test data and that 10–15 minutes of downtime was acceptable. The owner signed
this Mac in to Cloudflare (`wrangler login`); no credential was handled in
chat.

**Scope:**
- application `ac8de80f7284858c925c05960b96e52eff823114` (`main`, all GitHub
  checks passed);
- migrations `0024`–`0052` applied to `pantrack-dev-db`.

Clover sync, purchasing and schedules stay disabled. Photo waste suggestions
are off, with no reader or OpenAI secret online. No supplier, POS, paid model
or purchase was contacted. Private artifacts (exports, logs and the restored
databases) are in Git-ignored `.sites-runtime/c2-release-20261117/`, mode
0700/0600.

## Before (read-only)

| Item | Observed |
| --- | --- |
| Worker | `pantrack-dev`, account `46a94b92…`, active version `ed5e9c65-31b7-432f-bff9-bf4df45e9b68` (release `65373b3`, 2026-10-05), 100% |
| Ledger | 24 entries, `0000`–`0023`, matching the repository's first 24 in order |
| Pending | 29 migrations, `0024_supplier_simulation` … `0052_waste_photo_settings` |
| Secrets (names only) | the expected nine, unchanged |
| Schedules | none |
| Data | 5 companies, 61 products, 5 exact balances, 14 sales states, none processing, 1 Clover sandbox connection |

All read-only queries reported `changed_db: false`.

## Backup and rehearsal

- **Backup:** `d1 export --remote` produced 260,934 bytes, SHA-256
  `8a4eeb52…9e47553`, with 66 tables. Time Travel bookmark:
  `0000009b-00000000-00005126-b7f325e8bdba9a0629d9c5aeafb9098a`.
- **Restoring the copy:** the export lists one child table's rows before its
  parent `auth_users` table. Wrangler's local import therefore stops with "no
  such table: main.auth_users" when foreign keys are enforced. The copy was
  restored with foreign keys off, then checked: integrity ok, no foreign-key
  problems, 66 tables and 476 rows.
- **Rehearsal:** `d1 migrations apply --local` on that copy applied all 29
  migrations. The result:
  - all 452 original application records were unchanged; only the ledger grew;
  - the ledger had 53 entries in repository order;
  - the schema was identical to a fresh database built from all 53 migrations
    (446 of 446 objects, 0 differences);
  - integrity and foreign-key checks passed;
  - all 63 new tables were empty.
- **Frozen candidate:** `pnpm build` produced 310 files with a recorded
  SHA-256 manifest. Its config targets `pantrack-dev` and `pantrack-dev-db`,
  with the preview enabled, Clover sync disabled and no triggers. A scan found
  no local test sign-in, local variables or key-like strings. The loopback
  origins it contains are the code's own development allowance in
  `src/lib/auth.ts`.

## Cutover

All times UTC.

| Step | Result |
| --- | --- |
| 1. Upload candidate (not active) | Version `44b1afb1-653d-469e-865a-6a3c77904199`. Bindings: D1 `pantrack-dev-db`, assets, preview enabled, Clover sync disabled, and the nine secrets kept. The old version stayed at 100%; the candidate's preview URL was not visited. |
| 2. Maintenance | Version `c338e098-d11b-4f7c-9db1-79fe4ce58f1e` activated at 01:53:30. App, API, Clover webhook and register ingestion returned 503 with `Retry-After: 300` and `no-store`. One early request returned 405 from the old version during propagation; repeated checks were all 503. |
| 3. Cutover backup | Byte-identical to the rehearsed backup (same SHA-256). No sales were processing. Bookmark `0000009d-00000000-00005126-919d741821465d492623e531ab287d5d`. |
| 4. Migrations | `d1 migrations apply --remote` applied `0024`–`0052`, all ✅, exit 0. |
| 5. Verify | A fresh export (411,495 bytes) restored locally: all 452 original records unchanged; 53 ledger entries in order; schema identical to fresh (446 of 446, 0 differences); integrity and foreign-key checks passed; all 63 new tables empty. |
| 6. Activate | Candidate `44b1afb1` at 100% at 01:54:53. Maintenance lasted about 1.5 minutes. |
| 7. Hosted checks | Home 200; `/auth`, `/invite` and `/auth/signout` 200; the test sign-in fixture 404; anonymous and forged-header API requests 401; deployment status 100% on `44b1afb1`; ledger 53; photo switch rows 0; cart jobs 0. |

## Not covered

- The owner's normal sign-in and review of retained data (pending at writing).
- Fictional hosted write walkthroughs (inventory, recipes, units, waste), A8
  online acceptance and C4/C5 workflow acceptance. HTTP status alone closes none
  of them.
- Signup and password-recovery email on the hosted app.

## Rollback

- Activating `ed5e9c65` is not safe: after `0034`, the old runtime cannot safely
  run sales ingestion.
- Recovery is forward repair, or a separately authorized Time Travel restore
  to the bookmarks above, which would discard later writes.
