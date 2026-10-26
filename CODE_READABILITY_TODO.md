# Pantrack code readability cleanup tracker

Created: 2026-10-26. Workstream: C2 maintainability / merge-owner coordination.
Current outcome: planning and **S01 tooling/configuration are Completed**; upstream integration is verified; **S06 domain services are Completed; S07 is next**.

## Task-management state and overall progress

- Planning goal: complete phases 1–2 and present this plan before application code edits.
- S00 planning: Completed. The complete order was presented before any application code edits.
- Cleanup sections: **3 of 22 Completed; 3 Blocked (S03–S05 receiving handoffs; safe files verified); 16 Pending**.
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
| S07 | Sales ingestion, register bridge and Clover | 16 | Pending |
| S08 | Supplier registry, draft foundations and gated purchasing | 9 | Pending |
| S09 | Purchase-order history, export models and document downloads | 11 + 2 upstream | Pending |
| S10 | Durable cart authorization, jobs and spending limits | 3 | Pending |
| S11 | Browser-session services and worker implementation | 28 | Pending |
| S12 | Supplier confirmation, incoming stock and receiving | 1 | Pending |
| S13 | API routes and server integration boundaries | 36 | Pending |
| S14 | Shared UI primitives and vendor boundaries | 62 | Pending |
| S15 | Application entrypoints, identity pages and workspace shell | 15 | Pending |
| S16 | Inventory, recipes, waste and POS workspace components | 14 | Pending |
| S17 | Purchasing, cart, spending and document workspace components | 17 | Pending |
| S18 | Owned styles, static site, standalone previews and assets | 32 | Pending |
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

Status: Pending. Depends on: S06.

**Files:** `sales-ingestion.ts`, `d1-sales-*`, `import-sales.ts`, `register-*.ts`, `clover*.ts`, `pos-adapter.ts`, `pos-provider-status.ts` as assigned.

- [ ] S07.1 — Make normalize/receive/claim/process/reconcile stages explicit through whitespace, descriptive locals and concise invariant comments.
- [ ] S07.2 — Clarify the bounded two-query keyset scan, timestamp ties, per-ID deduplication, deleted-order evidence and checkpoint refusal.
- [ ] S07.3 — Review provider/token/webhook paths without changing fetch timing, filters, endpoint parameters, timeouts, refresh recovery or error contracts.
- [ ] S07.4 — Preserve exactly-once inventory outcomes, immutable revisions, held unknown mappings/modifiers, ambiguous states, cursor limits and disabled hosted sync. No provider or OAuth call.

**Focused command:** `pnpm test b4-sales-inventory inventory-sales register-bridge clover-connection clover-b6-local clover-pagination sales-ingestion-contract sales-inventory-outcome-recovery sales-recovery-runtime sales-unresolved-readiness`.

**Verification:** Run the listed tests, full suite, scoped lint, typecheck and build. Keep fake fetch and the real migrated domain services; no live Clover/bridge submissions.

- [ ] S07.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S07.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S08 — Supplier registry, draft foundations and gated purchasing

Status: Pending. Depends on: S07.

**Files:** `d1-purchasing-suppliers.ts`, `d1-purchase-order-drafts.ts`, `d1-supplier-simulation.ts`, `supplier-order-draft.ts`, supplier fakes, `purchasing-engine.ts`, `vendor-adapter.ts`, `stripe-payments.ts`.

- [ ] S08.1 — Separate visually the lookup/validation/claim/effect/persistence stages; expand compressed legacy automation handlers and connector parsing.
- [ ] S08.2 — Document immutable draft revisions, supplier/account mappings, exact quotes, guarded external effects, fenced lease release and retained unknown outcomes.
- [ ] S08.3 — Retain public interfaces, integer/string money, budget calculations, request bodies, timeout/error semantics and the unconditional real-submission block.
- [ ] S08.4 — Do not remove apparently unreachable safety paths, replace the supplier connector, provision scheduling, enable automatic mode or call Stripe/suppliers.

