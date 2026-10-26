# C4 history creation-date filters — local evidence

Recorded: 2026-10-26, Windows, workstream C4. Outcome: inclusive From/To calendar
dates shared by the saved-PO history list and complete PDF/Excel exports. This
completes one C4 slice, not C4/C5/M8 or hosted acceptance. The release stays paused.

## Baseline and ownership

The clean root `main` was fast-forwarded from `92e097b` to `2d7e49f`, including
the seven previously merged commits for anonymous-session handling and A's
order-linked incoming-stock port. None changed the date-filter application files.
Work used `work/c4-history-date-range-20261026` and feature commit `64d9578`.
The [existing history filters](C4_PO_HISTORY_FILTERS_LOCAL_EVIDENCE.md) and
[complete exports](C4_FILTERED_HISTORY_EXPORTS_LOCAL_EVIDENCE.md) were reused.

An overlap refresh found [supplier-confirmation PR 17](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/17).
Its application files do not overlap this task. It remains untouched; shared
status/roadmap edits must preserve both outcomes when that work merges.
Unpublished work on another computer cannot be detected by this check.

No schema, migration, dependency, financial policy or company time-zone setting
changed in this feature. All 38 existing migrations, including the newly pulled
incoming-stock migration, were applied only to this task's fresh, fictional local
database. The original root database and hosted database were not migrated.
No provider, supplier, model, checkout or production action ran.

## Contract and behavior

The [shared filter contract](../src/lib/purchase-order-history-contract.ts) adds
optional `from`, `to` and `timeZone` to both read endpoints:

```text
GET /api/purchase-orders?companyId=<company>&from=2026-11-01&to=2026-11-01&timeZone=America%2FNew_York&offset=0
GET /api/purchase-order-history-exports?companyId=<company>&from=2026-11-01&to=2026-11-01&timeZone=America%2FNew_York
```

Dates are real Gregorian `YYYY-MM-DD` values from 1900-01-01 through 9998-12-31.
Either end may be omitted. A supplied range requires an explicit supported zone:
`America/New_York` or `UTC`. A zone without dates, empty/noncanonical/impossible
dates, reversed ranges, duplicate/unknown keys and unsupported zones return 400.
Date filters cannot be mixed with detail, revision or choices reads. Existing
requests without dates preserve their criteria and behavior; no hidden zone is
added to an unfiltered snapshot.

The [date adapter](../src/lib/purchase-order-history-dates.ts) reuses the existing
pure calendar calculation from `spendingWindow`, without reading or changing
limits. Noon UTC belongs to the requested day in both supported zones. From maps
to the first instant of that day; To maps to the first instant of the following
day and is exclusive in SQL. The computation therefore includes both repeated
fall-back hours and handles a 23-hour spring day. It never adds a fixed 24 hours.
Supporting another zone requires a separately tested adapter change.

The [shared SQL predicates](../src/lib/purchase-order-history-sql.ts) bind the
resulting bounds to the original header's `created_at`, before pagination or
export sizing. Later edits/reviews/cancellations do not move a PO to a different
creation-date match. Company owner/manager checks remain in the same statement
as the data read. Existing anonymous, wrong-company, forbidden-role, empty-result,
default-off, size/refusal and private/no-store behavior remains in place.

The [manager form](../src/components/workspace/purchase-order-drafts.tsx) provides
From, To and Date time zone controls, defaulting to New York with UTC selectable.
It explains inclusive/open dates and the original-creation meaning. Applied
date-filtered timestamps display their actual zone, including EDT versus EST.
Apply/Clear reset paging; detail/back preserves criteria. Invalid ranges show
an alert while retaining applied results. Unapplied changes block download.
From, To and zone edits cancel pending exports immediately; existing page,
refresh, navigation and company cancellation continues to apply.

The [export snapshot validator](../src/lib/purchase-order-history-export-contract.ts)
checks each original creation timestamp against these same bounds. The criteria
and zone are included in the immutable fingerprint, and the
[download flow](../src/lib/purchase-order-history-download.ts) carries every
criterion on both authorized reads. A new matching record holds the download;
an unrelated record outside the date range does not invalidate it.

