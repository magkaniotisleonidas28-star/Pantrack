# Pantrack code readability cleanup tracker

Created: 2026-10-26. Workstream: C2 maintainability / merge-owner coordination.
Current outcome: sequential cleanup through **S18** is reviewed; see the index and section records for completed work and explicit holds.

## Task-management state and overall progress

- Planning goal: complete phases 1–2 and present this plan before application code edits.
- S00 planning: Completed. The complete order was presented before any application code edits.
- Cleanup sections: **9 of 22 Completed; 9 Blocked (recorded handoffs/holds); 0 In Progress; 4 Pending**.
- Baseline: `bb8f339a71b8b25984bdebb1822cc0d46022c882` (current main observed on 2026-10-26).
- Branch: `workstream-c/code-readability-plan-20261026`; isolated worktree: `/Users/peterpsimadas/Desktop/Pantrack-readability-20261026`.
- Owner checkout remains on `workstream-c/c4-receiving-counts`; its feature work was committed independently during planning and is preserved.
- Inventory: **882 initial committed files**, all assigned once, plus **6 upstream archive additions**; **13 receiving-branch additions** separately reserved (untracked at survey start or added during concurrent development).
- Structural scan: 525 JS/TS modules parsed, 2,728 import/re-export/dynamic-import edges inspected, 1,336 resolved local edges. Type-only edges are included; this is not a runtime call-graph proof.
- Readability scan: 550 JS/TS/CSS/Python/shell code files measured; 492 contain a line longer than 120 characters. This is a triage measure, not a defect count.
- Detailed per-module behavioral review remains Pending in its own section. The architecture survey does not claim every function has already been deeply audited.

[Per-file ownership/status/hash inventory](docs/CODE_READABILITY_FILE_MANIFEST.json) is the coverage ledger. It includes review-only files; an untouched file still requires a recorded review disposition. The two new planning artifacts are tracked in S00 rather than retroactively inserted into the baseline.

## Architecture and dependency map

| Layer | Current locations and responsibilities | Downstream consumers |
| --- | --- | --- |
| Runtime/build | Vinext/React on Vite; Cloudflare Workers/D1; root configs, `build/`, selected `scripts/` | Server/client compilation, local fixtures and CI |
| Shared foundation | `src/lib/*-contract.ts`, exact quantities, public-error/body helpers | D1 services, API schemas, UI models, workers |
| Identity | Supabase identity verification, D1 sessions/revocation/membership, server route wrapper | Every company API and workspace entrypoint |
| Inventory and sales | Versioned exact stock/recipes, waste, sales receive/process/recovery and POS adapters | Readiness, replenishment proposals, confirmation/receipt ports |
| Purchasing | Supplier registry, immutable drafts/reviews, authorizations/jobs/spending, browser session/reconciliation | Manager workflows and separately gated workers |
| Confirmation/receiving | Manager-confirmed supplier outcome, A-owned incoming/receipt statement ports; active delivery work | Incoming stock and counted-delivery workflow |
| History/documents | Saved revisions, date/product filters, snapshot exports, PDF/Excel serializers, checked downloader | History and draft workspace controls |
| HTTP boundary | `src/app/api/**/route.ts`: browser, bearer worker/bridge, webhook and callback protocols | React clients, injected tests, external contracts |
| UI | `src/app/`, workspace components/client models, vendored primitives, CSS | Existing desktop/mobile/keyboard workflows |
| Offline diagnostics | CLI wrappers, owned worker/browser implementations, independent Python audit/controller modules | Isolated injected lifecycle tests; real gates remain separately authorized |
| Verification/docs | Migrated SQLite/D1 fakes, fake fetch, source/audit/document tests, docs/OpenSpec/operator guides | Local confidence and development handoffs; not provider/pilot acceptance |

The order below follows shared foundations → persistence/security → domain services → APIs → UI → supporting tests/operations → final review. Existing tests run throughout; test-code cleanup itself is late. Cross-cutting error/logging and state/data handling are reviewed in their owning modules, not extracted into new frameworks.

## Preservation rules and cleanup technique

1. Only one section may be In Progress. Read its actual code, callers, tests and ownership constraints before editing. Keep each section in a small reviewable commit; split a large section into its listed tasks without mixing later sections.
2. Preserve UI/DOM/text/classes, behavior, business calculations, exported names, contracts, HTTP paths/statuses/messages/headers, database schema, identities, fingerprints and authorization. Never alter hook dependencies, transaction/binding/order-of-effects, retries, timeouts or security policy as a readability shortcut.
3. Format first, then consider descriptive local names and small pure helpers. Do not extract just to meet an arbitrary line limit or reorganize the flat library into a new architecture. A risky extraction stays Pending/Blocked with a reason.
4. Syntax/literal equivalence must include directives, JSX text nodes, template/string contents, import evaluation order, property/array order, meaningful magic comments and SQL literals. Whitespace-only textual diffs alone do not prove JavaScript, CSS, HTML, shell or Python equivalence.
5. Existing readable files establish conventions. S01 selects the precise formatter policy from installed tooling; no dependency upgrade or new runtime dependency is assumed. Preserve exception types and logging redaction. Do not normalize provider errors into a new behavior.
6. Used migrations and metadata, vendored UI/CSS/fonts/licenses, fixture evidence and historical reports are reviewed unchanged. Keep their baseline bytes. Generated lockfiles are not formatted. S01 permits only the exact development-only Prettier 3.9.10 additions to the importer/package/snapshot; every existing resolution is retained. No other dependency upgrade or generated-file rewrite is included.
7. Exclude `.git/`, `node_modules/`, `.sites-runtime/`, `.wrangler/`, `.vinext/`, `.next/`, `dist/`, caches, generated browser profiles, ignored local databases and secrets from cleanup. Do not scan or edit private runtime evidence. Do not read/print `.env`/credential contents. The tracked `.env.example` is a configuration template, not authority to copy live settings.
8. No deployment, hosted HTTP smoke, remote database operation, live provider/supplier/model call, purchase, sync enablement, power change, historical process/lock cleanup, gate run, allowance or consumed-attempt resume is included. Local migration/HTTP checks use this worktree’s new fictional state only.
9. Source formatting can change source hashes. Never rewrite historical proof hashes or weaken refusal tests to call a source-only cleanup collected acceptance. Hold byte-sensitive operational edits when a compatible offline proof cannot establish safety.
10. No pushes, PRs or merges are part of this new cleanup task without a new request. Previous audit publication approval does not authorize publishing this cleanup. C4/C5/M8 and hosted-release decisions are not changed.

## Active-work holds

The owner checkout advanced independently from `bb8f339` to `46f98d7` and became clean during planning. The receiving feature is now committed on `workstream-c/c4-receiving-counts`, while observed main remains `bb8f339`. Twenty-one changed feature paths remain Blocked for cleanup until integration and owner handoff. The shared package manifest has a scoped S01 exception for disjoint development tooling entries, described below. These feature changes have not been copied into this worktree; existing paths retain the committed main baseline.

| File | Cleanup owner | Hold |
| --- | --- | --- |
| `docs/C4_DELIVERY_RECEIVING_LOCAL_EVIDENCE.md` | S21 | Receiving branch `46f98d7`; integration/handoff required |
| `docs/C4_RECEIVING_PLAN_20261026.md` | S21 | Receiving branch `46f98d7`; integration/handoff required |
| `docs/CURRENT_STATUS.md` | S21 | Receiving branch `46f98d7`; integration/handoff required |
| `docs/PANTRACK_MILESTONES.md` | S21 | Receiving branch `46f98d7`; integration/handoff required |
| `drizzle/0040_po_cart_deliveries.sql` | S04 | Receiving branch `46f98d7`; integration/handoff required |
| `drizzle/meta/0040_snapshot.json` | S04 | Receiving branch `46f98d7`; integration/handoff required |
| `drizzle/meta/_journal.json` | S04 | Receiving branch `46f98d7`; integration/handoff required |
| `package.json` | S01 | Receiving adds only `cart:delivery:check`; S01 edits disjoint formatter scripts/dev dependency, preserving all existing entries. Receiving script is not imported here. |
| `scripts/po-cart-delivery-ui-check.mjs` | S20 | Receiving branch `46f98d7`; integration/handoff required |
| `src/app/api/po-cart-deliveries/route.ts` | S13 | Receiving branch `46f98d7`; integration/handoff required |
| `src/components/workspace/deliveries.css` | S18 | Receiving branch `46f98d7`; integration/handoff required |
| `src/components/workspace/delivery-count.tsx` | S17 | Receiving branch `46f98d7`; integration/handoff required |
| `src/components/workspace/durable-cart.tsx` | S17 | Receiving branch `46f98d7`; integration/handoff required |
| `src/components/workspace/employee-workspace.tsx` | S15 | Receiving branch `46f98d7`; integration/handoff required |
| `src/components/workspace/supplier-deliveries.tsx` | S17 | Receiving branch `46f98d7`; integration/handoff required |
| `src/db/schema.ts` | S04 | Receiving branch `46f98d7`; integration/handoff required |
| `src/lib/authorization.ts` | S05 | Receiving branch `46f98d7`; integration/handoff required |
| `src/lib/d1-po-cart-deliveries.ts` | S12 | Receiving branch `46f98d7`; integration/handoff required |
| `src/lib/po-cart-delivery-contract.ts` | S03 | Receiving branch `46f98d7`; integration/handoff required |
| `tests/po-cart-deliveries-api.mjs` | S19 | Receiving branch `46f98d7`; integration/handoff required |
| `tests/po-cart-deliveries-migration.mjs` | S19 | Receiving branch `46f98d7`; integration/handoff required |
| `tests/po-cart-deliveries.mjs` | S19 | Receiving branch `46f98d7`; integration/handoff required |

On handoff, sync in a separate checkpoint, inspect actual changes, update baseline coverage for the new files, and rerun affected checks. Do not overwrite dirty files or finish their feature under this cleanup. If an earlier section remains Blocked, stop dependent work; advance only an independently safe section after recording why it does not depend on the held task. No silent skipping.

## Sequential section index