**Focused command:** `pnpm test supplier-simulation-contract supplier-simulation-d1 purchasing-suppliers purchasing-suppliers-api purchase-order-drafts purchase-order-api purchase-order-review purchasing-safety`.

**Verification:** Run these tests, the full suite, scoped lint, typecheck and build. Confirm zero real connector calls and unchanged disabled purchasing.

- [ ] S08.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S08.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S09 — Purchase-order history, export models and document downloads

Status: Pending. Depends on: S08.

**Files:** `purchase-order-*` history/export/document/download modules, their D1 adapters, `draft-document-pdf.ts`, `draft-document-xlsx.ts`.

- [ ] S09.1 — Group filtering, pagination, snapshot capture, formatting, serialization and download lifetime code by existing responsibility.
- [ ] S09.2 — Expand date/DST/product matching and PDF/Excel transformations; explain saved-revision provenance, full-result bounds and immutable snapshots.
- [ ] S09.3 — Clarify cancellation, stale continuation suppression, second authorization/fingerprint checks and object URL/download ownership.
- [ ] S09.4 — Preserve field/order/locale/date semantics, file names/MIME types, cell escaping, font handling, archive entries, no-partial-export rules and read-only persistence. No library upgrade.

**Focused command:** `pnpm test purchase-order-history purchase-order-history-products purchase-order-history-dates purchase-order-exports purchase-order-history-exports purchase-order-documents purchase-order-history-documents purchase-order-downloads purchase-order-history-downloads supplier-order-draft-pdf supplier-order-draft-xlsx`.

**Verification:** Run the document/history/lifecycle suites, full tests, scoped lint, typecheck and build. Use existing independent PDF/Excel readers and assert zero export writes.

- [ ] S09.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S09.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S10 — Durable cart authorization, jobs and spending limits

Status: Pending. Depends on: S09.

**Files:** `d1-po-cart-authorizations.ts`, `d1-po-cart-jobs.ts`, `d1-po-cart-spending-limits.ts`; their contract definitions were reviewed in S03.

- [ ] S10.1 — Label and expand authorization/reservation/job/attempt/result phases and their company/account scopes.
- [ ] S10.2 — Document lease fences, first-attempt receipts, ambiguous outcomes, replay identities, atomic reservation transitions and budget exposure.
- [ ] S10.3 — Review helper boundaries conservatively: preserve transaction-time checks, binding and audit order, all conditional SQL and permanent idempotency receipts.
- [ ] S10.4 — Keep public action/state names, credential scopes, unknown-outcome holds, exact caps and cancel/release semantics unchanged.

**Focused command:** `pnpm test po-cart-authorization po-cart-authorizations-api po-cart-persistence po-cart-jobs po-cart-jobs-api po-cart-job-sources po-cart-spending-limits po-cart-spending-limits-api po-cart-spending-limits-reconciled`.

**Verification:** Run the listed races/replay/permission suites, full tests, scoped lint, typecheck, db:check and build. No new allowance or job execution.

- [ ] S10.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S10.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S11 — Browser-session services and worker implementation

Status: Pending. Depends on: S10.

**Files:** `d1-po-cart-browser-sessions.ts`, `d1-po-cart-preparation.ts`, `d1-po-cart-reconciliation.ts`, `po-cart-worker-transport.ts`, the assigned worker client/browser/AI/private-file modules, and `scripts/cart-preview/`.

- [ ] S11.1 — Make claim/heartbeat/preflight/observe/reconcile/report/dispose stages navigable without reordering them.
- [ ] S11.2 — Clarify client retries, local journals, proxy restrictions, captured ownership, private file permissions, credentials and mocked AI budget accounting.
- [ ] S11.3 — Explain SDK/browser adapter boundaries and preserve lazy imports, environment minimality, timeouts, strict verification and denial defaults.
- [ ] S11.4 — Do not move entrypoints, rename protocol symbols, change source-hash inputs, introduce settling/retry behavior, launch browsers or consume any diagnostic attempt. Byte-pinned code is held if equivalence cannot be proved.