The [formatters](../src/lib/purchase-order-history-documents.ts) show the inclusive
date criteria, zone and exact inclusive-start/exclusive-end instants in PDF and
in both Orders and Lines sheets. All matching pages are still included; existing
exact financial/quantity values, literal spreadsheet cells, canceled labels,
limits and refusal behavior are retained. No export writes business state.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used. All checks ran in this worktree.
Root command logs/reports are in `.sites-runtime/c4-history-date-range-20261026/`.

| Check | Result |
| --- | --- |
| Frozen offline install and fictional local setup | Passed; copied per-worktree dependencies, no package change or copied root secrets. |
| Four existing focused history/export suites | Passed. |
| [New date suite](../tests/purchase-order-history-dates.mjs) | Passed using real producers/SQLite, both route authorization wrappers, loopback HTTP, native document readers and the actual checked download flow. |
| `pnpm typecheck` | Passed with final UI and timestamp formatting. |
| `pnpm test` | 131 suite invocations: 119 executed successfully, twelve explicit Windows skips. |
| `pnpm db:check` | All 38 ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Application Worker/client build passed. |
| `pnpm db:migrate:local` | All 38 existing migrations applied to this task's fresh isolated database; final run found none outstanding. |
| `pnpm test:local` | Ordinary local HTTP smoke passed with preview off. |
| Signed-in local Edge | Nine downloads passed. From page two, PDF/Excel included all 31 matching records; UTC yielded 26, spring day two, canceled one, and refreshed history 32. |
| UI/lifecycle | Reverse-range alerts retain results; open ranges, empty results, Clear, retry, paging reset, detail/back, From/To/zone/navigation/company cancellation, keyboard and 390px/desktop layout passed. No outside requests, page errors or horizontal overflow. |
| Real second reads | A new in-range PO held the download; refresh recovered. A new out-of-range PO remained valid. Role revocation held the file; anonymous/wrong-company/employee reads were refused. |
| Preservation | Every application table stayed unchanged across the read/export/cancellation sequence. Intentional seeds, membership changes and new-match fixtures were checked separately. Preview configuration was restored byte-for-byte. |
| Independent readers | PDF.js/OOXML checks passed on 26 permanent-test records; separate PyMuPDF/openpyxl checks passed on those artifacts and the actual 31-record browser files: 33 PDF pages, 31 Orders rows, 31 Lines rows, exact IDs/statuses/revisions, date/zone/boundary provenance and bounded text layout. |
| Built Worker assets | Actual local production bundle served the date controls, licensed font/license and an anonymous date-export 401 with private/no-store headers. |

The permanent test includes exact start/end millisecond boundaries, both DST
transitions, UTC, leap/century rules, year changes, one-sided dates, original
creation versus later edit events, all-pages matches, combined filters, strict
queries, authorization/default-off guards, snapshot tampering and changed/unchanged
fingerprints. The first new-test attempt exposed an incorrect fixture expectation
that editing replaces `draft.createdAt`; the producer correctly preserves it.
The assertion now verifies the later edit event independently and passed in the
focused rerun and full pipeline.

The browser seeded immutable revisions through the real PO producer with an
injected clock and a native SQLite/D1 adapter, then read/exported them through
the actual signed-in app. Reports, screenshots and files remain in this worktree's
`.sites-runtime/date-history-browser-first/`; built-Worker evidence is in
`.sites-runtime/production-date-history-assets/`. Private fixtures are fictional
and uncommitted. Screenshots and rendered PDF were visually inspected.

## Rollback, limits and next handoff

No blocker remains for this local slice. These checks do not claim hosted,
supplier, sandbox-provider, café pilot or production acceptance, or a fresh G5 run.
This remains current saved-draft history; issued documents, historical revision
archives, confirmation and receiving evidence remain separately scoped.

Rollback can revert `64d9578` or disable the existing preview. There is no date-
filter data or schema repair to perform; preserve the separately merged incoming-
stock and spending-limit work and the in-progress supplier-confirmation PR.

Next unblocked C4 slice: product filtering shared by this same history list and
complete exports. Recheck ownership first. Issued artifact storage and the other
contributor's supplier-confirmation work remain separate; C4/C5/M8 stay open.