| Order | Section | Baseline files | Status |
| --- | --- | ---: | --- |
| S00 | Architecture survey, preservation checkpoint and complete plan | 2 new planning artifacts | Completed |
| S01 | Project configuration, tooling and baseline checks | 38 + 7 cleanup additions | Completed |
| S02 | Shared primitives, bounded requests and public errors | 3 | Completed |
| S03 | Shared data models, exact quantities and contracts | 24 + 1 upstream | Blocked: receiving addition; present files verified |
| S04 | D1 access and immutable database history | 84 | Blocked: schema/journal/receiving; safe files verified |
| S05 | Authentication, tenant authorization and memberships | 9 | Blocked: shared wrapper handoff; present files verified |
| S06 | Inventory, recipes, waste and replenishment services | 26 | Completed |
| S07 | Sales ingestion, register bridge and Clover | 16 | Completed |
| S08 | Supplier registry, draft foundations and gated purchasing | 9 | Completed |
| S09 | Purchase-order history, export models and document downloads | 11 + 2 upstream | Completed |
| S10 | Durable cart authorization, jobs and spending limits | 3 | Completed |
| S11 | Browser-session services and worker implementation | 28 | Completed |
| S12 | Supplier confirmation, incoming stock and receiving | 1 | Blocked: receiving service handoff; confirmation verified |
| S13 | API routes and server integration boundaries | 36 | Blocked: delivery-route handoff; existing routes verified |
| S14 | Shared UI primitives and vendor boundaries | 62 | Completed |
| S15 | Application entrypoints, identity pages and workspace shell | 15 | Blocked: receiving/JSX/source pins; safe files verified |
| S16 | Inventory, recipes, waste and POS workspace components | 14 | Blocked: ten JSX holds; safe files verified |
| S17 | Purchasing, cart, spending and document workspace components | 17 | Blocked: receiving/JSX/source pins; safe files verified |
| S18 | Owned styles, static site, standalone previews and assets | 32 | Blocked: visual/receiving holds; safe files verified |
| S19 | Test harnesses, domain suites and fixtures | 148 + 2 upstream | Pending |
| S20 | Operational CLIs, lifecycle diagnostics, shell and Python audits | 88 | Pending |
| S21 | Documentation, architecture navigation and managed instructions | 218 + 1 upstream | Pending |
| S22 | Final consistency, preservation review and handoff | whole project | Pending |

## S00 — Architecture survey and complete plan

Status: Completed. Verification/documentation only; no source cleanup.

- [x] Read current instructions/status/roadmap and inspect branch/worktrees before mutation.
- [x] Preserve active receiving work and create an isolated branch from the observed main baseline.
- [x] Enumerate every committed path, scan the JS/TS syntax/import graph and measure formatting hotspots.
- [x] Read representative runtime, security, inventory/sales, purchasing, document/download, UI and worker/test boundary code; record the architecture and dependency order.
- [x] Assign every baseline file to one section; reserve active untracked files and protected categories explicitly.
- [x] Validate task references, manifest coverage, file hashes, relative links and whitespace; compare the owner snapshot and record concurrent activity without editing the owner checkout.
- [x] Present the full section order before application code changes and create this documentation-only planning checkpoint.

Verification record: all 882 baseline paths are covered exactly once and retain their original SHA-256; 13 feature-branch additions are reserved; every focused command selection names existing suites; the tracker link resolves; whitespace/JSON/task-status checks pass. The receiving owner independently committed its work at `46f98d7` during planning: its original eight protected implementation fingerprints stayed unchanged, its delivery test evolved, and its branch became clean. This task wrote only its isolated planning worktree and temporary analysis records. Typecheck, lint, tests, database commands and build were not run during planning.

## Per-section execution and completion rule

For each section, change its Status to In Progress before editing. For every task below, use `[ ]` for Pending, `[~]` for In Progress, `[x]` for Completed, or `[!]` for Blocked, with the exact reason/unblocker next to a Blocked item. The JSON file statuses are `Pending`, `In Progress`, `Completed` or `Blocked`. Record reviewed-unchanged outcomes explicitly, not as modified files.

Before changing a code section, run its focused baseline. After editing, run the indicated focused checks, lint the owned changed files with the existing rules, run typecheck/build, and use the extra full-suite/database/HTTP requirements below. Preserve existing tests; failures already present at baseline remain separate. A formatting-only change does not need a new test that merely repeats the formatter; structural changes require meaningful behavior coverage. Unsupported-language lint must be stated as not applicable with its syntax/parser alternative.

Complete the section only after a dedicated review and a truthful verification record. Do not hide inherited lint failures, platform skips, unmet visual checks or active-file holds. Do not change tests or lint policy simply to obtain a green cleanup result.

Each section’s review record must contain: files modified/reviewed unchanged; specific improvements; exact commands/results/log paths; syntax/behavior/UI/security/database checks; remaining Pending/Blocked work and why; commit; next section. Until populated, its result is **not verified**, even if code was edited.

## S01 — Project configuration, tooling and baseline checks

Status: Completed. Depends on: none.

**Files:** `package.json`, `tsconfig.json`, `eslint.config.mjs`, root build/Wrangler/PostCSS/Drizzle configs, `.github/workflows/`, `build/`, and the development/install/test-runner scripts assigned in the inventory.

- [x] S01.1 — Revalidate current main, owner handoffs and inventory before cleanup; then record lint/typecheck/test/build/database baseline and installed formatter availability. Separate inherited failures from regressions.
- [x] S01.2 — Choose and document one formatting convention using existing tooling where possible. Default to two-space indentation, explicit statement boundaries and readable wrapping; retain semantic comments, directives, literal values and import evaluation order.
- [x] S01.3 — Expand compressed local adapter/configuration branches and explain runtime-profile/preview conditions. Preserve environment defaults, binds, versions, commands, flags, ignore patterns and vendored plugin provenance.
- [x] S01.4 — Identify source-text assertions, source fingerprints, generated files and side-effect imports that constrain later formatting. Record concrete holds; do not relax checks merely to make formatting pass.

**Focused command:** `pnpm test local-auth local-d1-database ci-tool-pins ci-migrations`.

**Verification:** Run the complete baseline pipeline, including `pnpm lint`; use only this worktree’s fresh local state. Record every result and any inherited lint failure. S01 adds exact Prettier 3.9.10 as a development-only formatter because no formatter was available. Its pin predates the seven-day release-age policy. Only its importer/package/snapshot entries may be added to the lockfile; existing resolutions and build policy remain unchanged.

- [x] S01.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S01.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** 24 existing files changed (22 guarded source-format edits plus the package/lock tooling additions); 14 baseline files reviewed unchanged; 7 cleanup tooling/guide/receipt files added. Compressed install/build/local-fixture adapters now have readable wrapping and consistent quotes/spacing. Exact Prettier 3.9.10 and a section-scoped refusal-first formatter compare syntax/types/literals/comments and emitted JSX/JavaScript, with independent Prettier round-trip checks. Runtime dependency/configuration values, command behavior, import order, SQL and templates remain equivalent. No source rule or test was relaxed.

[Machine-readable verification receipt](docs/readability/S01-verification.json) records actual commands, exits, durations and log hashes. Baseline and final typecheck, focused tests, full tests (137 then 138 suites), `db:check` (40 migrations), build, local setup, isolated migration apply and local HTTP smoke passed. `git diff --check`, new-tool scoped lint, four shell syntax checks, YAML parser checks, link checks and the independent baseline comparison passed. Both full lint runs failed with the same 71 errors/80 warnings; this is recorded inherited debt, not a passing lint claim. No visual workflow was changed. Evidence is local/macOS only.

Byte-sensitive handoffs: `tests/po-cart-launcher-check-lifecycle.mjs` inspects launcher/preview source; `tests/po-cart-full-gate-audit.mjs` rewrites Python auditor source in injected scenarios; the lifecycle validation suite binds `sourceSnapshot()`. S11/S19/S20 must preserve these assertions and historical evidence; unsafe formatting stays Blocked. Baseline evidence/logs are under `.sites-runtime/readability/S01/{baseline,final}/` in this worktree. Section commit: `style(readability): establish guarded formatting and clean project tooling`. Next: integrate the newly observed upstream archive contract in a separate checkpoint, then S02. Receiving code remains held. Rollback is source/tooling/documentation revert only; never touch historical runtime state.

## S02 — Shared primitives, bounded requests and public errors

Status: Completed. Depends on: S01.

**Files:** `src/lib/utils.ts`, `src/lib/bounded-body.ts`, `src/lib/user-facing-error.ts`.

- [x] S02.1 — Make helper names, parameter types, spacing and control flow easy to scan without changing exports.
- [x] S02.2 — Document UTF-8 byte bounds, stream cancellation/release, and the distinction between intended public errors and unexpected internal faults.
- [x] S02.3 — Preserve `cn` behavior, error constructors/messages, size limits, stream order and the existing public-message boundary. Do not introduce a new global logging/error framework.

**Focused command:** `pnpm test register-bridge m2-security purchase-order-downloads`.

**Verification:** Run the section’s tests plus scoped lint, typecheck and build. Formatting-only edits also require syntax/literal/directive equivalence.

- [x] S02.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S02.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All three owned files formatted; no unchanged files or unresolved S02 holds. Bounded-body comments explain raw-byte counting before UTF-8 assembly and guaranteed stream-lock release. Public error constructors/messages/fallbacks, `cn` merge order, byte limits and read/cancel/release ordering are unchanged. All three modules passed independent pre-section syntax/type/literal/emitted-runtime comparison after excluding the two reviewed comment additions. Baseline and final `pnpm test register-bridge m2-security purchase-order-downloads` passed (3 suites, including tenant/role/recovery/error sanitization and byte-bounded ASCII/multibyte cases). Scoped ESLint, `pnpm format:check --section S02`, `pnpm typecheck`, `pnpm build` and `git diff --check` passed against frozen source. Commands/exits/durations/log hashes/source digest are in inventory `sectionReviews.S02`; logs: `.sites-runtime/readability/S02/`. No schema/HTTP behavior/UI change or new migration; local mocked evidence only. Commit: `style(readability): clarify shared request and error helpers`. Rollback: revert this section source/docs only. Next: S03 contracts/quantities.

## S03 — Shared data models, exact quantities and contracts

Status: Blocked only for the receiving-contract handoff; 25 present files verified. Depends on: S02.

**Files:** `src/lib/pantry.ts`, `automation-types.ts`, `inventory-quantities.ts`, `stock-pack-quantities.ts`, and every `src/lib/*-contract.ts` assigned in the inventory.

- [x] S03.1 — Group related types, discriminated unions, schemas, constants and pure helpers within their existing modules.
- [x] S03.2 — Expand compressed validators and quantity arithmetic; explain canonical units, rational factors, minor currency units, scope and version identities.
- [x] S03.3 — Preserve exported names, field and enum values, schema evaluation/default order, object serialization order, rounding/bounds, money representation and validation messages.
- [!] S03.4 — Keep the active `po-cart-delivery-contract.ts` addition Blocked until its owner handoff; do not create a competing contract or change an existing wire schema. The file is absent here; unblock only after the owner branch is integrated and its actual source is reviewed.

**Focused command:** `pnpm test inventory-quantities stock-pack-units inventory-consumption-contract sales-ingestion-contract supplier-simulation-contract po-cart-authorization po-cart-jobs po-cart-browser-sessions po-cart-confirmations purchase-order-drafts purchasing-suppliers`.

**Verification:** Run the listed contract families, full `pnpm test`, scoped lint, typecheck and build. Compare exports, schema/serialization fixtures and exact numeric boundaries.