**Focused command:** `pnpm test po-cart-worker-api po-cart-worker-guards po-cart-worker-client po-cart-worker-processes po-cart-browser-api po-cart-browser-sessions po-cart-browser-session-api po-cart-browser-network po-cart-reconciliation po-cart-reconciliation-api po-cart-ai-reader cart-preview`.

**Verification:** Run only existing isolated/injected suites, plus full tests, scoped lint, typecheck and build. Fake worker process tests may own temporary fixtures; real browser/maintenance CLIs are not authorized.

- [ ] S11.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S11.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S12 — Supplier confirmation, incoming stock and receiving

Status: Pending. Depends on: S11; S06 inventory receipt ports.

**Files:** `d1-po-cart-confirmations.ts`, plus the committed receiving branch’s `d1-po-cart-deliveries.ts` after integration/handoff. Confirmation/delivery contracts, route and tests have separately identified owners.

- [ ] S12.1 — Clarify manager-entered confirmation checks, immutable supplier references, expected versus received quantities, holds and account-cart release.
- [ ] S12.2 — Explain how A-owned incoming/receipt statements compose into the same D1 batch; keep business effects auditable and idempotent.
- [ ] S12.3 — Keep the receiving-branch delivery service and its consumers Blocked until their integration and owner handoff are reviewed. Re-inventory that committed work before cleanup.
- [ ] S12.4 — Preserve partial-receipt quantities, stock updates, duplicate behavior, actor/permission rechecks and original operation identity. Do not complete or repair the receiving feature as cleanup.

**Focused command:** `pnpm test po-cart-confirmations po-cart-confirmations-api inventory-order-incoming inventory-order-receipts`.

**Verification:** Run confirmation/incoming/receipt tests, full tests, scoped lint, typecheck, db:check and build. Add `po-cart-deliveries` only after its owner handoff and inventory update; never borrow the owner’s dirty database.

- [ ] S12.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S12.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S13 — API routes and server integration boundaries

Status: Pending. Depends on: S05–S12; receiving route remains on hold until its own dependencies are ready.

**Files:** Every `src/app/api/**/route.ts`, including browser company routes, machine transports, callbacks, webhooks, exports, automation and the pending delivery API.

- [ ] S13.1 — Review routes family by family: identity/company/members; inventory/waste/replenishment; sales/register/Clover; purchasing/history/cart; internal worker/browser/machine callbacks.
- [ ] S13.2 — Expand compressed request parsing and response branches, clarify local names and group existing action handlers without changing dispatch order.
- [ ] S13.3 — Keep thin boundaries where already present; extract only route-local pure helpers with meaningful regression coverage. Do not redesign the shared wrapper or merge incompatible error policies.
- [ ] S13.4 — Preserve verbs/paths, schemas, response bodies/statuses/headers, caching, CSRF, body limits, role/tenant checks, machine credentials and pre/post-dispatch uncertainty. Keep the active delivery route Blocked.

**Focused command:** `pnpm test m2-security b4-sales-inventory po-cart-authorizations-api po-cart-jobs-api po-cart-browser-session-api po-cart-worker-api po-cart-confirmations-api purchase-order-export-api purchase-order-history-export-api purchasing-suppliers-api`.

**Verification:** Run every affected API suite and full tests, scoped lint, typecheck, build, then isolated local migration/HTTP smoke for boundary verification. Recheck anonymous/wrong-company/forbidden-role cases; no hosted requests.

- [ ] S13.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S13.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S14 — Shared UI primitives and vendor boundaries

Status: Pending. Depends on: S13.

**Files:** `src/components/ui/**`, `src/hooks/use-mobile.ts`; vendor CSS/assets are reviewed in S18.

