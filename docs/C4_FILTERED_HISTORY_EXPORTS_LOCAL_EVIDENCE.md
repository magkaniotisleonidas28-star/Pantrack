# C4 complete filtered history exports — local evidence

Recorded: 2026-10-25, Windows, workstream C4. One outcome: download all current
saved PO records matching the manager's applied history filters as PDF or native
Excel, across every matching page. C4/C5/M8 remain open. The hosted release is
still paused; no deployment, supplier access, model request or purchase ran.

## Baseline, ownership and integration

Work used `work/c4-filtered-history-exports-20261025`, starting at `47922df`.
The [history filters](C4_PO_HISTORY_FILTERS_LOCAL_EVIDENCE.md),
[authorized single-draft snapshots](C4_SAVED_DRAFT_EXPORT_LOCAL_EVIDENCE.md) and
[signed-in downloads](C4_SAVED_DRAFT_DOWNLOADS_LOCAL_EVIDENCE.md) already existed
and were reused. The feature commit is `4b53c8b`; the integration commit is
`0b2ca5f`, containing upstream `cb3540f`.

The overlap check initially found the other contributor's owner spending-limit
backend in [PR 13](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/13).
During implementation, it and the subsequent
[screen/D1 repair PR 14](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/14)
merged upstream. Their application files do not overlap this export feature.
Both merged cleanly, and their status/roadmap entries are preserved. Shared
documentation is updated after integration. Unpublished work on another computer
cannot be detected by this check.

This feature adds no schema, migration or dependency. The two incoming owner
limit migrations, `0035` and `0036`, were applied only to this task's isolated,
fictional local database for integrated verification. The original root database
and hosted database were not migrated. This does not rerun or extend the
historical G5 acceptance gate.

## Export behavior and contract

The [new GET route](../src/app/api/purchase-order-history-exports/route.ts) uses
the existing default-off preview flag and company purchasing authorization:

```text
GET /api/purchase-order-history-exports?companyId=<company>&q=<text>&supplier=<text>&status=canceled
```

Only owners/managers in the requested company can read financial export data.
The [D1 reader](../src/lib/d1-purchase-order-history-exports.ts) checks current
membership and every matching current revision in one database statement.
It reuses the list's bound, literal substring/status predicates and deterministic
`created_at DESC, id DESC` ordering. There is no page, offset, browser-side crawl
or silent truncation. Duplicate/unknown query keys, invalid criteria and supplied
snapshots are refused. No match returns 404; forbidden membership returns 403.
All responses are private/no-store. Unexpected failures return generic 503 text.

The [history contract](../src/lib/purchase-order-history-export-contract.ts)
limits the complete result to 100 orders, 1,000 lines and 2,000,000 UTF-8 bytes
of saved source data; the projected snapshot also has a 2,000,000-byte limit.
Oversized results return 413 and ask for narrower filters. The SQL returns only
count/size metadata, without snapshot contents, when a source limit is exceeded.
Corrupt or incomplete saved sources fail closed. Exact financial arithmetic,
company/group/proposal identities, status/event consistency and line references
reuse the existing saved-draft validator. Full registry profile contents remain
private. The response contains only document fields and stable version references.

The returned snapshot is copied, deeply frozen and identified by a SHA-256
fingerprint of canonical document content, criteria, statuses and revisions.
This digest identifies the snapshot; authentication remains the server's job.
An optional `expected` fingerprint makes a second read refuse changed matching
content with 409, including a newly matching record. Unrelated records outside
the applied criteria do not change the snapshot. Removed or changed matches
cannot produce a successful stale download.

The [manager controls](../src/components/workspace/purchase-order-history-downloads.tsx)
export the applied criteria, regardless of which page is visible. Unapplied
filter edits block export. The existing resource lifecycle is shared with
single-PO downloads: initial authorized read, generation, second authorized
matching-snapshot read, then the Blob/link handoff. Cancel, filter typing,
paging, list refresh, detail/editor navigation and company/tab changes invalidate
pending work. Duplicate starts are ignored; disposal cannot publish or download.
Busy, retry, explicit holds and refresh recovery are visible. Object URLs and
temporary links are cleaned up after download, including failed handoffs.

The [history formatters](../src/lib/purchase-order-history-documents.ts) reuse
the same validated field projection, PDF layout/font and literal Excel engine.
PDF repeats the history label, snapshot reference and page count; individual
records retain their PO/revision/status, exact values, warnings and notes.
Excel has **Orders** and **Lines** sheets with every matching record, frozen
and filterable headings, filter/fingerprint provenance, and literal text cells.
Unknown estimates remain unavailable and zero remains zero. Canceled records
are explicitly retained as canceled history. Single-draft export still refuses
canceled drafts. No combined purchase subtotal is invented.