- [x] S03.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S03.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** 25 present modules formatted and reviewed; 163 whitespace-only declaration boundaries separate types/functions. Exact-quantity rational arithmetic, package display rounding, strict Zod schemas, frozen document projections, spending windows, cart preflight/confirmation and public errors are expanded for scanning. All 299 ordered exports and complete syntax/types/literals/comments/emitted runtime match pre-section HEAD. Existing explanations for canonical units, conversion rounding, cents, version/scope identities and security gates are retained. Long validation/projection functions remain intact to preserve short-circuit/check order; no new abstraction or wire-schema change was made.

The format tool initially refused the TypeScript spelling `typeof ids[number]` → `(typeof ids)[number]` before any write. A new fixture reproduced that false refusal (exit 1), then one `ParenthesizedType` normalization passed it (exit 0); a union/array grouping-change test still refuses. This narrow S01 tooling handoff changed only the guard and its suite; no existing application assertion was weakened.

Baseline 11 focused suites passed; final focused command adds `code-readability` (12 suites) and passes. Full `pnpm test` passed all 139 suites; scoped lint for all present modules and the changed tooling passed; format check, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. Command/exits/durations/log hashes/source digest: inventory `sectionReviews.S03`; logs: `.sites-runtime/readability/S03/`. Local/macOS fake-provider evidence only; no HTTP/UI/schema change or live run. Full-project lint remains inherited debt.

Commit: `style(readability): expand shared data and validation contracts`. Remaining: absent `po-cart-delivery-contract.ts` stays Blocked until receiving integration/handoff. S04 can independently review raw D1 binding access and unchanged migration history without using that contract; its own schema/journal holds remain explicit. Rollback: revert this section source/docs/tooling refinement only.

## S04 — D1 access and immutable database history

Status: Blocked only for receiving-owned schema/journal/migration review; 82 safe files verified. Depends on: S03 present contracts (verified); its absent receiving contract is not used here.

**Files:** `src/db/raw.ts`, `src/db/index.ts`, `src/db/schema.ts`, all `drizzle/*.sql` and `drizzle/meta/*`.

- [!] S04.1 — D1 raw/index access cleanup is Completed. Schema grouping/comments remain Blocked by the receiving owner; declarations and generated SQL are unchanged.
- [x] S04.2 — Review all 40 committed SQL migrations and their metadata as immutable history. Preserve their bytes and ordering; do not reformat used SQL, journal entries or snapshots.
- [x] S04.3 — Preserve table/column/index/trigger names, constraints, prepared bindings, timestamp storage and Wrangler trigger splitting. No new migration or schema generation belongs to cleanup.
- [!] S04.4 — Keep schema/journal and pending 0040 migration/snapshot changes Blocked until the receiving owner finishes; do not enter or reserve the migration queue.

**Focused command:** `pnpm test ci-migrations m3-data-foundations m4-data-foundations c4-main-upgrade`.

**Verification:** Run `pnpm db:check`, focused migration suites, typecheck and build. Compare committed migration hashes and schema metadata. Any apply is restricted to this worktree’s fresh local database.

- [x] S04.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S04.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** `src/db/raw.ts` and `src/db/index.ts` formatted; binding lookup, exported helpers, error text and schema registration match pre-section source. Forty used SQL files (226 trigger definitions) and forty snapshots reviewed unchanged; all retain baseline hashes. Present held `schema.ts` and journal also retain baseline bytes. No schema, migration, binding, query or application behavior changed; no migration queue was entered.

The first baseline command contained a nonexistent suite and refused before running tests (exit 1, `baseline.log`). The exact planned command was then run before edits: `pnpm test ci-migrations m3-data-foundations m4-data-foundations c4-main-upgrade` passed all four suites before and after. Final scoped lint, format/equivalence check, typecheck, `db:check` (40 ordered migrations/fresh SQLite/schema match), build and diff check passed against frozen source. Exact results/log hashes/source digest: inventory `sectionReviews.S04`; logs: `.sites-runtime/readability/S04/`. No new HTTP or schema behavior required another apply/smoke; S01 integrated apply/smoke remains separately recorded. Local/macOS evidence only.

Commit: `style(readability): clarify D1 bindings and preserve database history`. Remaining Blocked: receiving-owned schema/journal and absent `0040` SQL/snapshot additions, pending integration/handoff. S05 can independently format present identity modules while leaving its shared wrapper held. Rollback: revert only the two helper formatting edits and cleanup records; no database rollback is needed.

## S05 — Authentication, tenant authorization and memberships

Status: Blocked only for the receiving-owned shared wrapper; eight present identity modules verified. Depends on: S04 safe D1 access (verified); no absent delivery schema is used here.

**Files:** `src/lib/auth*.ts`, `authorization.ts`, `chatgpt-auth.ts`, `company-access.ts`, `memberships.ts`, `password-policy.ts`, `reauthentication.ts` as assigned in the inventory.

- [!] S05.1 — Session/membership cleanup is Completed; permission-wrapper formatting remains Blocked until its receiving handoff. Existing exports and local names are retained where renaming would weaken the simple equivalence proof.
- [!] S05.2 — Identity/recovery explanations are Completed, including a D1 revocation rationale comment. The existing committed-response audit wrapper was read and remains unchanged; its formatting/documentation update is held with S05.4.
- [x] S05.3 — Preserve permission truth tables, CSRF checks, token/cookie/encryption behavior, recovery fences, exception types, sanitized messages, response statuses and attempt-before-effect ordering.
- [!] S05.4 — Coordinate the currently modified `authorization.ts` before editing. Do not overwrite the receiving family addition.

**Focused command:** `pnpm test m2-security local-auth`.

**Verification:** Run every BUG-01 recovery regression and anonymous/wrong-company/forbidden-role cases, full tests, scoped lint, typecheck and build. No provider contact or verification cache.

- [x] S05.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S05.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Eight present identity modules formatted; 32 whitespace-only declaration boundaries separated. The new comment in `auth.ts` explains why provider success cannot override D1 revocation. All eight modules match pre-section syntax/types/literals/comments/emitted runtime after excluding that reviewed comment. The shared `authorization.ts` wrapper remains byte-identical and held. No verification cache, security policy, token/cookie/encryption, CSRF, tenant/role, recovery cutoff, lease, transaction, SQL/binding order, response or integration change was introduced.