- [ ] S14.1 — Verify the shadcn provenance and existing ESLint exceptions. These sources are vendored verbatim: review and retain their bytes rather than applying a blanket formatter.
- [ ] S14.2 — Inventory usage, exports, aliases and composition patterns so owned components can use them consistently.
- [ ] S14.3 — Document any apparent duplication or naming issue as an upstream/vendor limitation; do not fork, rename or replace primitives during cleanup.

**Verification:** Verify baseline hashes, exports and licensed headers, then typecheck/build and relevant lint under the existing vendor exceptions. A completed review can explicitly say unchanged; it must not claim vendor formatting occurred.

- [ ] S14.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S14.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S15 — Application entrypoints, identity pages and workspace shell

Status: Pending. Depends on: S14; S05/S13 contracts.

**Files:** `src/app/` non-API TS/TSX files, auth/callback/signout/invite pages, workspace/company/employee shells, members panel, navigation/theme and shared task forms assigned in the inventory.

- [ ] S15.1 — Expand page JSX and dense state declarations while keeping server/client boundaries and directive prologues intact.
- [ ] S15.2 — Make navigation guards, company changes, dirty-form handling, theme persistence and async shell loading easy to follow.
- [ ] S15.3 — Preserve component/export/prop names, DOM structure and text, accessibility attributes, event order, local-storage keys, hooks and effect dependency arrays.
- [ ] S15.4 — Extract owned presentational helpers only when it demonstrably preserves state ownership and lifecycle; do not restructure routes or change UI behavior to satisfy lint.

**Focused command:** `pnpm test m2-security local-auth stock-entry`.

**Verification:** Run relevant UI/auth regression suites and full tests where shell behavior is touched, scoped lint, typecheck/build and isolated HTTP smoke. Preserve JSX text nodes; any potentially visible change requires a local visual comparison or stays Blocked.

- [ ] S15.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S15.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S16 — Inventory, recipes, waste and POS workspace components

Status: Pending. Depends on: S15; S06/S07.

**Files:** Stock/inventory layouts and panels, recipe builder/list/modifiers, waste recorders, sales exceptions, register setup/provider/status and Clover components assigned in the inventory.

- [ ] S16.1 — First expand the heavily compressed inventory, exact inventory, register, Clover and sales exception components into readable blocks.
- [ ] S16.2 — Separate local request adapters, pure display transforms and event handlers visually; replace cryptic local names only within proven scopes.
- [ ] S16.3 — Review long forms for safe local presentational extraction without changing keys, refs, controlled inputs or dirty/unsaved state.
- [ ] S16.4 — Document stale-response and retry guards and preserve current markup, labels, CSS classes, loading/error states, company isolation and exact quantity input behavior.

**Focused command:** `pnpm test stock-entry stock-pack-units inventory-sales waste-recording menu-waste clover-connection pos-register-status`.

**Verification:** Run listed contracts/UI regressions, scoped lint, typecheck/build and full tests for state/helper changes. Compare JSX text/structure and preserve existing desktop/mobile/keyboard behavior. Do not auto-fix hooks.

- [ ] S16.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S16.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S17 — Purchasing, cart, spending and document workspace components

Status: Pending. Depends on: S16; S08–S12.

**Files:** Remaining purchasing workspace components and client/editor models: purchase-order drafts/downloads/history, supplier registry, durable cart, spending limits, supplier confirmation, manager/A8 reviews, vendor automation, payment methods and product catalog.

- [ ] S17.1 — Expand large components and dense client request/state helpers; group existing edit/review/export/prepare/confirm/reconcile actions.
- [ ] S17.2 — Clarify request identity, pending/disposed continuation guards, cancellation, revision changes and refresh behavior.
- [ ] S17.3 — Document how draft editor models and transport clients protect unsaved data, role changes and expected versions.
- [ ] S17.4 — Preserve prompts, buttons/labels, prices/totals, CSS/DOM, stable keys, hook order and dependency arrays, document provenance and all human purchasing controls. Await receiving UI handoff if introduced.

**Focused command:** `pnpm test purchase-order-downloads purchase-order-history-downloads purchase-order-history-products purchase-order-history-dates spending-limits-screen po-cart-manager-client po-cart-confirmations`.

