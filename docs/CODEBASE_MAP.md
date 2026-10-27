# Pantrack codebase map

Use this map to find the implementation of a workflow. Use
[current status](CURRENT_STATUS.md) and the [roadmap](PANTRACK_MILESTONES.md) to
determine its acceptance level. A source file or passing local test does not
establish a working live integration. C4/M8 and A8/M7 remain open; this cleanup
does not change those gates.

## Repository layout

| Location | Responsibility |
| --- | --- |
| [`src/app/`](../src/app/) | Vinext pages, application layout, authentication screens, and HTTP routes. |
| [`src/components/workspace/`](../src/components/workspace/) | Company workspaces, task forms, workflow panels, local UI state, and request adapters. |
| [`src/components/ui/`](../src/components/ui/) | Shared UI primitives; preserve vendor provenance and styling when editing. |
| [`src/lib/`](../src/lib/) | Domain contracts, calculations, services, D1 adapters, integration boundaries, and document engines. |
| [`src/db/`](../src/db/) and [`drizzle/`](../drizzle/) | D1 binding access, Drizzle schema, additive SQL migrations, snapshots, and journal. |
| [`scripts/`](../scripts/) | Development/build/test wrappers, fixture and preview tools, worker commands, and operational diagnostics. |
| [`tests/`](../tests/) | Isolated domain/API/migration/lifecycle suites, shared fakes, independent readers, and evidence fixtures. |
| [`previews/c4-order-draft/`](../previews/c4-order-draft/) | Standalone fictional draft and PDF/Excel review assets. |
| [`sites/coming-soon/`](../sites/coming-soon/) and [`public/`](../public/) | Separate static site, public integration guides, fonts, and application assets. |
| [`.github/`](../.github/) | CI, review template, and managed assistant integration. |
| [`openspec/`](../openspec/) | Managed change proposals, designs, specifications, and task records. |

## Follow a request

The workspace sends a company-scoped request to an API route. Server-side identity,
origin, company membership, and action checks govern access. The route validates
its input and calls a service; domain contracts and D1 statements define the
allowed transition. The response updates the initiating workflow's local UI state.
Machine ingestion and worker endpoints use their own scoped credentials.

| Layer | Start here | Read alongside it |
| --- | --- | --- |
| Application entry and workspace selection | [`src/app/page.tsx`](../src/app/page.tsx), [`company-portal.tsx`](../src/components/workspace/company-portal.tsx) | [`workspace.tsx`](../src/components/workspace/workspace.tsx), [`employee-workspace.tsx`](../src/components/workspace/employee-workspace.tsx), [`workspace-navigation.ts`](../src/components/workspace/workspace-navigation.ts) |
| Identity, sessions, recovery, and membership | [`auth.ts`](../src/lib/auth.ts), [`auth-session-fence.ts`](../src/lib/auth-session-fence.ts), [`memberships.ts`](../src/lib/memberships.ts) | [Authentication decision](decisions/0001-m2-authentication.md), [`tests/m2-security.mjs`](../tests/m2-security.mjs) |
| Company authorization and route permissions | [`authorization.ts`](../src/lib/authorization.ts), [`company-access.ts`](../src/lib/company-access.ts) | [`src/app/api/`](../src/app/api/), [`auth-availability.ts`](../src/lib/auth-availability.ts) |
| Database binding access | [`src/db/index.ts`](../src/db/index.ts), [`src/db/raw.ts`](../src/db/raw.ts) | [`schema.ts`](../src/db/schema.ts), [`drizzle/meta/_journal.json`](../drizzle/meta/_journal.json) |

The authorization wrapper is shared infrastructure. A readability edit there must
preserve malformed-input handling, post-dispatch uncertainty, and committed
responses. Client-selected company IDs and roles never replace server checks.

## Find a domain workflow

Naming is intentionally consistent: `*-contract.ts` defines validated inputs,
states, and ports; `d1-*.ts` implements persistence and transitions; matching API
routes and workspace panels expose the workflow. Some older modules predate
this convention. Follow their imports rather than renaming them during cleanup.