Baseline and final `pnpm test m2-security local-auth` passed both suites, including all BUG-01 exchange/session-insert barriers, concurrent reset claims, provider logout failure, rejected/unknown/timeout/lost response, predecessor deletion, abandoned/late recovery and expiry/rollback regressions. Full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. Scoped ESLint exited 0 with one inherited unused `_` warning in token-stripping destructuring; no rule was suppressed and that token-removal behavior is unchanged. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S05`; logs: `.sites-runtime/readability/S05/`. Evidence is local/macOS with mocked Supabase; no provider acceptance is claimed. The owner checkout remained clean at `46f98d7`.

Commit: `style(readability): expand identity and membership flows`. Remaining: shared wrapper cleanup requires the receiving branch integration/handoff. S06 can independently format present inventory services against unchanged access contracts. Rollback: revert this section source/docs only; no migration or external action exists.

## S06 — Inventory, recipes, waste and replenishment services

Status: Completed. Depends on: S05.

**Files:** Inventory/recipe/waste modules, `d1-inventory-*`, `d1-stock-pack.ts`, `d1-recipe-publisher.ts`, `d1-waste.ts`, `d1-menu-waste.ts`, `d1-replenishment-*`, `replenishment-*`, preview/readiness helpers and related fake ports listed in the inventory.

- [x] S06.1 — Format mixed type/data/transaction code first; group statements by existing phases and explain the invariant each phase protects.
- [x] S06.2 — Review large inventory methods for small, pure helper extractions only after understanding their full callers and atomicity; leave risky extractions Blocked rather than changing transaction boundaries.
- [x] S06.3 — Clarify count/receipt replay, canonical quantities, custom-unit history, chronology, source freshness, waste allocation, recipe choices and proposal state transitions.
- [x] S06.4 — Preserve exact/legacy projection compatibility, SQL/batch/binding order, idempotency fingerprints, no-write losers, readiness holds and supplier-quantity retention. Coordinate A-owned receipt ports with active receiving work.

**Focused command:** `pnpm test inventory-management-contract inventory-consumption-d1 inventory-count-receipts inventory-order-incoming inventory-order-receipts stock-pack-units recipe-choices waste-recording menu-waste replenishment-lifecycle-d1 replenishment-proposal a8-sales-readiness-d1`.

**Verification:** Run these focused services plus the full suite, scoped lint, typecheck, db:check and build. Use migrated in-memory SQLite; preserve actual transaction/replay/concurrency tests.

- [x] S06.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S06.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All 26 present modules formatted and reviewed; 77 whitespace-only declaration/method boundaries separated. Compressed inventory setup/count/movement/receipt, recipe publication, waste classification/retry, exact/legacy projections and replenishment settings/origin/lifecycle code now exposes its existing phases. Two rationale comments explain the ordered, atomic `changes()`-dependent batches. Existing helpers are adequate for this formatting pass; splitting `configureInternal`, `consumeAttempt` or receipt builders would complicate transaction/closure review, so their structure is deliberately retained. No such extraction is claimed complete.

All 26 modules passed independent syntax/types/literals/comments/emitted-runtime comparison against pre-section `230e3e9`, after excluding exactly those two reviewed comments. SQL and template contents, prepared bindings, statement/effect order, canonical arithmetic, fingerprints/replay, no-write losers, count cutoffs, frozen receipt units, readiness holds and unresolved supplier quantities are unchanged. The active receiving branch changes different files; its absent contract/schema remains held, and existing A-owned receipt ports passed their real migrated fake-D1 tests.

The exact twelve focused suites listed above passed before and after. Full `pnpm test` passed all 139 suites. Format check, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. Scoped ESLint exited 0 retaining one inherited unused `changes` helper warning. Commands/exits/durations/log hashes/source digest: inventory `sectionReviews.S06`; logs: `.sites-runtime/readability/S06/`. Source-structure and chunk-review records are preparation only. Local/macOS evidence with in-memory migrated SQLite/fake D1; no UI/schema/HTTP behavior, integration, purchase or real lifecycle action changed.

Commits: inventory/receipt services `8ccc6d7`; waste/retry flows `5c1e8c0`; replenishment/tracker commit `style(readability): organize replenishment review lifecycle`. No S06 hold remains; earlier receiving holds remain open. Rollback is those three source/docs commits only. Next: S07 sales/register/Clover services.

## S07 — Sales ingestion, register bridge and Clover

Status: Completed. Depends on: S06.

**Files:** `sales-ingestion.ts`, `d1-sales-*`, `import-sales.ts`, `register-*.ts`, `clover*.ts`, `pos-adapter.ts`, `pos-provider-status.ts` as assigned.

- [x] S07.1 — Make normalize/receive/claim/process/reconcile stages explicit through whitespace, descriptive locals and concise invariant comments.
- [x] S07.2 — Clarify the bounded two-query keyset scan, timestamp ties, per-ID deduplication, deleted-order evidence and checkpoint refusal.
- [x] S07.3 — Review provider/token/webhook paths without changing fetch timing, filters, endpoint parameters, timeouts, refresh recovery or error contracts.
- [x] S07.4 — Preserve exactly-once inventory outcomes, immutable revisions, held unknown mappings/modifiers, ambiguous states, cursor limits and disabled hosted sync. No provider or OAuth call.

**Focused command:** `pnpm test b4-sales-inventory inventory-sales register-bridge clover-connection clover-b6-local clover-pagination sales-ingestion-contract sales-inventory-outcome-recovery sales-recovery-runtime sales-unresolved-readiness`.

**Verification:** Run the listed tests, full suite, scoped lint, typecheck and build. Keep fake fetch and the real migrated domain services; no live Clover/bridge submissions.

- [x] S07.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S07.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Fifteen source files formatted; `clover-sales-outcomes.ts` reviewed unchanged. Fifty-eight whitespace-only declaration/method boundaries improve navigation through the event contracts, in-memory/D1 stores, service, corrections, CSV/bridge and Clover adapters. Existing comments explain ledger-first recovery, fenced leases, retained unknown outcomes, minimal provider payloads and boundary-timestamp pagination. These state machines/modules are kept intact; no helper extraction or new comment changes their structure.

All sixteen modules match pre-section `7739d8e` syntax/types/literals/comments/emitted runtime. Ordered schema/JSON fields, SQL/bindings/effects, UTF-8 bounds, idempotency/lineage keys, cursor/tie/dedup/page-limit/checkpoint behavior, fetch timing, token rotation/recovery, fenced lease release, challenge replacement and transport errors are unchanged. Sync stays disabled; no Clover, OAuth, bridge or other live provider call was made by this cleanup.

The exact ten focused suites above passed before and after. Full `pnpm test` passed all 139 suites. Scoped ESLint has no diagnostics; format/equivalence checks, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. Exact commands/exits/durations/log hashes/source digest: inventory `sectionReviews.S07`; logs: `.sites-runtime/readability/S07/`. Evidence is local/macOS with fake fetch and migrated in-memory D1, not new Clover sandbox/pilot acceptance. No schema, API or UI behavior change required another apply/smoke.

Commits: core sales/recovery `4291b10`; POS/Clover/tracker `style(readability): clarify POS and Clover adapters`. No S07 hold remains; earlier receiving holds remain open. Rollback: those two source/docs commits only. Next: S08 supplier registry, immutable drafts and gated purchasing.

## S08 — Supplier registry, draft foundations and gated purchasing

Status: Completed. Depends on: S07.

**Files:** `d1-purchasing-suppliers.ts`, `d1-purchase-order-drafts.ts`, `d1-supplier-simulation.ts`, `supplier-order-draft.ts`, supplier fakes, `purchasing-engine.ts`, `vendor-adapter.ts`, `stripe-payments.ts`.

- [x] S08.1 — Separate visually the lookup/validation/claim/effect/persistence stages; expand compressed legacy automation handlers and connector parsing.
- [x] S08.2 — Document immutable draft revisions, supplier/account mappings, exact quotes, guarded external effects, fenced lease release and retained unknown outcomes.
- [x] S08.3 — Retain public interfaces, integer/string money, budget calculations, request bodies, timeout/error semantics and the unconditional real-submission block.
- [x] S08.4 — Do not remove apparently unreachable safety paths, replace the supplier connector, provision scheduling, enable automatic mode or call Stripe/suppliers.

**Focused command:** `pnpm test supplier-simulation-contract supplier-simulation-d1 purchasing-suppliers purchasing-suppliers-api purchase-order-drafts purchase-order-api purchase-order-review purchasing-safety`.

**Verification:** Run these tests, the full suite, scoped lint, typecheck and build. Confirm zero real connector calls and unchanged disabled purchasing.

- [x] S08.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S08.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All nine modules formatted; 111 whitespace-only declaration/method boundaries separated. Registry version/mapping reads and guarded writes, draft revision/review/cancellation, simulated quote/approval/reservation/reconciliation, legacy purchasing and crypto/payment adapters are easier to scan. Existing comments explain frozen quantities, unknown outcomes, atomic receipt/audit guards and the unconditional real-submission refusal. Independent handoff validation remains separate; dormant safety paths are retained. No structural extraction or new abstraction was introduced.

All nine modules match pre-section `2179469` syntax/types/exports/literals/comments/emitted runtime. SQL, bindings and effect order, whole-pack/cents arithmetic, exact quote approval, registered fake-only connector requirement, membership/source/version/budget guards, response/error text, transport/crypto and fenced lease release are unchanged. `submit()` still calls the unconditional pilot block before reading or sending. Supplier submission, purchasing and sync remain disabled; no real supplier or Stripe request was made.

The exact eight focused suites above passed before and after. Full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. **Scoped ESLint exited 1** on the same pre-existing `vendor-adapter.ts` `no-explicit-any` error observed at the integrated baseline; no new diagnostic or suppression, and no false lint-pass claim. Its existing type contract was retained. Exact commands/results/log hashes/source digest and this inherited failure: inventory `sectionReviews.S08`; logs: `.sites-runtime/readability/S08/`. Local/macOS fake-provider evidence only; no new API/schema/UI behavior or external acceptance.

Commits: registry/draft persistence `7e569d7`; simulation/gated adapters/tracker `style(readability): expand simulated and gated purchasing flows`. No S08 source hold remains; inherited lint debt and earlier receiving holds remain open. Rollback: those two source/docs commits only. Next: S09 history, exports, documents and downloads.

## S09 — Purchase-order history, export models and document downloads

Status: Completed. Depends on: S08.

**Files:** `purchase-order-*` history/export/document/download modules, their D1 adapters, `draft-document-pdf.ts`, `draft-document-xlsx.ts`.

- [x] S09.1 — Group filtering, pagination, snapshot capture, formatting, serialization and download lifetime code by existing responsibility.
- [x] S09.2 — Expand date/DST/product matching and PDF/Excel transformations; explain saved-revision provenance, full-result bounds and immutable snapshots.
- [x] S09.3 — Clarify cancellation, stale continuation suppression, second authorization/fingerprint checks and object URL/download ownership.
- [x] S09.4 — Preserve field/order/locale/date semantics, file names/MIME types, cell escaping, font handling, archive entries, no-partial-export rules and read-only export persistence. No library upgrade.

- [x] S09.5 — Preserve the newly integrated archive ports: prepare before object write, observations before decisions, create-only storage, fenced publication, permanent replay and authorization rechecks. No production journal, R2 binding or route is added.

**Focused command:** `pnpm test purchase-order-history purchase-order-history-products purchase-order-history-dates purchase-order-exports purchase-order-history-exports purchase-order-documents purchase-order-history-documents purchase-order-downloads purchase-order-history-downloads supplier-order-draft-pdf supplier-order-draft-xlsx purchase-order-document-archive`.

**Verification:** Run the document/history/lifecycle suites, full tests, scoped lint, typecheck and build. Use existing independent PDF/Excel readers and assert zero export writes.

- [x] S09.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S09.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All thirteen modules formatted; 35 whitespace-only declaration/method boundaries separated. Existing history filtering/one-snapshot export reads, PDF/Excel projections/layout, download cancellation/second checks and archive preparation/observation/write/verification/publish phases are easier to scan. Modules and nested layout/state helpers remain cohesive; no new abstraction, visual instruction or comment was added.

All thirteen modules match pre-section `ac8d2a3` syntax/types/exports/literals/comments/emitted runtime. SQL/binding order, field/locale/date/DST/product semantics, snapshot/size bounds, no-partial results, serialization/escaping, layout coordinates/operators/text, filenames/MIME, font handling, cancellation/authorization/fingerprint checks and Blob/link/URL cleanup are unchanged. All three font/license files retain baseline hashes. Archive prepare-before-write, observe-before-decide, create-only objects, fenced publish, permanent replay and current-access checks are preserved; no production journal/R2/route/schema was added.

Baseline eleven document/history suites and the separately added upstream archive conformance suite passed. The combined final focused command passed all twelve suites, including independent PDF/XLSX readers, both native formats/source kinds, file-backed SQLite/create-only fixture objects, unknown-write cross-process recovery and zero export writes. Full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. Scoped ESLint exited 0 retaining two inherited archive unused import/value warnings. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S09`; logs: `.sites-runtime/readability/S09/`. No browser/pixel walkthrough was run because layout instructions/runtime remain equivalent; this is local/macOS evidence, not external storage/provider acceptance.

Commits: history/export reads `b9e6c9b`; rendering/download flows `133a092`; archive/tracker `style(readability): clarify immutable document archive lifecycle`. No S09 hold remains; earlier receiving holds remain open. Rollback: those three source/docs commits only. Next: S10 cart authorizations, jobs and spending limits.

## S10 — Durable cart authorization, jobs and spending limits

Status: Completed. Depends on: S09.

**Files:** `d1-po-cart-authorizations.ts`, `d1-po-cart-jobs.ts`, `d1-po-cart-spending-limits.ts`; their contract definitions were reviewed in S03.

- [x] S10.1 — Label and expand authorization/reservation/job/attempt/result phases and their company/account scopes.
- [x] S10.2 — Document lease fences, first-attempt receipts, ambiguous outcomes, replay identities, atomic reservation transitions and budget exposure.
- [x] S10.3 — Review helper boundaries conservatively: preserve transaction-time checks, binding and audit order, all conditional SQL and permanent idempotency receipts.
- [x] S10.4 — Keep public action/state names, credential scopes, unknown-outcome holds, exact caps and cancel/release semantics unchanged.

**Focused command:** `pnpm test po-cart-authorization po-cart-authorizations-api po-cart-persistence po-cart-jobs po-cart-jobs-api po-cart-job-sources po-cart-spending-limits po-cart-spending-limits-api po-cart-spending-limits-reconciled`.

**Verification:** Run the listed races/replay/permission suites, full tests, scoped lint, typecheck, db:check and build. No new allowance or job execution.

- [x] S10.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S10.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All three modules read fully, formatted and separated at 71 whitespace-only declaration/method boundaries. Authorization/reservation, job claim/attempt/result/baseline/recovery and owner spending-policy flows are easier to scan. Existing rationale explains permanent receipts, transaction-time clocks, atomic reservations and retained uncertain exposure. Cohesive transaction helpers remain intact; no extraction or new abstraction was introduced.

All three modules match pre-section `efd528e` syntax/types/exports/literals/comments/emitted runtime. Company/role/source rechecks, SQL and binding/audit order, exact caps/time-zone windows, first-attempt receipts, no renewed capability on replay, ownership/lease fences, unknown-outcome holds and cancel/release semantics are unchanged. No new allowance or job/browser execution was performed.