**Verification:** Run focused lifecycle/client/screen suites, scoped lint, typecheck/build and full tests for extracted helpers. Preserve cancellation/revocation/unsaved-data tests and visual equivalence; no checkout or supplier access.

- [ ] S17.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S17.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

## S18 — Owned styles, static site, standalone previews and assets

Status: Pending. Depends on: S15–S17.

**Files:** `src/app/globals.css`, workspace CSS, `sites/coming-soon/`, `previews/c4-order-draft/`, public assets, fonts and `vendor/`.

- [ ] S18.1 — Review compressed owned CSS in logical blocks; preserve selector text/order, specificity, declaration order, media queries, cascade and all values.
- [ ] S18.2 — Review static HTML/SVG and preview entrypoints without changing copy, DOM/text whitespace, document output or serving/deployment settings.
- [ ] S18.3 — Preserve vendored styles, font files, icons, sample CSV, licensing and generated assets byte-for-byte; record their reviewed-unchanged disposition.
- [ ] S18.4 — Use an existing suitable parser only if CSS/HTML/embedded JS equivalence can be established. Do not prettify sensitive text/inline whitespace blindly or consolidate selectors as a readability shortcut.

**Focused command:** `pnpm test supplier-order-draft-pdf supplier-order-draft-xlsx purchase-order-documents purchase-order-history-documents stock-entry`.

**Verification:** Run document/style consumer tests, scoped lint where supported, typecheck/build and parser/asset comparisons. Any owned CSS/HTML change needs local desktop/mobile visual verification; if that cannot be safely obtained, retain the source and record the hold. No Sites or Cloudflare deployment.

- [ ] S18.V — Record the focused baseline and final verification with exact results; inspect the full section diff and its downstream consumers.
- [ ] S18.R — Perform the dedicated readability/functionality review, update both trackers, and create a reviewable section commit before advancing.

**Section review record:** Files: none yet. Improvements: not started. Verification: not run. Commit: none. Unresolved issues: active-work and protected-file rules above apply; add section-specific findings here.

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

## Final report requirements

The final cleanup report must distinguish completed formatting/organization work, reviewed-unchanged protected files and unresolved holds. Include architecture navigation, per-section commits, test/lint/type/build/migration/HTTP results, actual platform coverage and rollback. A local mocked pass is local evidence only. Do not claim a production, provider or C4 acceptance gate was closed.

### S01 start — 2026-10-26

Main and the planning baseline remain `bb8f339`. The receiving branch is committed and clean at `46f98d7`; its only package change adds `cart:delivery:check`. S01 will preserve that handoff and every runtime version/configuration. Formatter availability: no Prettier/Black/Ruff binary or installed Prettier package found. Evaluating one exact, development-only Prettier pin rather than an ad hoc source rewriter. Baseline checks run before formatting; inherited lint findings will remain separate from regressions.

### Upstream integration checkpoint — 2026-10-26

After S01 commit `dc47f5c`, upstream main `59d3d90` merged without conflict. Its six new files are assigned to S03 (archive contract), S09 (archive service/source adapter), S19 (archive helper/suite), and S21 (historical local evidence, unchanged review only). Three upstream status/navigation documents are recorded against that reference. This imports the accepted feature without changing it; receiving remains independently held. Combined-source typecheck, five focused suites, all 139 suites, 40-migration schema/fresh SQLite check, build, local setup/apply/HTTP smoke, and diff check passed against frozen source. Full lint failed with 71 errors/84 warnings: four unused-variable/import warnings came from the unchanged upstream archive modules/test. Logs are under `.sites-runtime/readability/S01/integration/`; command exits, durations, log hashes and source digest are recorded in the inventory integration entry. No section beyond S01 has started cleanup.

Integration source merge: `f42c790` (upstream ref `59d3d90`). The source is intentionally frozen at that integrated checkpoint for sequential cleanup; later upstream activity will be reconciled at S22 without overwriting active work.
