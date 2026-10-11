# PO-backed cart preparation and purchasing rollout

Current decision adopted: 2026-10-09; supersedes the email-first direction adopted
on 2026-10-03. Historical local evidence and completion records remain unchanged.
See [decision 0005](decisions/0005-po-backed-ai-cart-preparation.md) and the
[detailed integration roadmap](PO_AI_CART_INTEGRATION_ROADMAP.md).
Workstream C; A owns inventory and proposal truth.
This document records the approved product direction, not completed acceptance.
See [milestones](PANTRACK_MILESTONES.md) and [current status](CURRENT_STATUS.md).

## Product workflow

Managers create POs manually or from immutable replenishment proposals. Each PO
has one company, supplier, account, delivery location and currency. Support stock
and non-stock lines; never silently classify an unmapped stock item as non-stock.
Preserve quantities, SKUs, revisions and frozen exact conversions. Proposal edits
remain A-owned and audited; purchasing never recalculates replenishment needs.

The weekly workflow creates a PO draft and reminder. A manager reviews the PO
and explicitly authorizes cart preparation. Stagehand assists bounded discovery
in Browserbase; trusted code validates exact products/packs and prepares the cart.
AI never checks out. The manager reviews and checks out in the same hosted browser,
records supplier confirmation, and approves staff delivery counts through A's
atomic inventory contract. Sign-in and checkout are desktop-first; review, status
and receiving remain responsive.

Supplier profiles bind versioned supplier/account/location/product mappings,
permitted browser use, delivery rules and payment responsibility. Baldor remains
the first candidate, subject to access and compatibility gates. Ordering email is
optional for browser-enabled suppliers; retain existing records and snapshots.
No supplier contact or account access is authorized by this plan.

Draft review, preparation authorization and supplier purchase confirmation are
separate. Bind authorization to the current PO revision, connection/mappings,
account/location, lines/conversions, currency, estimates and proposed cap. Changes
invalidate authorization. Reserve quantity commitments and spending exposure
atomically so unresolved work does not create duplicate replenishment.

Pantrack can gate preparation and reserve a cap against owner limits; it cannot
enforce a manager's spending at external checkout. Show observed item subtotal
separately from final charges and reconcile confirmed prices/fees. Above-cap
confirmation requires renewed approval. Unknown checkout retains exposure and
commitments until reconciled. Preparation cancellation is not supplier cancellation.

Keep cart, purchase and delivery status independent. A ready cart or a “checkout
completed” button is not supplier confirmation. Managers initially enter supplier
references, lines, quantities, prices, charges and expected delivery with explicit
provenance and optional private evidence. Never automatically retry an uncertain
write or switch ordering channels.

## Durable history, documents and permissions

The planned D1 model stores supplier/mapping versions, PO headers and immutable revisions/lines,
preparation authorizations, connections, cart jobs/attempts/events, worker leases,
replay receipts, confirmations, receiving drafts/receipts,
line dispositions, budget/incoming ledgers and audit/operation receipts. Preserve
legacy Pantrack orders read-only without inventing acceptance or inventory
evidence. Track new Pantrack orders first; importing externally placed historical
orders is a later outcome. Archive issued records instead of deleting them.

The Purchasing workspace will provide Suppliers, Purchase orders and Receiving.
Search/filter by PO reference, supplier, product, date and status. Detail includes
original versions, preparation grants, verified cart observations, supplier
confirmations/changes, delivery counts,
remaining quantities and audit history. Server authorization scopes every operation
to company membership. Staff see operational receiving fields, not restricted
pricing/budget/account data; managers and owners manage purchasing and exports.

PDF defaults: PDF-lib, embedded licensed Unicode font, paginated US Letter,
private R2 storage and document hash/template metadata in D1. Drafts say
**Draft — no order placed**. Exports distinguish requested, observed, confirmed
and received quantities, prices and final charges; include PO number/revision,
references, exact conversions, cap and delivery instructions. Retain immutable
historical documents. Verify Worker build and served generation before adopting
the library in its implementation slice.

Excel defaults: lazy-loaded ExcelJS document workbook, genuine `.xlsx`, authorized
server snapshots, Orders/Lines/Deliveries/History sheets. Support one PO and full
filtered history across pagination. Reject oversized exports explicitly rather
than silently truncating. Preserve long identifiers/exact quantities as text and
treat user content as literal cells. Do not rename CSV files to XLSX.

## Browser execution and receiving contracts

Cloudflare owns authorization, PO/job records and transitions. A Render Node 22
worker claims jobs through authenticated internal endpoints without database
credentials. Expiring leases/fencing prevent stale writes; serialize ownership
per supplier login/cart, including shared locations. Record attempts before browser
writes and stop for review after uncertain writes or worker crashes.

Owners manage private company/login Browserbase contexts; managers sign in/handle
2FA while automation is paused. Verify disabled browser recording/logging for real
sessions. Keep credentials/payment pages out of model inputs. Treat Live View links
as private access credentials, allowlist navigation, revoke sessions and remove
contexts on disconnect while retaining purchasing audit history.

Before handoff, independently reread account/location/cart and current PO, reserve
exposure, and stop all automation/model calls. Hand the same browser to the manager
for checkout with a visible expiry warning and 30-minute maximum session. A lost
session after handoff leaves an unresolved purchase, never assumed cancellation.

Supplier email dispatch, outbox, verified sender domain and email-provider webhooks
from the 2026-10-03 direction are deferred. Existing fake send/unknown evidence
remains local evidence only. Notification email remains in scope; there is no
automatic email/API fallback from browser uncertainty.