The exact nine focused suites above passed before and after. Full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. **Scoped ESLint exited 1**, retaining the baseline jobs `prefer-const` error and authorization `_action` unused-value warning; file/rule/message comparison matches the integrated baseline. No new diagnostic or suppression. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S10`; logs: `.sites-runtime/readability/S10/`. This proves local/macOS fake-provider behavior only; no schema/API/UI behavior change required another apply/smoke.

Commits: authorizations/spending `style(readability): clarify cart authorizations and spending limits`; jobs/tracker `style(readability): expand fenced cart job transitions`. No S10 source hold remains; inherited lint debt and earlier receiving holds remain open. Rollback: those two source/docs commits only. Next: S11 browser-session services and worker implementation.

## S11 — Browser-session services and worker implementation

Status: Completed. Depends on: S10.

**Files:** `d1-po-cart-browser-sessions.ts`, `d1-po-cart-preparation.ts`, `d1-po-cart-reconciliation.ts`, `po-cart-worker-transport.ts`, the assigned worker client/browser/AI/private-file modules, and `scripts/cart-preview/`.

- [x] S11.1 — Make claim/heartbeat/preflight/observe/reconcile/report/dispose stages navigable without reordering them.
- [x] S11.2 — Clarify client retries, local journals, proxy restrictions, captured ownership, private file permissions, credentials and mocked AI budget accounting.
- [x] S11.3 — Explain SDK/browser adapter boundaries and preserve lazy imports, environment minimality, timeouts, strict verification and denial defaults.
- [x] S11.4 — Do not move entrypoints, rename protocol symbols, change source-hash inputs, introduce settling/retry behavior, launch browsers or consume any diagnostic attempt. Byte-pinned code is held if equivalence cannot be proved.

**Focused command:** `pnpm test po-cart-worker-api po-cart-worker-guards po-cart-worker-client po-cart-worker-processes po-cart-browser-api po-cart-browser-sessions po-cart-browser-session-api po-cart-browser-network po-cart-reconciliation po-cart-reconciliation-api po-cart-ai-reader cart-preview po-cart-browser-lifecycle po-cart-manager-supervisor po-cart-metadata-evidence po-cart-evaluation-preflight po-cart-second-addition-repair po-cart-connector-binding`.

**Verification:** Run only existing isolated/injected suites, plus full tests, scoped lint, typecheck and build. Fake worker process tests may own temporary fixtures; real browser/maintenance CLIs are not authorized.

- [x] S11.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S11.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All 28 modules read fully and formatted; 124 whitespace-only declaration/method boundaries separated. D1 session/preflight/reconciliation, worker HTTP/journal/private-file/credential/fixture/supervisor, AI discovery/extraction/diagnostics/metadata and cart-preview acquisition/read/disposal flows are easier to scan. Existing comments explain transaction-time fences, unknown outcomes, non-reusable receipts, fixed model reservations, network denial and partial cleanup. These responsibilities remain in their existing modules; no risky extraction or new abstraction was introduced.

All 28 modules match pre-section `448ba8f` syntax/types/exports/literals/comments/emitted runtime. SQL/binding/audit order, role/current-credential checks, lease fences, permanent UUID replay and uncertain journals, no repeated addition/inference, private modes/fsync/locks, cumulative budgets, exact prompts/schemas/callback order, fixture HTML/CSS, proxy/interception restrictions, connector receivers and bounded closure are unchanged. Source-hash selection/fixed bindings and consumption policy are preserved; historical proof hashes are not rewritten.

Twelve original focused suites, four added diagnostics/preflight/supervisor/lifecycle suites and two added installed-connector/partial-teardown suites passed before edits. The final combined command passed all eighteen suites, including injected actual acquisition/failure/disposal and fake process crash/recovery. Full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. **Scoped ESLint exited 1 with 29 errors/4 warnings**, exactly matching the integrated baseline by file/rule/message; no suppression or new diagnostic. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S11`; logs: `.sites-runtime/readability/S11/`.

This is local/macOS evidence only. No real Chrome, supplier/provider/paid model, evaluator/maintenance/gate entrypoint, new allowance or owner runtime operation ran. Commits are grouped by D1 services, worker ownership/journals, AI/evidence and preview resources; exact hashes follow in the inventory at the next checkpoint. No S11 source hold remains. Rollback: these four source/docs commits only. Next: S12 supplier confirmation; its separate receiving implementation remains held.

## S12 — Supplier confirmation, incoming stock and receiving

Status: Blocked only for receiving-service handoff; confirmation verified. Depends on: S11; S06 inventory receipt ports.

**Files:** `d1-po-cart-confirmations.ts`, plus the committed receiving branch’s `d1-po-cart-deliveries.ts` after integration/handoff. Confirmation/delivery contracts, route and tests have separately identified owners.

- [x] S12.1 — Clarify manager-entered confirmation checks, immutable supplier references, expected versus received quantities, holds and account-cart release.
- [x] S12.2 — Explain how A-owned incoming/receipt statements compose into the same D1 batch; keep business effects auditable and idempotent.
- [!] S12.3 — Receiving-branch delivery service and its consumers remain Blocked until integration/handoff. The absent source cannot be reviewed or cleaned here; re-inventory it after that handoff.
- [x] S12.4 — Preserve partial-receipt quantities, stock updates, duplicate behavior, actor/permission rechecks and original operation identity. Do not complete or repair the receiving feature as cleanup.

**Focused command:** `pnpm test po-cart-confirmations po-cart-confirmations-api inventory-order-incoming inventory-order-receipts`.

**Verification:** Run confirmation/incoming/receipt tests, full tests, scoped lint, typecheck, db:check and build. Add `po-cart-deliveries` only after its owner handoff and inventory update; never borrow the owner’s dirty database.

- [x] S12.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S12.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** The present confirmation service is fully read and formatted; eight whitespace-only declaration/method boundaries separate actor/read/replay/record stages. Its existing class documentation explains within-cap atomic incoming, over-cap holds, commitment transfer, account release and retained spending. No new comment, extraction or abstraction was needed.

The module matches pre-section `05c1993` syntax/types/exports/literals/comments/emitted runtime. Company/role/source/revision checks, unique supplier references, frozen quantity conversions, SQL/binding/effect/audit order, the single incoming/confirmation/release batch, permanent replay and uncertain-acknowledgment recovery are unchanged. A-owned incoming/receipt statements remain in their existing modules and were covered by the focused regressions.

All four focused suites above passed before and after; full `pnpm test` passed all 139 suites. Scoped lint, format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S12`; logs: `.sites-runtime/readability/S12/`. Local/macOS fake-provider evidence only; no schema/API/UI behavior change required another apply/smoke.

Commit: `style(readability): clarify supplier confirmation and incoming handoff`. **Remaining hold:** `d1-po-cart-deliveries.ts` is absent here and remains Blocked until receiving integration/handoff, together with its held contract/schema/API/UI/tests. S13 can independently review the existing routes against the verified present services; the separate delivery route and authorization-wrapper handoff remain held. Rollback: this source/docs commit only.

## S13 — API routes and server integration boundaries

Status: Blocked only for delivery-route handoff; 36 existing routes verified. Depends on: S05–S12; receiving route remains on hold until its own dependencies are ready.

**Files:** Every `src/app/api/**/route.ts`, including browser company routes, machine transports, callbacks, webhooks, exports, automation and the pending delivery API.

- [x] S13.1 — Review routes family by family: identity/company/members; inventory/waste/replenishment; sales/register/Clover; purchasing/history/cart; internal worker/browser/machine callbacks.
- [x] S13.2 — Expand compressed request parsing and response branches, clarify local names and group existing action handlers without changing dispatch order.
- [x] S13.3 — Keep thin boundaries where already present; extract only route-local pure helpers with meaningful regression coverage. Do not redesign the shared wrapper or merge incompatible error policies.
- [!] S13.4 — Existing verbs/paths, schemas, responses/headers, caching, CSRF/body limits, role/tenant checks, machine credentials and uncertainty are verified unchanged. The absent delivery route remains Blocked until receiving integration/handoff.

**Focused command:** `pnpm test m2-security b4-sales-inventory po-cart-authorizations-api po-cart-jobs-api po-cart-browser-session-api po-cart-worker-api po-cart-confirmations-api purchase-order-export-api purchase-order-history-export-api purchasing-suppliers-api local-auth cart-preview-api po-cart-spending-limits-api po-cart-reconciliation-api purchase-order-api clover-connection clover-b6-local register-bridge pos-register-status waste-recording menu-waste inventory-management-contract replenishment-review-group`.

**Verification:** Run every affected API suite and full tests, scoped lint, typecheck, build, then isolated local migration/HTTP smoke for boundary verification. Recheck anonymous/wrong-company/forbidden-role cases; no hosted requests.

- [x] S13.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S13.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All 36 existing routes read fully and formatted; 71 whitespace-only declaration boundaries separate types/helpers/handlers. Identity/company/membership, legacy automation/payments, Clover/callback/bridge, inventory/sales/replenishment/waste, purchasing/history/cart and machine-worker boundaries are easier to scan. Thin delegates remain thin; route-local policy differences and existing wrapper families are retained. No new abstraction, route or shared-wrapper redesign was introduced.

All 36 routes match pre-section `66104fe` syntax/types/exports/literals/comments/emitted runtime. Verbs/paths, Zod schemas/default order, response bodies/statuses/headers/cookies/caching, current membership/roles, CSRF/origin checks, loopback/default-off gates, streaming limits, machine scopes, dispatch/SQL/binding/effect order, permanent replay and uncertainty semantics are unchanged.

The pinned formatter initially refused the Clover callback because its first and second output differed. The formatter wrote no files; the following blank-line step ran despite that refusal, and the initial check attempt passed 23 suites then stopped at format-check exit 1. That partial attempt and a reproduced formatter refusal are retained under `.sites-runtime/readability/S13/initial-format-refusal/` and `formatter-refusal.log`. Two explicit callback formatting passes each preserved complete syntax/type/literal/runtime signatures and reached a stable result; independent Prettier debug-check then passed. The formatter configuration/implementation/refusal checks were not changed. The full section was subsequently formatted and independently compared to the original commit.

Ten planned and thirteen additional focused suites passed before editing; the final combined command passed all 23 suites, including anonymous/wrong-company/forbidden-role, audit-failure credential responses, malformed waste JSON, recovery fences, CSRF and machine denial cases. Full `pnpm test` passed all 139 suites. Scoped lint exited 0 with the inherited workspace `samples` unused-import warning. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build, `local:setup`, worktree-only `db:migrate:local`, loopback `test:local` and diff check passed against frozen source. The smoke uses fictional worktree state and proves forged-header/anonymous/tenant/CSRF/default-off behavior; no owner or remote database is used. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S13`; logs: `.sites-runtime/readability/S13/`.