| Workflow | Domain and persistence entrypoints | UI, API, or verification entrypoints |
| --- | --- | --- |
| Stock, quantities, recipes, and counts | [`inventory-quantities.ts`](../src/lib/inventory-quantities.ts), [`inventory-management-contract.ts`](../src/lib/inventory-management-contract.ts), [`d1-inventory-management.ts`](../src/lib/d1-inventory-management.ts), [`d1-recipe-publisher.ts`](../src/lib/d1-recipe-publisher.ts) | [`inventory-layout.tsx`](../src/components/workspace/inventory-layout.tsx), [`recipe-builder.tsx`](../src/components/workspace/recipe-builder.tsx), [`tests/inventory-management-contract.mjs`](../tests/inventory-management-contract.mjs) |
| Waste and menu waste | [`waste-contract.ts`](../src/lib/waste-contract.ts), [`d1-waste.ts`](../src/lib/d1-waste.ts), [`menu-waste-contract.ts`](../src/lib/menu-waste-contract.ts), [`d1-menu-waste.ts`](../src/lib/d1-menu-waste.ts) | [`src/app/api/waste/`](../src/app/api/waste/), [`waste-recorder.tsx`](../src/components/workspace/waste-recorder.tsx), [`tests/waste-recording.mjs`](../tests/waste-recording.mjs) |
| Register, CSV, and durable sales | [`pos-adapter.ts`](../src/lib/pos-adapter.ts), [`sales-ingestion.ts`](../src/lib/sales-ingestion.ts), [`d1-sales-event-store.ts`](../src/lib/d1-sales-event-store.ts), [`d1-sales-runtime.ts`](../src/lib/d1-sales-runtime.ts) | [`src/app/api/register/ingest/route.ts`](../src/app/api/register/ingest/route.ts), [`src/app/api/sales/`](../src/app/api/sales/), [`tests/sales-ingestion-contract.mjs`](../tests/sales-ingestion-contract.mjs) |
| Clover connection, pagination, and webhook receipt | [`clover.ts`](../src/lib/clover.ts), [`clover-sync.ts`](../src/lib/clover-sync.ts), [`clover-webhook.ts`](../src/lib/clover-webhook.ts) | [`src/app/api/clover/`](../src/app/api/clover/), [`tests/clover-pagination.mjs`](../tests/clover-pagination.mjs), [Clover setup](../public/clover-setup-guide.md) |
| Replenishment proposals and reviewed stock commitments | [`replenishment-proposal.ts`](../src/lib/replenishment-proposal.ts), [`replenishment-lifecycle.ts`](../src/lib/replenishment-lifecycle.ts), [`d1-replenishment-review.ts`](../src/lib/d1-replenishment-review.ts) | [`src/app/api/replenishment/`](../src/app/api/replenishment/), [`tests/replenishment-lifecycle-d1.mjs`](../tests/replenishment-lifecycle-d1.mjs) |
| Supplier registry and purchase-order drafts | [`purchasing-supplier-contract.ts`](../src/lib/purchasing-supplier-contract.ts), [`purchase-order-contract.ts`](../src/lib/purchase-order-contract.ts), [`d1-purchase-order-drafts.ts`](../src/lib/d1-purchase-order-drafts.ts) | [`purchase-order-drafts.tsx`](../src/components/workspace/purchase-order-drafts.tsx), [`purchase-order-editor-model.ts`](../src/components/workspace/purchase-order-editor-model.ts), [`src/app/api/purchase-orders/`](../src/app/api/purchase-orders/) |
| Saved history, filters, PDF, and native Excel | [`purchase-order-history-contract.ts`](../src/lib/purchase-order-history-contract.ts), [`purchase-order-history-dates.ts`](../src/lib/purchase-order-history-dates.ts), [`draft-document-pdf.ts`](../src/lib/draft-document-pdf.ts), [`draft-document-xlsx.ts`](../src/lib/draft-document-xlsx.ts) | [`d1-purchase-order-history-exports.ts`](../src/lib/d1-purchase-order-history-exports.ts), [`purchase-order-history-downloads.tsx`](../src/components/workspace/purchase-order-history-downloads.tsx), [`tests/helpers/`](../tests/helpers/) |
| Immutable document archive contract | [`purchase-order-document-archive-contract.ts`](../src/lib/purchase-order-document-archive-contract.ts), [`purchase-order-document-archive.ts`](../src/lib/purchase-order-document-archive.ts) | [`tests/purchase-order-document-archive.mjs`](../tests/purchase-order-document-archive.mjs), [local contract evidence](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md) |
| Cart authorization, jobs, reconciliation, and supplier confirmation | [`po-cart-authorization-contract.ts`](../src/lib/po-cart-authorization-contract.ts), [`d1-po-cart-jobs.ts`](../src/lib/d1-po-cart-jobs.ts), [`d1-po-cart-reconciliation.ts`](../src/lib/d1-po-cart-reconciliation.ts), [`d1-po-cart-confirmations.ts`](../src/lib/d1-po-cart-confirmations.ts) | [`durable-cart.tsx`](../src/components/workspace/durable-cart.tsx), [`supplier-confirmation.tsx`](../src/components/workspace/supplier-confirmation.tsx), [`src/app/api/internal/`](../src/app/api/internal/) |
| Delivery counts, manager approval, and order closure | [`po-cart-delivery-contract.ts`](../src/lib/po-cart-delivery-contract.ts), [`d1-po-cart-deliveries.ts`](../src/lib/d1-po-cart-deliveries.ts) | [`delivery-count.tsx`](../src/components/workspace/delivery-count.tsx), [`supplier-deliveries.tsx`](../src/components/workspace/supplier-deliveries.tsx), [`tests/po-cart-order-closures.mjs`](../tests/po-cart-order-closures.mjs) |
| Weekly supplier suggestions and draft schedules | [`d1-supplier-suggestions.ts`](../src/lib/d1-supplier-suggestions.ts), [`po-draft-schedule-contract.ts`](../src/lib/po-draft-schedule-contract.ts), [`d1-po-draft-schedules.ts`](../src/lib/d1-po-draft-schedules.ts) | [`weekly-schedules.tsx`](../src/components/workspace/weekly-schedules.tsx), [`src/app/api/po-draft-schedules/`](../src/app/api/po-draft-schedules/), [`tests/po-draft-schedules.mjs`](../tests/po-draft-schedules.mjs) |
| Permanent document copies in the app | [`d1-document-archive-journal.ts`](../src/lib/d1-document-archive-journal.ts), [`r2-document-archive-objects.ts`](../src/lib/r2-document-archive-objects.ts), [`purchase-order-archive-client.ts`](../src/lib/purchase-order-archive-client.ts) | [`purchase-order-archives.tsx`](../src/components/workspace/purchase-order-archives.tsx), [`src/app/api/purchase-order-documents/`](../src/app/api/purchase-order-documents/), [local app evidence](C4_DOCUMENT_ARCHIVE_APP_LOCAL_EVIDENCE.md) |
| Spending controls and gated automation | [`d1-po-cart-spending-limits.ts`](../src/lib/d1-po-cart-spending-limits.ts), [`purchasing-engine.ts`](../src/lib/purchasing-engine.ts), [`vendor-adapter.ts`](../src/lib/vendor-adapter.ts) | [`spending-limits.tsx`](../src/components/workspace/spending-limits.tsx), [`src/app/api/automation/`](../src/app/api/automation/), [`tests/purchasing-safety.mjs`](../tests/purchasing-safety.mjs) |

