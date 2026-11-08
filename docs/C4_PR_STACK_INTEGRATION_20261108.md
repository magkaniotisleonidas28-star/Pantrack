# C4 document PR stack integration — 2026-11-08

Checklist: C4. One integration outcome: inspect every open PR, preserve current
main changes, refresh compatible branches and merge the document stack in order
after current validation. The owner explicitly requested these merges on November 8.
**Outcome: all seven PRs merged into main; no open PR remained at the final merge
audit.** Stack merge `d0cd3d8517cc0e4b9e36cdf6bb664d2998f1c278` has tree
`909701ef02aa85aed4a56bdc55f75249cab58981`, exactly the validated combined tip.

## Reviewed source and merge order

The seven open PRs are one ancestry-ordered stack:

| PR | Outcome | Required predecessor |
| --- | --- | --- |
| [28](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/28) | Status reconciliation | Current main |
| [29](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/29) | Read-only saved-document review | 28 |
| [30](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/30) | Recovery/replacement policy | 29 |
| [32](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/32) | Explicit issued-file checks | 30 |
| [34](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/34) | Original-request continuation | 32 |
| [35](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/35) | Stored preparation evidence | 34 |
| [36](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/36) | Fresh prepared-file checks | 35 |

The initial audit found no textual merge conflicts against either each declared
base or current main `a545d06`. All original heads had successful Windows/Linux
CI. Thirty-six local worktrees were clean. Refreshing the oldest branch from
current main and propagating that updated base through the stack preserved the
exact reviewed automatic merge tree for each PR. Existing commits were retained;
no force-push, blanket conflict resolution or code replacement was needed.
Original branch heads have local `backup/pr-merge-20261108-6c2e914f/pr-N` refs.

Main's G8 paid-run record, availability-evidence rule, G9 outcome and G10 binding
are preserved. Source changes from those merged PRs remain byte-identical; the
status documents combine their evidence with the document features above.
No new feature behavior is introduced by this integration. The new status notes
make the current gate position explicit without rewriting dated local evidence.

## Completed integration evidence

| PR | Merge commit | Refreshed Windows/Linux CI |
| --- | --- | --- |
| 28 | `ccdd6bb` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456528827) |
| 29 | `a56b956` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456528379) |
| 30 | `a16300a` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456528671) |
| 32 | `15eeee5` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456528191) |
| 34 | `ae602be` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456529238) |
| 35 | `3957c74` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456528463) |
| 36 | `d0cd3d8` | [Passed](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/42456528547) |

All fourteen platform jobs passed all six validation steps. Each PR was made
ready, retargeted to main after its predecessor and merged with its exact checked
head SHA. Each resulting tree was checked against the tested PR tree. No branch
deletion, force-push or unreviewed conflict resolution was performed.

The combined local run in `work/c4-prepared-file-check-20261102` passed
`pnpm typecheck`, `pnpm test` (167 selected; 155 executed and twelve existing
Windows POSIX skips), `pnpm db:check` (46 migrations), `pnpm build`,
`pnpm db:migrate:local` and `pnpm test:local`. Source and Git inventory remained
frozen throughout. All 533 changed-document relative links and 22 heading targets
resolved, with all 29 A/B/C states agreeing and acceptance checkboxes unchanged.
Only this completion/status documentation was updated after merging; the tested
runtime source remains identical. Final main push CI is recorded separately.

## Current gate boundary

The [G8/paid record](C4_FULL_OFFLINE_GATE_RUN_20261101.md) and
[G9/G10 record](C4_FULL_OFFLINE_GATE_RUN_20261104.md) supersede older G8-only
handoffs. G9 stopped at step 15 with every final audit passing; its catalog-stage
stall remains unresolved. G10 is the next bound gate, and paid allowances remain
separately controlled. No local G10 preparation root or active local gate process
was present at this integration audit.

The November 8 merge request authorizes this source-integration window. Before
any later G10 invocation, the operator must prepare and freeze the resulting
merged source, including its current migration inventory. Once preparation
begins, preserve the preparation-to-paid-run freeze again. This task does not
invoke a gate, diagnose the catalog stall, create/consume an allowance, contact a
provider/supplier, start paid evaluation, deploy or apply a hosted migration.

## Schema, checks and evidence

The only schema-bearing PR in this stack is 36, with
[migration 0045](../drizzle/0045_prepared_file_checks.sql). Main still ends at
0044, so there is no migration-number collision. The trigger-only migration
retains every table/column and every existing row; its
[handoff](C4_PREPARED_FILE_CHECK_LOCAL_EVIDENCE.md) records SQL, Wrangler splitting,
compatibility and forward-repair evidence. It must precede the matching API/UI
when separately deploying. Merging source does not apply it to hosted databases.

The complete feature tree `2261109` previously passed all six local commands:
167 selected suites, 155 executed and twelve existing Windows POSIX skips, all
46 migrations, typecheck, build, local apply and HTTP smoke. Its Windows/Linux CI
also passed. Those dated results do not substitute for refreshed-source checks.

Before merging, require current Windows/Linux CI on every refreshed PR head and
the complete combined local pipeline (`pnpm typecheck`, `pnpm test`,
`pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local`). Keep
source and Git inventory frozen through that run. Check all changed relative
links and retain all 29 A/B/C states and acceptance checkboxes unchanged.
Verify each merge's head SHA and resulting tree, then check final main CI and
sync the local main checkout. No browser rerun is claimed here: the document
application files retain their earlier tested implementation.

Absolute integration evidence root:
`C:/Users/Leo/Project/Pantrack/.sites-runtime/pr-merge-20261108-6c2e914f`.
The audit, refreshed-head map, source freeze, local command logs, CI snapshots
and merge receipts in that folder record actual results. Current PR checks and
merged states are also available from the links above. Earlier local evidence
remains attached to its original recorded source.

## Rollback and remaining work

Use a scoped revert of the affected merge if a regression appears; retain
dependent history and every audit event. Do not reset data or rewrite a used
migration. Database guard repair, if later needed after application, requires a
new reviewed forward migration as described in the 0045 handoff.

C4/C5/M8 remain open, purchasing remains disabled and hosted release remains a
separate authorization. Formal linked replacement copies still require the
owner-only versus owner/manager authority decision. Do not repeat completed
review, fresh-check or original-request continuation work as a new task.