Commits are grouped by identity/integrations, inventory/sales/waste and purchasing/cart/worker boundaries. **Remaining hold:** absent delivery API plus its receiving contract/service/schema/UI/tests; authorization-wrapper handoff remains recorded in S05. No behavioral API change or new schema was made. S14 can independently review the vendored UI primitives unchanged. Rollback: these three source/docs commits only.

## S14 — Shared UI primitives and vendor boundaries

Status: Completed. Depends on: S13.

**Files:** `src/components/ui/**`, `src/hooks/use-mobile.ts`; vendor CSS/assets are reviewed in S18.

- [x] S14.1 — Verify the shadcn provenance and existing ESLint exceptions. These sources are vendored verbatim: review and retain their bytes rather than applying a blanket formatter.
- [x] S14.2 — Inventory usage, exports, aliases and composition patterns so owned components can use them consistently.
- [x] S14.3 — Document any apparent duplication or naming issue as an upstream/vendor limitation; do not fork, rename or replace primitives during cleanup.

**Verification:** Verify baseline hashes, exports and licensed headers, then typecheck/build and relevant lint under the existing vendor exceptions. A completed review can explicitly say unchanged; it must not claim vendor formatting occurred.

- [x] S14.V — Record protected-file baseline hashes and exact frozen review verification; inspect interface consumers and the documentation-only diff.
- [x] S14.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All 61 UI primitive modules and the mobile hook reviewed as protected vendor sources. Repository `eslint.config.mjs` identifies shadcn@4.17.0 and records three scoped exceptions; `components.json` identifies new-york/RSC/TSX aliases. The interface/dependency/directive/hook/consumer inventory covers all 62 files and 348 ordered export names. Nine primitive modules are imported directly by owned Pantrack code; internal registry composition remains separate. Button/Input/Table/Select/dialog/sheet composition and sidebar/mobile state boundaries were inspected. No independent upstream registry comparison is claimed.

Every file retains its original baseline byte hash, including comments, headers, DOM/ARIA/text, classes, hooks and exports. Vendor double-quote/semicolon conventions remain an explicit exception to owned-source formatting. Similar wrappers, Slot/asChild patterns and unused registry components were retained; deleting or consolidating them would fork the registry or alter available public exports. No vendor code was formatted or reorganized.

The baseline hashes and current frozen-source review passed: `pnpm test code-readability` (one suite), scoped ESLint for all 62 files under the unchanged vendor exceptions (exit 0, no diagnostics), `pnpm typecheck`, `pnpm build` and `git diff --check`. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S14`; interface/usage and byte-preservation receipts: `.sites-runtime/readability/S14/`. No visual instruction or source changed, so no visual walkthrough or repeat domain full suite was needed; the S13 139-suite result remains separate evidence.

Commit: `docs(readability): record protected shared UI review`. No S14 hold remains. Rollback affects this review/tracking commit only. Next: S15 owned pages and workspace shell, with the receiving-owned employee shell still held.

## S15 — Application entrypoints, identity pages and workspace shell

Status: Blocked for receiving shell, JSX children and source-wiring holds; 12 files verified. Depends on: S14; S05/S13 contracts.

**Files:** `src/app/` non-API TS/TSX files, auth/callback/signout/invite pages, workspace/company/employee shells, members panel, navigation/theme and shared task forms assigned in the inventory.

**New S15 hold:** `members-panel.tsx` stays byte-identical because formatting splits existing JSX text into additional React children. The guard refused before writes; a later manually verified JSX-preserving cleanup is needed. Twelve other present candidates remain safe; employee shell remains separately held for receiving. `workspace.tsx` was restored unchanged after `spending-limits-screen` refused three exact source spellings. No test or verifier was changed.

- [!] S15.1 — Safe page/portal JSX and state declarations expanded with directives preserved. Members-panel JSX and workspace source-pin cleanup remain Blocked; employee shell remains receiving-owned.
- [!] S15.2 — Company changes/dirty prompts, theme and navigation definitions verified. The source-pinned main shell remains unchanged and Blocked for later compatible cleanup.
- [x] S15.3 — Preserve component/export/prop names, DOM structure and text, accessibility attributes, event order, local-storage keys, hooks and effect dependency arrays.
- [x] S15.4 — Extract owned presentational helpers only when it demonstrably preserves state ownership and lifecycle; do not restructure routes or change UI behavior to satisfy lint.

**Focused command:** `pnpm test m2-security local-auth stock-entry spending-limits-screen`.

**Verification:** Run relevant UI/auth regression suites and full tests where shell behavior is touched, scoped lint, typecheck/build and isolated HTTP smoke. Preserve JSX text nodes; any potentially visible change requires a local visual comparison or stays Blocked.

- [x] S15.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S15.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** All present source read before edits. Eleven safe files formatted and five whitespace-only declaration boundaries retained; the small authentication compatibility re-export was reviewed unchanged. Page/auth JSX, company selection/dirty prompts, theme/navigation/task forms and portal requests/forms are easier to scan. State ownership and hook lifecycles remain in their original components; no presentational extraction or new abstraction was introduced.

The twelve safe modules match pre-section `4886133` complete types/syntax/comments/literals/emitted runtime and JSX children. Directives, metadata, DOM/text/classes/ARIA, handler/prop/key order, effect dependencies, storage keys, invitation fragments/redirects and company state remain unchanged. All three held sources retain baseline bytes.

**Explicit holds:** `members-panel.tsx` was refused before writes because formatting splits existing text such as `Role ` into extra adjacent React string children. `workspace.tsx` was restored after the full suite refused three exact source spellings in unchanged `tests/spending-limits-screen.mjs`; a local formatter-annotation candidate did not preserve all three and was discarded. No test/verifier was weakened, no annotation remains in source, and both files require later manually verified preservation work. `employee-workspace.tsx` remains separately held for receiving integration/handoff.

The initial formatter refusal and the incomplete full run (focused/format/typecheck passed, inherited lint failed, full suite stopped at the screen source pin) are retained under `.sites-runtime/readability/S15/`. Three focused suites passed before edits; the final focused command adds `spending-limits-screen` and passes all four. After restoring the held shell, full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build, worktree-only `local:setup`/`db:migrate:local`/loopback `test:local` and diff check passed against frozen source. **Scoped lint exited 1 with 6 errors/3 warnings**, matching the integrated baseline by file/rule/message for the safe selection. No suppression, hook-dependency or navigation change. Exact final commands/results/log hashes/source digest: inventory `sectionReviews.S15`.

No visible instruction/runtime changed in the safe sources, so no browser/pixel walkthrough ran. All evidence is local/macOS with fake providers or isolated loopback state. Commits group pages/forms and company portal/preferences. Rollback: those two source/docs commits only. S16 can independently review stock/recipe/waste/POS components against unchanged shell props; it does not depend on resolving the three held files.

## S16 — Inventory, recipes, waste and POS workspace components

Status: Blocked for ten JSX-child-preservation holds; four safe files verified. Depends on: S15; S06/S07.

**Files:** Stock/inventory layouts and panels, recipe builder/list/modifiers, waste recorders, sales exceptions, register setup/provider/status and Clover components assigned in the inventory.

**Preflight holds:** Ten modules remain byte-identical because the unchanged guard refuses formatting that changes React text-child boundaries. Four safe candidates are `inventory-layout.tsx`, `recipe-builder.tsx`, `register-provider.tsx` and `waste-recorder.tsx`. Exact per-file refusals are recorded in the inventory and `.sites-runtime/readability/S16/candidate-review.json`.

- [!] S16.1 — Safe inventory layout, recipe builder, register provider and waste recorder expanded. Ten other JSX-changing candidates remain Blocked unchanged.
- [x] S16.2 — Separate local request adapters, pure display transforms and event handlers visually; replace cryptic local names only within proven scopes.
- [!] S16.3 — Safe forms reviewed without extraction, key/ref/input/state change. Deep cleanup of the ten held components remains Blocked by strict JSX-child preservation.
- [x] S16.4 — Document stale-response and retry guards and preserve current markup, labels, CSS classes, loading/error states, company isolation and exact quantity input behavior.

**Focused command:** `pnpm test stock-entry stock-pack-units inventory-sales waste-recording menu-waste clover-connection pos-register-status`.

**Verification:** Run listed contracts/UI regressions, scoped lint, typecheck/build and full tests for state/helper changes. Compare JSX text/structure and preserve existing desktop/mobile/keyboard behavior. Do not auto-fix hooks.

- [x] S16.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S16.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Four safe modules read fully and formatted: `inventory-layout.tsx`, `recipe-builder.tsx`, `register-provider.tsx` and `waste-recorder.tsx`. Two whitespace-only declaration boundaries separated. Recipe model/review/request/save and register/waste load/intent/pending/recovery stages are easier to scan. Existing comments explain preference recovery, pending-save scope and server timing. No new comment, helper extraction or abstraction was introduced.

All four match pre-section `8bf4d7d` complete types/syntax/comments/literals/emitted runtime and JSX children. DOM/text/classes/ARIA/props/keys, hooks/effect dependencies/event order, exact quantity strings, atomic recipe versions/request UUIDs, frozen retry bodies, offline/unknown outcomes, browser storage keys, server-relative waste time and once-only register credentials are unchanged.

**Ten explicit holds:** Clover connection, exact inventory, legacy inventory, menu-waste recorder, POS status, recipe list/modifiers, sales exceptions, register setup and stock-entry candidates change React text-child boundaries under the formatter. The unchanged guard refused them during preflight, before source writes. Each retains its baseline byte hash and remains Blocked for later manually verified JSX-preserving cleanup. No cleanup or deep manual implementation audit is claimed for those held sources. Exact candidates/refusals and final equivalence receipts: `.sites-runtime/readability/S16/`.

All seven focused suites above passed before and after; full `pnpm test` passed all 139 suites. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. **Scoped lint exited 1 with one error/three warnings**, matching the integrated baseline by file/rule/message for the safe selection; no suppression, hook-dependency or state-behavior change. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S16`. No visible instruction/runtime changed in safe files, so no browser/pixel walkthrough ran; this is local/macOS fake-provider evidence only.

Commits group recipe/layout and register/waste flows. Rollback: those two source/docs commits only. S17 can independently review purchasing/cart/document components against unchanged inventory/POS interfaces; all ten holds remain explicit.

## S17 — Purchasing, cart, spending and document workspace components

Status: Blocked for receiving, JSX children and source pins; eight safe files verified. Depends on: S16; S08–S12.

**Files:** Remaining purchasing workspace components and client/editor models: purchase-order drafts/downloads/history, supplier registry, durable cart, spending limits, supplier confirmation, manager/A8 reviews, vendor automation, payment methods and product catalog.

**Preflight holds:** Eight existing modules remain unchanged after strict JSX-child refusal; spending limits is also source-text pinned. Three receiving-owned UI files remain held separately. Eight safe modules continue; exact per-file reasons are in the inventory and `.sites-runtime/readability/S17/candidate-review.json`.

