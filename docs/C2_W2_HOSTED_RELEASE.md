# C2 — W1/W2 hosted development release

Date: 2026-10-01. Outcome: deploy the reviewed Waste, recipe/stock builder and
purchase-measurement improvements through `d84078e` to the existing development
website. Public release, real-worker acceptance and pilot approval remain separate.

## Release and target

- Source: `05d71ed`, containing latest remote `main` (`887546e`), all changes
  through `d84078e`, and the development runtime-gate configuration.
- Worker: `pantrack-dev`,
  <https://pantrack-dev.christospsimadas25.workers.dev>.
- Account: `46a94b92309dd488dadd02f6ae70e0ff`.
- D1: `pantrack-dev-db`, `9b50014b-f929-4f03-a187-599df6e438b1`.
- Previous Worker: `5c214014-0b7e-460e-8aea-86bcdbeec095`, with both preview
  and Clover sync gates absent (disabled).
- Deployed Worker: `1d1b22e4-fc01-4cce-819d-46d0115b259b`, tagged
  `c2-w2-05d71ed`.
- Checked-in `wrangler.jsonc` now sets
  `PANTRACK_EXACT_INVENTORY_PREVIEW=enabled` and
  `PANTRACK_CLOVER_SYNC_ENABLED=disabled`. All nine original secret-binding
  names remain present; deployment used `--keep-vars` and supplied no secrets.
  Supplier submission remains blocked unconditionally on the server, automatic
  purchasing stays disabled, and no schedules or queues were provisioned.
- Cloudflare's development Worker Settings → Builds showed the GitHub/GitLab/
  Origin connection choices, with no connected repository. There were no cron
  triggers or queue consumers. The separate coming-soon site was unchanged.

## Database protection and migration evidence

Before changing D1, the migration ledger contained `0000`–`0015`; exactly
`0016`–`0021` were pending. A full SQL export and Worker metadata were saved in
private Git-ignored `.sites-runtime/c2-w2-release-20261001/`. The directory is
mode 700 and SQL exports are mode 600. The pre-release backup SHA-256 is
`d6752d25db1e1230b1e3248df6ab57beb5f933383b4534b1a240d1275237373b`.
The backup was loaded into SQLite and checked before remote mutation; applying
all six unchanged migrations to its copy preserved every original table row
and column. No local practice database was copied to the development binding.

| Migration | Scope and remote result |
| --- | --- |
| `0016_light_hedge_knight.sql` | Add immutable proposal origins; normal remote migration apply passed. |
| `0017_confused_electro.sql` | Add proposal state/history and transition guards; normal apply failed with `incomplete input: SQLITE_ERROR`; unchanged SQL file import passed. |
| `0018_w1_quick_waste.sql` | Add waste shortcuts and nullable event reason; unchanged SQL file import passed. |
| `0019_w2_menu_waste.sql` | Add waste entries, ready-made menu setup, sale allocations/links and guards; unchanged SQL file import passed. |
| `0020_w2_recipe_choices.sql` | Add recipe choice metadata and immutable setup/save receipts; unchanged SQL file import passed. |
| `0021_w2_purchase_measurements.sql` | Add nullable original package-input fields and package-history guards; unchanged SQL file import passed. |

After the trigger-parser failure, remote schema and ledger inspection confirmed
`0016` was applied and `0017` had no partial objects. The
[documented file-import recovery](M2_SETUP.md#development-d1-trigger-migration-recovery)
was used in order for the remaining migrations. For each file, remote changed
schema objects were compared with the migrated backup copy, foreign keys were
checked, and only then was its single ledger entry inserted and verified.
Committed SQL, snapshots and journal were not rewritten. The final remote
migration list had no pending entries; all 22 names were present exactly once.

After the hosted walkthrough, another private export passed integrity and
foreign-key checks. Comparing every original column showed **51 existing tables
unchanged**, including catalog, legacy/exact stock, configurations, recipes,
sales, consumption, purchasing and register history. Only `auth_sessions`,
`auth_users` and `security_audit` changed from the owner's normal sign-in.
Existing counts remain four exact balances, 32 exact events, 14 sales events,
ten consumption applications, two recipe versions and four configuration
versions. All seven new W1/W2 tables remained empty. No stock, recipe, waste,
item setup, sale, order or integration save occurred in the browser checks.

## Local and hosted verification

The complete local pipeline passed in the release checkout:
`pnpm typecheck`, `pnpm test` (39 suites), `pnpm db:check` (22 ordered
migrations/schema match/fresh SQLite), `pnpm build`, `pnpm db:migrate:local`
(no pending migrations), and `VINEXT_NO_DEV_LOCK=1 pnpm test:local` (real local
HTTP/auth/company-isolation smoke). The override accommodated already running
local preview servers. The development-gate build and Wrangler deploy dry run
also passed. Bundle inspection found no local secret values or fixture identity;
local fixture authentication is compiled out for builds.

Hosted HTTP checks passed:

- `/` and `/auth`: 200.
- Anonymous GETs to `/api/companies`, `/api/inventory`, `/api/waste`,
  `/api/waste/items`, `/api/waste/review` and `/api/sales/events`: 401.
- Anonymous POST to `/api/waste/entries`: 401.
- `/signin-with-chatgpt`: 404 with no fixture cookie; forged identity headers,
  a forged local signature and local fixture cookie still returned 401.

The owner signed in themselves after the previous hosted session expired.
Safari checks used the existing **B7 Clover sandbox café (fictional)**:

- Stock list showed retained milk, espresso and cup balances; Inventory exposed
  Stock, Recipes & sales, Purchasing plan and Activity.
- Add stock exposed separate recipe measurement, package label and contents.
  An unsaved gallon-jug example showed 128 US fl oz per jug and 384 US fl oz
  for three jugs; the draft was canceled through its discard prompt.
- Recipes were collapsed with search/pagination; Create recipe exposed required
  Whole/Oat milk choices and optional modifiers. The unsaved choice/modifier
  example was canceled; the existing recipe remained active and unchanged.
- Waste loaded its recipe item and existing extra-shot selection, quantity,
  reason and sale-classification controls. Its unfinished entry was discarded.
  Item setup and Needs review loaded; the review list was empty.
- Dark and light themes were visually checked, with the original light theme
  restored. The hosted tab was left on Record waste.

These are development desktop/read-only form checks. Write/retry, authorization,
concurrency and conversion behavior have local automated evidence in the
[package-unit](W2_PACK_UNIT_USABILITY.md),
[recipe/stock](W2_RECIPE_STOCK_USABILITY.md) and
[W2 Waste](W2_LOCAL_EVIDENCE.md) records. Hosted write/concurrency, full
accessibility, native POS choice mapping, signup/recovery and production security
acceptance are not proved by this release. The local unsaved example data is
not expected to appear in the hosted company.

## Recovery and handoff

For immediate application recovery, roll back `pantrack-dev` to Worker version
`5c214014-0b7e-460e-8aea-86bcdbeec095` and verify both interface/sync gates are
disabled as before. Revert the checked-in gate configuration before a later
redeployment. Retain additive migrations, all receipts and history; old code
ignores the new nullable columns and new company-scoped tables. Use a new
forward migration for schema repair. Restoring a backup would replace later
data and requires a separate explicit recovery decision; no restore occurred.

A/B contracts and migration ownership are unchanged. Shared-file handoff is
limited to the development Wrangler gates and status/evidence documentation.
No milestone acceptance checkbox was advanced. Next unblocked outcome: the
owner's hosted W1/W2 usability review, with supplier submission still disabled.
