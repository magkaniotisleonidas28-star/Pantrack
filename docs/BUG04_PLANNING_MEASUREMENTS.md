# BUG-04: planning amounts keep their measurement

Date: 2026-10-11. Workstream A5/M3 compatibility and purchasing suggestions.
Scope: [BUG-04 in the fix checklist](CORRECTNESS_SECURITY_FIX_CHECKLIST.md#bug-04--measurement-changes-reinterpret-planning-quantities).
Baseline `6f74236` includes the completed local BUG-02 and BUG-03 fixes above
main `161d08f`. Branch: `workstream-a/bug04-planning-units-20261011`.
Worktree: `work/bug04-planning-units-20261011`. Fixing commit:
`e8cda755ea4deb7159ee556037b61d74aef3a06f`.

## Result

The real management service reproduced a saved recommendation changing from
2 packs to 999 packs when 900 mL of stock and a 2,000 mL target were relabelled
in litres. The regression failed before the fix and passes after it: the target
becomes 2 L, daily use 0.1 L, safety stock 0.2 L and capacity 5 L, with 2 packs
still suggested. Canonical quantities, count cutoffs and recipe/event history
are preserved.

The conversion uses the previous configuration's persisted unit version and
exact rational factors, including a custom measurement revised under the same
identity and label. Target, daily use, safety and capacity convert together.
Absent targets, null values and explicit zero remain distinct. Package changes
alone do not rescale those fields. A conversion requiring more than three
decimal places or exceeding 10,000,000 holds the entire plan for review; it
does not round or partially convert it. Unknown initial legacy measurements
also require review.

Optional `planningUnit` metadata attests the measurement of the compatibility
planning values. `planningReviewRequired` prevents a suggestion. Inventory GET,
legacy purchasing proposal generation and submission share a company-scoped
reader that holds older unmarked records with historical factor changes,
unattested custom measurements, or mismatched labels/attestations. Reading
does not write a repair. Exact preview being disabled does not bypass the hold.
The UI explains the review and hides ambiguous target numbers. Its actual
stage action excludes held records and is disabled when all records are held.

No migration, required request field, external integration or M7 settings
contract changes. Configuration changes continue to invalidate M7 settings
through their existing configuration binding. BUG-06 must be based on this
branch because both fixes edit the management service.

## Checks in this worktree

- Seven original focused suites passed before editing. The first focused
  command included an unsupported `--` argument; the corrected command passed.
- `pnpm test inventory-planning-units`: failed before the fix (999 versus 2),
  passed afterward, including real SQLite migrations/service, both directions
  of curated conversions, custom versions, package-only changes, null/absent/
  zero, unsafe precision/bounds, older records, unknown classification, receipt
  replay, nonempty recipe history, canonical incoming/use and company isolation.
  Actual inventory GET proves the hold and rejects anonymous/wrong-company reads.
- The seven original focused suites plus the new regression passed together.
- `pnpm typecheck`, `pnpm test` (80 suites), `pnpm db:check` (35 migrations),
  `pnpm build`, `pnpm local:setup`, `pnpm db:migrate:local` and `pnpm test:local`
  passed. The served smoke check used only fictional local data.
- An isolated Edge check of the real planning component stages `{milk:2}`,
  disables all-held staging, and stages only the safe item in a mixed list.
  Desktop/narrow views have no script errors or horizontal overflow. Screenshots
  and the fixture harness are ignored under `.sites-runtime`; the API is mocked
  in this UI check. This is not hosted browser evidence.
- `git diff --check` and changed documentation links passed.

## Repair, rollback and next step

No existing real record was repaired or inspected. A historical hold means a
manager must establish physical target, daily use, safety and capacity from
trusted records or enter newly reviewed values in the current measurement.
Unit history alone cannot establish when each old planning number was entered.
Keep the hold until a separately authorized, audited repair records those
values, the current unit/version and expected inventory version together. A
physical count establishes stock; it does not establish planning intent. There
is no new automatic or UI action that clears a historical planning hold.

Repair must use optimistic concurrency, retain event/recipe history, regenerate
proposals and revalidate M7 settings. If original intent cannot be established,
retain the hold. Reverting to code that ignores the hold is unsafe: keep
purchasing paused and forward-fix the compatibility reader/conversion instead.
No remote migration, live provider, deployment, push or main merge was performed.
Next unblocked fix: BUG-05's bounded, authorized recovery action using BUG-02.