- [!] S17.1 — Eight safe components/models/clients expanded. Eight JSX-changing/source-pinned modules and three receiving-owned files remain Blocked unchanged.
- [x] S17.2 — Clarify request identity, pending/disposed continuation guards, cancellation, revision changes and refresh behavior.
- [x] S17.3 — Document how draft editor models and transport clients protect unsaved data, role changes and expected versions.
- [!] S17.4 — Safe source prompts/labels, totals, DOM/classes/keys/hooks, provenance and purchasing controls verified unchanged. Strict JSX/source-pin and receiving UI handoffs remain Blocked.

**Focused command:** `pnpm test purchase-order-downloads purchase-order-history-downloads purchase-order-history-products purchase-order-history-dates spending-limits-screen po-cart-manager-client po-cart-confirmations`.

**Verification:** Run focused lifecycle/client/screen suites, scoped lint, typecheck/build and full tests for extracted helpers. Preserve cancellation/revocation/unsaved-data tests and visual equivalence; no checkout or supplier access.

- [x] S17.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S17.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Eight safe modules fully read and formatted: cart preview, manager operations, catalog, saved/history download controls, durable-cart intent client, purchasing client/money helpers and the draft editor model. Twenty-one whitespace-only declaration/method boundaries separate schemas/types/requests/editor projections/handlers. Similar money helpers retain their distinct accepted inputs and messages; no generic abstraction or component extraction was introduced.

All eight match pre-section `7ac5be2` complete types/syntax/comments/literals/emitted runtime and JSX children. DOM/text/classes/ARIA/props/keys, hooks/effect dependencies/event order, actor/company/order storage scope, permanent request UUIDs and matching acknowledgments, strict parsing, unknown outcomes, snapshot/registry revisions, exact money, cancellation/disposal/controller refs, formats/provenance and human purchasing controls are unchanged. Submission/checkout remains disabled.

**Eleven explicit holds:** eight existing candidates change React text-child boundaries: A8 review/saved reviews, payment methods, PO drafts, purchasing suppliers, spending limits, supplier confirmation and vendor automation. Spending limits also has existing source-text pins in `spending-limits-screen.mjs`. All remain byte-identical. The receiving-owned durable-cart component stays byte-identical; two delivery additions remain absent. No cleanup or deep manual audit is claimed for held implementations. Per-file refusals/equivalence receipts: `.sites-runtime/readability/S17/`.

All seven focused suites above passed before and after; full `pnpm test` passed all 139 suites, including the draft editor reconstruction/difference/exact-cents assertions in `purchase-order-review`. Format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. **Scoped lint exited 1 with one error/two warnings**, matching the integrated baseline by file/rule/message for the safe selection. No suppression or hook/state behavior change. Exact commands/results/log hashes/source digest: inventory `sectionReviews.S17`. No visible instruction/runtime changed in safe sources, so no browser/pixel walkthrough ran; local/macOS fake-provider evidence only.

Commits group editor/transports, download lifetimes and preview/catalog/operations. Rollback: those three source/docs commits only. S18 can independently review styles/static/vendor assets without changing the held UI contracts; all eleven holds remain open.

## S18 — Owned styles, static site, standalone previews and assets

Status: Blocked for visual comparison and receiving CSS; 19 safe files verified. Depends on: S15–S17.

**Files:** `src/app/globals.css`, workspace CSS, `sites/coming-soon/`, `previews/c4-order-draft/`, public assets, fonts and `vendor/`.

**Visual holds:** Ten owned CSS and three HTML files parse and retain baseline hashes. Their formatting is held because this task has no authorized real-browser desktop/mobile comparison. Preview TypeScript/config and review-only assets continue independently; receiving CSS stays absent/held.

- [!] S18.1 — CSS syntax/ordered structure inventoried with baseline bytes intact. Formatting of ten owned CSS files remains Blocked pending visual comparison.
- [!] S18.2 — Preview/config cleanup and static links/SVG/XML/assets review verified. Three HTML formatting candidates remain Blocked pending visual comparison; their bytes and copy/DOM remain intact.
- [x] S18.3 — Preserve vendored styles, font files, icons, sample CSV, licensing and generated assets byte-for-byte; record their reviewed-unchanged disposition.
- [!] S18.4 — Existing PostCSS and HTML/XML parsers validate syntax/references; no unsupported CSS/HTML equivalence claim. Retain all visual holds and absent receiving CSS unchanged.

**Focused command:** `pnpm test supplier-order-draft-pdf supplier-order-draft-xlsx purchase-order-documents purchase-order-history-documents stock-entry`.

**Verification:** Run document/style consumer tests, scoped lint where supported, typecheck/build and parser/asset comparisons. Any owned CSS/HTML change needs local desktop/mobile visual verification; if that cannot be safely obtained, retain the source and record the hold. No Sites or Cloudflare deployment.

- [x] S18.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [x] S18.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Six preview/config modules fully read: fixture construction, DOM review/copy/download, PDF/Excel adapters, font declaration and static Wrangler configuration. Five formatted and seven whitespace-only declaration boundaries separated; the declaration file was already readable. Thirteen other safe assets/licensing/static instruction files reviewed unchanged. No source extraction, new dependency or serving/deployment behavior was introduced.

All six modules match pre-section `fe15164` types/syntax/comments/literals/emitted runtime or complete JSONC property order/values. DOM text/classes, event and generation guards, async cancellation, snapshot comparisons, exact quantities/warnings, metadata/layout projections, filenames/MIME/URL cleanup and static configuration values are unchanged. The other 26 present styles/static/assets/license files retain baseline bytes; both Noto copies match the documented SHA. Font/license/vendor/icon/sample/header/robots/sitemap provenance is retained.

PostCSS parsed all eleven CSS sources without rewriting them; ordered structure/at-rules/comments are retained in the review receipt. XML/SVG, all local static asset/anchor references and both README relative links pass. **Thirteen visual holds:** ten owned CSS files and three HTML files would change under formatting and remain Blocked pending separately authorized desktop/mobile visual comparison. No visual rewrite, CSS/HTML cleanup or deep hand audit is claimed. Receiving `deliveries.css` remains absent and held. These sources are not silently skipped.

All five focused suites above passed before and after; full `pnpm test` passed all 139 suites with independent native PDF/Excel readers. Scoped lint (no diagnostics), format/equivalence, typecheck, `db:check` (40 unchanged migrations), build and diff check passed against frozen source. A separate in-memory standalone preview bundle, using exactly the existing launcher build options, passed with three browser outputs; its server was not executed. Exact commands/results/log hashes/source digest and additional asset/style/link/bundle receipts: inventory `sectionReviews.S18`; logs: `.sites-runtime/readability/S18/`.

No actual visual/runtime instruction changed in safe files, and no browser/pixel walkthrough, static deployment, DNS/TLS operation or external service ran. Evidence is local/macOS only. Commits group the preview/export adapters and static config/review. Rollback: those two source/docs commits only. S19 can independently clean up test code against these unchanged style/static/asset contracts; visual and receiving holds remain open.

## S19 — Test harnesses, domain suites and fixtures

Status: Pending. Depends on: S01–S18; sections use their existing tests before this cleanup stage.

**Files:** All `tests/*.mjs`, `tests/helpers/**`, and `tests/fixtures/**`.

- [ ] S19.1 — Clean shared test adapters and fixture setup before their dependent suites, keeping suite order and generated-module isolation.
- [ ] S19.2 — Organize suites by arrange/act/assert scenario blocks and use descriptive local names; preserve all assertions, data, fake providers and negative cases.
- [ ] S19.3 — Retain deterministic barriers and clocks; never replace race tests with sleeps or helper-only assertions. Preserve independent audit and document readers.
- [ ] S19.4 — Review format-sensitive source assertions without weakening what they prove. Do not delete tests, broaden tolerances or add platform skips to make cleanup pass.
- [ ] S19.5 — Keep serialized lifecycle evidence fixtures unchanged, and keep the owner’s delivery suite Blocked until handoff.

**Verification:** Run `pnpm test` in full, typecheck, build and scoped lint. Count actual executed/skipped suites, validate fixture hashes and ensure no assertion/authorization case was lost. Record platform limitations precisely.

- [ ] S19.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S19.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S20 — Operational CLIs, lifecycle diagnostics, shell and Python audits

Status: Pending. Depends on: S19; S01/S11 runtime boundaries.

**Files:** All remaining `scripts/**` entrypoints, preview/fixture/HTTP tools, gate/preflight/cleanup/investigation controllers and ten Python auditors assigned in the inventory.

- [ ] S20.1 — Review ordinary CLI wrappers first, then Node controllers, then independent Python auditors and shell launchers; keep argument/refusal/env contracts explicit.
- [ ] S20.2 — Explain exclusive consumption, private/durable writes, captured process ownership, source identity, fixed bindings, primary-versus-audit failures and bounded disposal.
- [ ] S20.3 — Format only when injected actual-lifecycle tests and independent audit comparisons prove invariants; keep SQL, regex, process metadata, signal timing and exception categories intact.
- [ ] S20.4 — Preserve Python optimization refusal, Unix-only guards, Windows compatibility, executable shebangs, file modes and shell quoting. Do not adopt a new abstraction for process ownership or retries.
- [ ] S20.5 — Leave byte-pinned or uncertain operational code Blocked. Never update historical proof hashes, bypass source checks, create an allowance, resume a consumed attempt, reclaim locks or run real browser/maintenance/full-gate CLIs for readability verification.

**Focused command:** `pnpm test po-cart-browser-lifecycle po-cart-browser-lifecycle-validation po-cart-shutdown-matrix po-cart-shutdown-observation po-cart-maintenance-lifecycle po-cart-maintenance-audit po-cart-single-instance-maintenance po-cart-launcher-check-lifecycle po-cart-observation-baseline po-cart-full-gate-audit po-cart-preview-cleanup`.

**Verification:** Run isolated/injected lifecycle and auditor suites, full tests, typecheck/build, scoped JS lint, Python parse/AST checks and shell syntax checks for changed scripts. Confirm protected evidence and fixed policy constants remain unchanged; no collected real run is part of cleanup.

- [ ] S20.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S20.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S21 — Documentation, architecture navigation and managed instructions

Status: Pending. Depends on: S20.

**Files:** `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/**`, `public/*.md`, `openspec/**`, `.claude/**` and GitHub instruction/prompt files assigned in the inventory.

- [ ] S21.1 — Provide a concise navigation map for contracts, D1 services, APIs, workspace clients, document engines, workers and tests; prefer links over moving established modules.
- [ ] S21.2 — Check setup/code examples and cross-links for readability and actual paths, while separating current instructions from historical evidence.
- [ ] S21.3 — Preserve historical reports, accepted decisions, source fingerprints, consumed attempts and milestone checkboxes. Do not rewrite past results to reflect the cleanup.
- [ ] S21.4 — Review generated OpenSpec/assistant instructions and licenses as managed sources; retain them unchanged unless a clearly scoped, behavior-neutral documentation edit is justified.
- [ ] S21.5 — Update cleanup records and maintain author-facing guidance without adding new operational approval, integration or purchasing authority.