Staff record delivery counts; managers approve before inventory changes. Support
multiple/partial deliveries and accepted, damaged/rejected, backordered,
outstanding and canceled/short-closed dispositions. Preserve original staff counts
and audit manager corrections. Close a PO only when every line is fulfilled or has
an explicit final manager disposition with reason. Non-stock lines are reconciled
without stock movements. Substitutions/overdelivery need mapping and cost review.

A publishes an atomic multi-product PO inventory port. Confirmation moves
proposal commitments into per-PO confirmed incoming exactly once without double
counting or replacing another PO/manual incoming quantity. Receiving uses frozen
conversions and atomically stores receipt, movements, remaining quantities and
audit. Idempotent delivery IDs and revision guards reject duplicate/stale approvals.
Damaged/rejected goods do not add usable stock. Receipts before the physical-count
cutoff are held for reconciliation. Do not build this by sequential calls to the
existing absolute incoming setter or by flooring unexplained discrepancies.

## Separate reviewable outcomes

| Outcome | Workstream/gate | Observable completion |
| --- | --- | --- |
| Foundation | C4, local | Roadmap adopted; durable review-only manual/proposal drafts, exact lines, audit and company isolation. |
| Supplier registry | C4 with A handoff | Versioned company supplier/account/location/product mappings; real mapping contract distinct from existing fictional v1/v2 handoffs. |
| Draft editing/review | C4, local | Audited edits, review invalidation, proposed cap and immutable reviewed snapshots; no purchase approval. |
| Preparation authorization | C4 with A handoff | Current immutable PO binding, atomic quantity commitments, duplicate-source prevention and owner spending reservations. |
| Documents/history | C4 | Searchable new/legacy history, inspected PDF and XLSX exports; private immutable issued documents. |
| Cart preparation/handoff | C4 then C5 | Durable jobs, private sessions, fenced worker, exact cart checks and same-session manager checkout; supplier validation separately authorized. |
| Supplier confirmation | A/C contract, C4 then C5 | Audited manual confirmation and atomic order-linked incoming ledger. |
| Delivery reconciliation | A/C contract, C4 then C5 | Staff counts, manager approval, full line accounting and atomic exact receiving. |
| Operations/pilot/release | C6–C9, M9–M12 | Failure reminders, limits, two reviewed count-to-delivery cycles and production readiness evidence. |
| Optional supplier APIs | M13 after users | Same PO/approval/budget/receiving services; supplier-specific approved access and explicit real-test authorization. |
| Controlled automation | M14 | Post-launch observation, eligibility/limits/pause evidence; API automation also requires M13. |

The [foundation](C4_PO_FOUNDATION_LOCAL_EVIDENCE.md) and
[supplier registry](C4_SUPPLIER_REGISTRY_LOCAL_EVIDENCE.md) are implemented locally
behind the default-off preview. The registry freezes supplier-specific packs and
profile/mapping versions into drafts; its A-facing projection remains review-only.
Production A proposal integration is a separate handoff. The
[draft editing/review slice](C4_PO_REVIEW_LOCAL_EVIDENCE.md) now passes locally:
owners/managers can review their own drafts, and edits require another review.
This review is separate from preparation authorization. The
[PO/cart contract slice](C4_PO_CART_CONTRACT_LOCAL_EVIDENCE.md) provides exact
read-only preflight. The next [durable fictional slice](C4_PO_CART_AUTHORIZATION_LOCAL_EVIDENCE.md)
adds atomic permission, A/C commitments, cap reservations and replay/audit records
under persisted test policies. The [durable fictional jobs slice](C4_PO_CART_JOBS_LOCAL_EVIDENCE.md)
adds account-cart ownership, fenced leases, immutable attempts/results and conservative
crash recovery using internal fake workers. It reuses those reservations and leaves
the browser preview separate. Authenticated worker transport is next; real owner
controls, production mappings, browser/session integration, supplier submission and
receiving remain open.
Existing fictional handoffs remain explicitly
review-only; saving a draft never upgrades them to production mappings.
C4/M8 acceptance and all later outcomes stay open until their evidence exists.

## Verification and release

For each outcome, test anonymous/wrong-company/forbidden roles and commit-time
revocation; replay, concurrency, stale revisions, lost acknowledgments and
unchanged unrelated records. Receiving adds multiple POs for one product,
partial/damaged/substituted/excess lines, changed pack configuration, count-cutoff
conflicts, concurrent staff drafts and all-or-nothing inventory checks.

Visually inspect multi-page/Unicode/long-line/missing-price PDFs and open native
Excel workbooks; verify exact values, formula-like text and full filtered results.
Exercise narrow layouts, keyboard navigation, downloads and history.
Run the full local pipeline from AGENTS.md, OpenSpec validation and diff/link
review. Keep fictional/local, provider-test, pilot and production evidence separate.

Keep real supplier preparation and automatic purchasing disabled until their
roadmap gates. Prerequisites include accepted M7, café/account authorization,
permitted browser use, hosted-fictional safety evidence, approved budgets, private
session/storage controls and A's atomic inventory contract. Weekly scheduling
creates drafts/reminders every 15-minute due check; it never launches AI or checkout.
Release includes two supervised count-to-delivery cycles with a discrepancy,
privacy/offboarding and worker recovery evidence. Rollback disables new jobs and
schedules, pauses automation and ends sessions; retain unresolved commitments,
history and documents, and forward-repair schema. No remote migration, deployment,
paid hosted test, supplier contact, account access or purchase is authorized here.

Current browser/worker references and feasibility gates are in the
[integration guide](PO_AI_CART_INTEGRATION_ROADMAP.md). Historical email-first
choices (including Resend outbox infrastructure) are superseded and deferred;
local evidence linked above retains its original scope.