Keep quantities, money, revisions, idempotency keys, leases, and transaction order
in their existing contracts. Pending or uncertain external outcomes remain held
for review; formatting must not add a retry or change an enabled gate.

## UI state, errors, and downloads

Workflow state primarily lives in React components and their adjacent models and
clients. For supplier requests, follow
[`purchasing-client.ts`](../src/components/workspace/purchasing-client.ts); for cart
requests, follow [`durable-cart-client.ts`](../src/components/workspace/durable-cart-client.ts).
The [`purchase-order-editor-model.ts`](../src/components/workspace/purchase-order-editor-model.ts)
contains draft editing calculations. Theme and navigation helpers sit beside the
workspace panels. CSS files remain colocated with their owning surfaces.

[`user-facing-error.ts`](../src/lib/user-facing-error.ts) distinguishes intended
client messages from internal failures in its consumers.
[`auth-availability.ts`](../src/lib/auth-availability.ts) distinguishes unavailable
session verification from invalid sessions. Waste routes retain a separate
uncertain-save contract. Review the actual caller before consolidating error
handling or logging; these categories carry different recovery instructions.

Document download adapters revalidate access and snapshot identity around
asynchronous generation. Start with
[`purchase-order-download.ts`](../src/lib/purchase-order-download.ts) and
[`purchase-order-history-download.ts`](../src/lib/purchase-order-history-download.ts).
The PDF/Excel engines and independent test readers are separate responsibilities.

## Workers, diagnostics, and verification

[`scripts/po-cart-worker/`](../scripts/po-cart-worker/) contains worker transports,
browser adapters, private-file handling, lifecycle controllers, and independent
Python auditors. Root `scripts/po-cart-*.mjs` files expose commands. The
[`shutdown-matrix-controller.mjs`](../scripts/po-cart-worker/shutdown-matrix-controller.mjs)
shares execution while public entrypoints retain fixed bindings.

Operational entrypoints can consume a single-use attempt or control resources.
Reading or formatting them does not authorize execution. Preserve historical
source hashes and evidence; use injected dependencies and owned test fixtures to
verify cleanup. Do not infer permission to run a command from this map.

[`scripts/test.mjs`](../scripts/test.mjs) runs root test modules sequentially in
separate processes. [`tests/helpers/`](../tests/helpers/) supplies fakes and
independent document readers; [`tests/fixtures/`](../tests/fixtures/) contains
serialized lifecycle evidence. Keep source-text assertions, deterministic race
barriers, negative authorization cases, and platform-specific guards intact.

For normal development commands, follow [local development](LOCAL_DEVELOPMENT.md).
For this cleanup, use the [readability guide](CODE_READABILITY_GUIDE.md),
[sequential tracker](../CODE_READABILITY_TODO.md), and
[file manifest](CODE_READABILITY_FILE_MANIFEST.json). The tracker records reviewed
files separately from source-pin, JSX, visual, formatter, and receiving holds.
The manifest assigns each file to one section; it is the complete inventory.

Accepted decisions and dated evidence remain under [`docs/`](./). Managed
OpenSpec and assistant artifacts retain their original structure. Read them as
context; do not rewrite historical results, mark feature gates complete, or
archive a change as part of readability work.
