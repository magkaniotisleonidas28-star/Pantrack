# Readability integration with current main — 2026-10-27

Status: Committed locally in merge `b4208a7`; publication and remote CI are not performed. Workstream: C2 maintainability / merge-owner integration.

## Task contract

Integrate cleanup `6bcfae4` with main `5f9df85` on the isolated branch
`workstream-c/readability-main-integration-20261027`. Preserve current main's
functionality, authorizations, migration history, UI, source assertions and G6
bindings. No feature development, deployment, live/paid services, real browser,
maintenance/full-gate run, private runtime evidence access, push or merge into
main is authorized here.

Completion requires resolved conflicts, a complete refreshed file inventory,
source-preservation evidence, focused and full current local checks, a reviewed
committed merge, and an explicit list of remaining cleanup/CI work.

## Sequential checklist

- [x] Baseline current main and isolate dependencies/state.
- [x] Resolve all 18 conflicts using current main and guarded formatting.
- [x] Refresh inventory and navigation; preserve original receipts as history.
- [x] Run focused/full frozen-source verification and preservation review.
- [x] Commit the verified local integration and hand off without publishing.

## Baseline and resolution evidence

Current main's lint failed before integration. All 17 focused baseline suites
passed. Dependencies were cloned locally from the existing pinned cleanup
installation with APFS copy-on-write; no install or upgrade ran. Local test
state is confined to this new worktree.

All 18 conflicts were resolved from current-main source. Seventeen code files
passed complete syntax/types/comments/literals/emitted-runtime equivalence;
the package manifest retains all main entries plus the previously approved
formatter scripts and exact dev-only Prettier version. Every stable candidate
passed the independent debug check. Whole-tree assessment also checks automatic
merges against current main. No historical gate runs or proof hashes are updated.

## Verification and final handoff

All 158 suites ran and passed on this Mac, with zero platform skips. The 18
focused combined-source suites also passed, after 17 focused suites passed on
main before integration. Typecheck, 45-migration/schema check, build, local setup,
isolated migration apply and HTTP smoke passed. All 19 supported original
section format selections passed; Pending upstream and Blocked files are
excluded explicitly. No Windows/Ubuntu CI or real-browser walkthrough ran.

Full lint fails with exactly **90 errors and 92 warnings**, matching the new-main
baseline by file, severity, rule and message. The cleanup's earlier 71/84
baseline is historical and is not used to judge the integrated branch.

| Command | Exit | Duration |
| --- | --- | --- |
| `pnpm test code-readability ci-migrations ci-check-constraints po-cart-confirmations-api po-cart-over-cap-approval po-cart-deliveries-api po-cart-deliveries po-draft-schedules-api po-draft-schedules replenishment-proposal-origins-d1 replenishment-review-d1 supplier-suggestions document-archive-api document-archive-client document-archive-d1-runtime document-archive-r2-runtime po-cart-full-offline-gate po-cart-full-gate-audit` | 0 | 15.0 s |
| `pnpm typecheck` | 0 | 5.4 s |
| `pnpm test` | 0 | 167.8 s |
| `pnpm db:check` | 0 | 0.6 s |
| `pnpm build` | 0 | 7.4 s |
| `pnpm local:setup` | 0 | 0.2 s |
| `pnpm db:migrate:local` | 0 | 4.7 s |
| `pnpm test:local` | 0 | 3.8 s |
| `pnpm lint` | 1 | 8.4 s |
| `python3 .sites-runtime/readability-integration-20261027/compare-lint.py .sites-runtime/readability-integration-20261027/final/8-lint.log` | 0 | 0.0 s |
| `python3 .sites-runtime/readability-integration-20261027/check-format.py` | 0 | 22.4 s |
| `python3 .sites-runtime/readability-integration-20261027/check-links.py .sites-runtime/readability-integration-20261027/final-links.json` | 0 | 0.1 s |
| `git diff --cached --check` | 0 | 0.1 s |

The frozen code/configuration inventory was staged before checks and unchanged
throughout them. Only the tracker, manifest and this report are declared mutable
outcome records. The source digest is `16e5f4903c618b5ec45003c324fb50317d4bcfbf450c0d6f21569a9c71483c38`.
Exact command/log hashes and the 19 individual format commands are recorded in
`docs/CODE_READABILITY_FILE_MANIFEST.json` under `integrationTask`.
Raw new evidence is under this worktree's
`.sites-runtime/readability-integration-20261027/`; original cleanup evidence
remains under `/Users/peterpsimadas/Desktop/Pantrack-readability-20261026/.sites-runtime/readability/`.
Neither private owner state nor historical gate evidence was accessed.

### Preservation review

Every code/configuration difference from main is compiler-equivalent, except
for the five previously reviewed explanatory comments in three modules, which
were separately accounted for before the same comparison. Whole-tree review
found 433 compiler-equivalent files, three such comment-only files, three
reviewed index/contributor documents, two approved package/lock tooling changes,
and eleven cleanup/integration additions. Another 517 files remain identical
to main. No baseline file is removed or renamed.

All 78 Pending upstream/receiving paths and 43 Blocked paths retain current-main
bytes. All 845 original Completed file hashes match their refreshed inventory.
The schema, all 45 migrations/snapshots/journal, styles, vendor UI, accepted
decisions and historical documents remain identical to main (the documentation
index is an additive navigation exception). File modes are preserved. The
existing runtime dependencies and the entire lockfile after removing only the
approved dev formatter addition are unchanged.

G6 remains bound to the October 27 root and retains October 25 among consumed
roots; the policy, independent Python audit and current source-spelling tests
are preserved. No real gate or maintenance invocation, allowance, historical
hash replacement, integration enablement, purchase or live/paid call occurred.

The original cleanup branch remains clean at `6bcfae4`; the owner checkout
remains clean on main `5f9df85`. A final fetch still reports main `5f9df85`.
This local merge contains both histories, preserves all new-main feature code,
and is ready for the separately authorized publication/CI/merge process.
`main` itself is not modified by this integration task.

### Compatibility, rollback and remaining work

No API contract, feature behavior or new migration is introduced by this task.
Main's already-existing migrations are applied only to the isolated integration
state. Source rollback means abandoning/reverting this integration branch; no
owner checkout reset or private runtime/database cleanup is needed. Reverting
source does not remove the fictional HTTP fixtures in this worktree.

Remote publication/PR and Ubuntu/Windows CI remain unperformed. The 43 safety
holds and 78 Pending readability reviews are follow-up cleanup, not failed
integration checks. No full-codebase cleanup, visual/provider/pilot/production
acceptance, C4/M8 or A8/M7 closure, or historical-cause resolution is claimed.


## Scope of the remaining cleanup

The original S00–S22 reports remain historical evidence for cleanup head
`6bcfae4`. Current-main receiving paths are integrated, so their old integration
holds are resolved. Their readability review and the newer upstream files are
Pending; this merge does not claim to clean those feature implementations.
The 43 original JSX/visual/source-pin/BigInt cleanup holds remain open.
Historical cleanup logs resolve relative to the original cleanup worktree;
new integration logs belong to this integration worktree. No private owner
runtime/database/profile/lock preservation audit is claimed.
