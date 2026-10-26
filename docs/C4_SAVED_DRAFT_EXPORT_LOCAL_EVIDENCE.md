# C4 saved-draft export snapshot — local evidence

Recorded: 2026-10-24, Windows, workstream C4. Outcome: a read-only,
server-authorized JSON snapshot of the selected current saved purchase-order
revision. This completes the permission/revision foundation for saved-draft
documents. PDF/XLSX generation and buttons in the signed-in app remain separate.
C4/C5/M8 remain open; the owner-deferred online release remains on hold.

## Task contract and delivered behavior

The [document/access plan](PURCHASE_ORDER_ROLLOUT.md#durable-history-documents-and-permissions)
requires company-scoped manager/owner exports. The existing
[saved-draft foundation](C4_PO_FOUNDATION_LOCAL_EVIDENCE.md) and
[immutable editing/review](C4_PO_REVIEW_LOCAL_EVIDENCE.md) already store the
necessary revisions. No schema, migration, dependency or existing API contract
changes were needed.

The new [GET endpoint](../src/app/api/purchase-order-exports/route.ts) accepts
exactly `companyId`, `orderId` and an explicit positive safe-integer `revision`:

```text
GET /api/purchase-order-exports?companyId=<company>&orderId=<draft>&revision=1
```

It uses the existing default-off `PANTRACK_PO_DRAFT_PREVIEW` gate and real
`withCompanyRoute('purchasing', ...)` authorization. Owners and managers may
export; employees, non-members and anonymous callers cannot read financial or
account data. Duplicate/unknown query fields, client-supplied snapshots and
noncanonical revisions are refused. All GET outcomes carry private/no-store,
Pragma no-cache and nosniff headers. POST is unsupported. Responses contain JSON,
not downloadable PDF/XLSX bytes.

The [D1 reader](../src/lib/d1-purchase-order-exports.ts) checks current membership,
the PO header, selected current revision, immutable content and its event in
one SQL statement. Membership revocation, an edit or cancellation committed
before that read is observed. A stale or canceled selection returns 409; no
historical export fallback is attempted. The snapshot is current as of that
atomic read; later changes cannot alter the captured result. This does not
promise that a downloaded document remains the current revision indefinitely.

The [export contract](../src/lib/purchase-order-export-contract.ts) returns
`pantrack.purchase-order-export.v1`, labeled **Draft — no order placed.** It
projects known document fields from saved v1/v2 PO snapshots, validates identity,
source grouping and exact arithmetic, then deeply freezes a copy. It preserves:

- Manual stock and non-stock lines, saved pack sizes, quantities, SKU/description,
  estimates, notes, cap, supplier context and warnings.
- Proposal v1/v2 references, saved conversion/config versions and review reasons.
- Registry supplier/version, stable account/location IDs and line mapping versions.
  The saved supplier pack may differ from the inventory default pack.
- Missing estimates as `null`, zero estimates as zero, and the known subtotal
  with an explicit `pricesComplete` flag. Exact numbers remain decimal strings.
- Current reviewed status and its content revision, reviewer and timestamp.

Internal creator metadata and full registry profile contents are omitted.
Telephone, payment terms, internal instructions and profile notes are not copied
into the response. Ambiguous legacy registry snapshots without stable group IDs,
malformed saved content or inconsistent totals return a generic 503 and require
review. IDs are never guessed from display labels or current supplier records.

The response explicitly warns that stock, mappings and sales readiness have not
been revalidated and prices remain estimates. The reader does not re-plan stock,
approve spending, place an order, reserve inventory, submit a supplier request
or write an audit event. Review/export is not purchase approval.

## Verification

Checks ran in `work/c4-saved-draft-export-20261024`, based on `c24506d`, using
pinned Node 22.23.2 and pnpm 11.25.0. Private logs and scripts are retained under
the main checkout's ignored `.sites-runtime/c4-saved-draft-export-20261024/`.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | Passed using the existing shared package cache and per-worktree copied dependencies. |
| Existing `pnpm test:focused purchase-order-api purchase-order-review` baseline | Both suites passed. |
| `pnpm test:focused purchase-order-exports purchase-order-export-api` | Both new suites passed, including the final real registry mapping/profile-version assertions. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 112 suite invocations: 102 executed successfully and ten explicit POSIX-specific Windows skips. |
| `pnpm db:check` | All 35 ordered migrations match the schema and apply to fresh SQLite. |
| `pnpm build` | Passed, including the new application route. |
| `pnpm db:migrate:local` | All 35 existing migrations applied to a fresh, isolated fictional worktree database. No new migration. |
| `pnpm test:local` | Ordinary local application/HTTP smoke passed with the preview gate off. |
| Enabled real Vinext HTTP check | Real fixture-cookie login, manual draft creation, exact export/repeat, anonymous/forged-header refusal, wrong-company refusal, POST 405, edit/stale selection and cancellation passed. Only fictional local rows were created. The temporary local gate configuration was restored byte-for-byte. |

The [reader tests](../tests/purchase-order-exports.mjs) use actual producers and
SQLite tables. They exercise owner/manager/anonymous/employee/wrong-company
access, invalid input, membership and revision changes immediately before the
single source read, current review metadata, cancellation, immutable copies,
manual/non-stock/proposal/registry sources and corrupt saved content. A quantity
above JavaScript's safe integer range remains exactly `27021597764222979`.
The registry fixture retains its six-unit supplier pack after the profile is
renamed, although inventory's default pack is thirty units.

The [API tests](../tests/purchase-order-export-api.mjs) retain the actual route
and authorization wrapper, injecting only environment, database and identity.
They cover all refusal categories, unavailable identity/database responses,
private errors, headers and loopback HTTP. Repeated exports compare every
SQLite table before/after, and a throwing fetch spy observes zero provider calls.
The separate served check uses the real framework and local fixture session.
Neither is hosted authentication or provider acceptance.

Initial focused runs exposed two test-fixture mistakes: an extra strict review
input field, then a missing `batch` forwarder in the DB proxy. Both fixtures were
corrected before the passing focused and full checks. The final registry test
extension was rerun after the full suite; no application code changed afterward.
The first direct typecheck command lacked Node on its child PATH; the pinned-PATH
runner and subsequent full pipeline passed. Earlier attempts remain retained.

Full diff/security review, `git diff --check` and changed Markdown relative-link
checks passed. No existing application module, migration, provider gate,
credential, customer data or milestone checkbox was changed.

## Handoff, limits and rollback

The next unblocked C4 outcome is to adapt the PDF/XLSX document projection to
this contract, then connect downloads to the signed-in manager's selected saved
revision with loading, changed-selection and recoverable error states. The
existing fictional preview formatters are not yet consumers of this endpoint.
No document artifact or signed-in button acceptance is claimed here.

Canceled/historical documents, issued immutable R2 artifacts, filtered history,
confirmations and receiving remain later outcomes. This snapshot supports only
current draft/reviewed revisions and the existing USD document contract.
Malformed or ambiguous saved sources are held rather than repaired automatically.

The implementation uses a separate worktree/branch from the concurrent C4 gate
work. Its new API/reader/contract/test files do not edit that contributor's gate
scripts. Shared status/roadmap paragraphs require normal merge coordination;
adding source changes to a frozen gate candidate requires fresh preparation.
No other contributor's branch or PR was merged by this task.

Rollback is a code revert of the route, reader, contract, focused tests and
documentation. There is no schema or business-data repair. The fresh worktree
contains only fictional setup/smoke rows. No hosted migration, deployment,
supplier/model execution, real cart gate, historical browser cleanup or purchase
was performed. Supplier submission and automatic purchasing remain disabled.