**Verification:** Run `git diff --check`, validate every changed relative link and review instruction consistency. Historical-evidence hashes must remain unchanged; code examples are checked against current source. Do not archive/sync OpenSpec or change acceptance statuses.

- [ ] S21.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S21.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S22 — Final consistency, preservation review and handoff

Status: Pending. Depends on: All prior sections completed or explicitly documented as Blocked.

**Files:** Entire tracked project, the cleanup inventory, this checklist and all section verification records.

- [ ] S22.1 — Reconcile the file manifest against current `git ls-files`; account for additions, owner handoffs, unchanged reviews and every outstanding hold.
- [ ] S22.2 — Review naming/import/style consistency across owned modules and duplicated responsibilities that remain; document risky improvements rather than expanding into feature work.
- [ ] S22.3 — Review the complete diff for UI/API/schema/security/business-effect changes, secrets, accidental generated artifacts and misleading acceptance claims.
- [ ] S22.4 — Verify each section has a reviewable commit and accurate before/after evidence. Compile final files/improvements/checks/remaining-work/rollback summary.
- [ ] S22.5 — Keep any unsafe or unverifiable cleanup Pending/Blocked, identify the exact unblocker, and report it honestly. Do not declare the whole cleanup complete while unresolved required work remains.

**Verification:** Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build`, isolated `pnpm db:migrate:local`, isolated `pnpm test:local`, final diff/link/manifest/hash checks and the selected format-equivalence checks. Report inherited failures and real platform coverage; no live/paid/full-gate execution.

- [ ] S22.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S22.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## Cleanup execution log

| Date / section | Files and improvements | Checks and outcome | Commit / holds / next |
| --- | --- | --- | --- |
| 2026-10-26 / S00 | Architecture survey; 882-file ownership/hash inventory plus 13 reserved receiving additions; 22 ordered cleanup sections | Planning-only coverage, hash, suite-reference, JSON, link and whitespace checks pass; 0 application edits; concurrent receiving-test change recorded | Documentation-only planning checkpoint; all 22 changed receiving paths held for integration/handoff; next: S01 baseline/tooling |
| 2026-10-26 / S01 | Tooling/config/adapters: 24 existing edits, 14 unchanged, 7 cleanup additions; pinned dev formatter and guarded per-section command | Full pipeline passes except unchanged inherited lint (71 errors/80 warnings); 138 suites; focused/syntax/hash/link checks pass | Local section commit; main advanced independently to 59d3d90, integration checkpoint next; receiving implementation held |
| 2026-10-26 / S02 | Three shared helper modules; consistent spacing/wrapping and two stream/UTF-8 comments | 3 focused suites before/after; guard/format, scoped lint, typecheck/build/diff all pass | Local section commit; next S03; no S02 hold |
| 2026-10-26 / S03 | 25 present models/contracts formatted; 163 declaration boundaries; type-parenthesis guard refinement reproduced and tested | 11 baseline/12 final focused suites; all 139 suites; scoped lint, guard/format, typecheck/db/build/diff pass; 299 ordered exports unchanged | Local section commit; absent receiving contract explicitly Blocked; S04 independent D1/history review next |
| 2026-10-26 / S04 | Two D1 helpers formatted; 40 SQL/40 snapshots reviewed unchanged, including 226 trigger definitions | Four planned baseline/final suites and scoped lint/format/typecheck/db/build/diff pass; wrong initial suite selection retained separately | Local section commit; receiving schema/journal/new migration holds explicit; independent S05 next |
| 2026-10-26 / S05 | Eight identity modules formatted; 32 declaration boundaries; D1 revocation rationale added | Both focused suites/all BUG-01 regressions and full 139 suites pass; format/typecheck/db/build/diff pass; scoped lint retains one inherited warning | Local section commit; authorization wrapper handoff remains Blocked; independent S06 next |
| 2026-10-26 / S06 | 26 domain modules formatted; 77 declaration/method boundaries; two ordered-batch rationale comments | Twelve focused baseline/final suites and full 139 suites pass; equivalence/format/typecheck/db/build/diff pass; scoped lint retains one inherited warning | Three local commits grouped by inventory, waste and replenishment; no S06 hold; S07 next |
| 2026-10-26 / S07 | Fifteen sales/POS/Clover modules formatted; one SQL helper reviewed unchanged; 58 declaration/method boundaries | Ten focused baseline/final suites and full 139 suites pass; equivalent syntax/types/runtime; scoped lint/format/typecheck/db/build/diff pass | Two local commits grouped by core and adapters; no S07 hold; S08 next |
| 2026-10-26 / S08 | Nine supplier/draft/gated-purchasing modules formatted; 111 declaration/method boundaries | Eight focused baseline/final suites and full 139 suites pass; equivalence/format/typecheck/db/build/diff pass; scoped lint retains one inherited any error (exit 1) | Two local commits grouped by persistence and simulated/gated flows; no S08 source hold; S09 next |
| 2026-10-26 / S09 | Thirteen history/document/download/archive modules formatted; 35 boundaries; three font/license hashes preserved | Twelve focused baseline/final suites with independent readers and full 139 suites pass; equivalence/format/typecheck/db/build/diff pass; two inherited scoped lint warnings | Three local commits grouped by reads, rendering/downloads and archive; no S09 hold; S10 next |
| 2026-10-26 / S10 | Three cart authorization/job/spending modules formatted; 71 declaration/method boundaries | Nine focused baseline/final suites and full 139 suites pass; equivalence/format/typecheck/db/build/diff pass; scoped lint retains inherited prefer-const error and unused warning | Two local commits grouped by authorization/spending and jobs; no S10 source hold; S11 next |
| 2026-10-26 / S11 | 28 browser/worker/AI/preview modules formatted; 124 declaration/method boundaries; literal fixture markup/prompts retained | Eighteen focused baseline/final suites and full 139 suites pass; equivalence/format/typecheck/db/build/diff pass; inherited scoped lint 29 errors/4 warnings matched | Four local commits grouped by services, worker ownership, AI/evidence and preview; no S11 hold; independent S12 confirmation next |
| 2026-10-26 / S12 | Present confirmation service formatted; eight declaration/method boundaries; atomic A-owned incoming handoff preserved | Four focused baseline/final suites and full 139 suites pass; scoped lint/equivalence/format/typecheck/db/build/diff pass | Local section commit; absent delivery service remains explicitly Blocked; independent existing-route S13 review next |
| 2026-10-26 / S13 | 36 existing routes formatted; 71 declaration boundaries; policy/response/dispatch contracts retained | 23 focused baseline/final and all 139 suites; scoped lint/format/typecheck/db/build/local setup/apply/HTTP/diff pass; initial formatter refusal and stable equivalent recovery retained | Three local commits grouped by identity/integrations, stock/sales/waste and purchasing/cart; delivery API remains Blocked; independent S14 next |
| 2026-10-26 / S14 | 62 vendor files reviewed unchanged; 348 exports and import/hook/consumer inventory; nine directly used primitive modules | All baseline hashes preserved; guard suite, scoped lint under unchanged vendor exceptions, typecheck/build/diff pass | Documentation-only local review commit; no vendor rewrite or S14 hold; S15 next |
| 2026-10-26 / S15 | Eleven safe page/auth/portal/form/theme/navigation files formatted; one re-export unchanged; five declaration boundaries | Three baseline/four final focused and all 139 suites; equivalence/format/typecheck/db/build/local setup/apply/HTTP/diff pass; scoped inherited lint 6 errors/3 warnings; incomplete source-pin run retained | Two local commits; receiving employee shell, members-panel JSX and workspace source pins remain Blocked; independent S16 next |
| 2026-10-26 / S16 | Four safe inventory-layout/recipe/register/waste components formatted; two declaration boundaries; ten JSX candidates held unchanged | Seven focused baseline/final and all 139 suites; equivalence/format/typecheck/db/build/diff pass; scoped inherited lint one error/three warnings matched | Two local commits; ten JSX-child holds remain Blocked; independent S17 next |
| 2026-10-26 / S17 | Eight safe purchasing/cart/catalog/download/client/editor modules formatted; 21 declaration/method boundaries | Seven focused baseline/final and all 139 suites; equivalence/format/typecheck/db/build/diff pass; scoped inherited lint one error/two warnings matched | Three local commits; eight JSX/source-pin and three receiving UI holds remain Blocked; independent S18 next |
| 2026-10-26 / S18 | Five preview/config files formatted; declaration plus thirteen assets/docs reviewed unchanged; seven boundaries; font/license/static bytes retained | Five focused baseline/final and all 139 suites; scoped lint/format/typecheck/db/build/diff, in-memory standalone bundle, CSS parse/XML/assets/local links/font hashes pass | Two local commits; thirteen CSS/HTML visual and one receiving CSS hold remain Blocked; independent S19 next |

## Final report requirements

The final cleanup report must distinguish completed formatting/organization work, reviewed-unchanged protected files and unresolved holds. Include architecture navigation, per-section commits, test/lint/type/build/migration/HTTP results, actual platform coverage and rollback. A local mocked pass is local evidence only. Do not claim a production, provider or C4 acceptance gate was closed.

### S01 start — 2026-10-26

Main and the planning baseline remain `bb8f339`. The receiving branch is committed and clean at `46f98d7`; its only package change adds `cart:delivery:check`. S01 will preserve that handoff and every runtime version/configuration. Formatter availability: no Prettier/Black/Ruff binary or installed Prettier package found. Evaluating one exact, development-only Prettier pin rather than an ad hoc source rewriter. Baseline checks run before formatting; inherited lint findings will remain separate from regressions.

### Upstream integration checkpoint — 2026-10-26

After S01 commit `dc47f5c`, upstream main `59d3d90` merged without conflict. Its six new files are assigned to S03 (archive contract), S09 (archive service/source adapter), S19 (archive helper/suite), and S21 (historical local evidence, unchanged review only). Three upstream status/navigation documents are recorded against that reference. This imports the accepted feature without changing it; receiving remains independently held. Combined-source typecheck, five focused suites, all 139 suites, 40-migration schema/fresh SQLite check, build, local setup/apply/HTTP smoke, and diff check passed against frozen source. Full lint failed with 71 errors/84 warnings: four unused-variable/import warnings came from the unchanged upstream archive modules/test. Logs are under `.sites-runtime/readability/S01/integration/`; command exits, durations, log hashes and source digest are recorded in the inventory integration entry. No section beyond S01 has started cleanup.

Integration source merge: `f42c790` (upstream ref `59d3d90`). The source is intentionally frozen at that integrated checkpoint for sequential cleanup; later upstream activity will be reconciled at S22 without overwriting active work.