This exports current saved draft revisions only. It does not claim a complete
event/revision archive, legacy imported history, issued document storage,
supplier confirmation, final prices, deliveries or receiving evidence. There
are no invented Deliveries/History sheets. Existing PDF character/500-page
limits and Excel Unicode/escape/cell-length limits still refuse the whole file.
Exporting or editing a spreadsheet changes no PO, stock, budget or purchase state.

## Verification

Pinned Node 22.23.2 and pnpm 11.25.0 were used. Command logs and orchestration
reports are in root `.sites-runtime/c4-filtered-history-exports-20261025/`.
The application source remained fixed during integrated checks. The ordinary
test suites use isolated fixtures; the temporary loopback browser app used its
own worktree database. The browser's preview flag was restored byte-for-byte
before the final smoke check.

| Check | Result |
| --- | --- |
| Frozen offline install | Passed; per-worktree copied dependencies. |
| Existing export/history regressions | Seven focused suites passed. |
| Four new history suites | Passed: real SQLite producers, route/authorization wrapper, loopback HTTP, native artifacts and actual download resource lifecycle. |
| Original-base six-command pipeline | Passed; 122 invocations, 110 executable suites and twelve Windows skips; 35 existing migrations. |
| `pnpm typecheck` | Passed on combined source. |
| `pnpm test` | Passed: 128 invocations, 116 executable suites and twelve explicit Windows skips. |
| `pnpm db:check` | All 37 ordered migrations match schema and apply to fresh SQLite. |
| `pnpm build` | Combined application Worker/client build passed. |
| `pnpm db:migrate:local` | Passed; the fresh 35-migration task database accepted incoming `0035`/`0036`; final run confirmed all 37 applied. |
| `pnpm test:local` | Ordinary local HTTP smoke passed with the preview gate restored off. |
| Signed-in app / headless Edge | Passed: eight downloads, 33 matches exported from page two, 27/2/5 filtered subsets, canceled PDF/Excel, transient retry, filter/page/navigation cancellation and changed-match/revoked-role holds. |
| Large real result | Passed: 101 saved drafts returned 413; no partial file; narrower filters recovered. |
| Data preservation | Every application table remained unchanged across the read/export/cancellation sequence; intentional seed/edit/role fixtures were checked separately. |
| UI inspection | Desktop and 390-pixel mobile screenshots, keyboard order and no horizontal overflow passed; no page errors or outside requests. |
| Independent readers | PDF.js/OOXML tests passed on 27 records. Separate PyMuPDF/openpyxl processes passed on those artifacts and the actual 33-record browser downloads: 37 PDF pages, 33 Orders rows and 33 Lines rows. Exact PO IDs, revisions, statuses, digest, layout bounds and literal-cell safety matched. |
| Built Worker assets | Passed against the actual local production bundle: exact licensed font bytes, font license, manager download chunk and anonymous export 401/private-no-store refusal. |

The permanent suites cover
[atomic snapshot limits and consistency](../tests/purchase-order-history-exports.mjs),
[HTTP authorization and errors](../tests/purchase-order-history-export-api.mjs),
[native document contents/layout](../tests/purchase-order-history-documents.mjs)
and [download lifecycle](../tests/purchase-order-history-downloads.mjs).
They include anonymous, wrong-company and forbidden-role cases; revocation just
before the query; exact 100-order/1,000-line boundaries; UTF-8 source-byte limits;
metadata-only over-limit reads; canceled/current/reviewed records; literal SQL-
looking filters; stable and changed fingerprints; mutations after capture;
tampering; real Blob/link/URL cleanup; cancel/dispose and duplicate suppression.
All successful and refused export paths are read only.

Browser reports/screenshots/downloads remain in the isolated worktree's
`.sites-runtime/bulk-history-browser-integrated-first/`. Built-Worker asset
reports use `.sites-runtime/production-history-assets/`. Private fixtures contain
fictional data only and are not committed.

## Limits, rollback and next handoff

Local evidence proves local behavior. No hosted/sandbox supplier, café pilot or
production acceptance is claimed. No issued document was uploaded or stored.
The preview remains default off outside explicit local fixtures. There is no
blocker for this bounded export outcome; C4/C5/M8 keep their remaining gates.

Rollback can disable the preview or revert the export feature while preserving
the separately merged owner-limit work. This feature has no persisted state,
schema rollback or forward repair. Keep supplier submission and purchasing off.

Next unblocked C4 slice: add a creation-date range to this same history filter
contract and its complete exports, using the existing header timestamp. Check
ownership again before starting. Product filters, immutable private issued
artifacts, confirmation/receiving history and supplier execution remain separate.
