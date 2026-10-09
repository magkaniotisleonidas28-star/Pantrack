# Purchase-order-first purchasing rollout

Decision adopted: 2026-10-03. Workstream C; A owns inventory and proposal truth.
This document records the approved product direction, not completed acceptance.
See [milestones](PANTRACK_MILESTONES.md) and [current status](CURRENT_STATUS.md).

## Product workflow

Managers create POs manually or from immutable replenishment proposals. Each PO
has one company, supplier, account, delivery location and currency. Support stock
and non-stock lines; never silently classify an unmapped stock item as non-stock.
Preserve quantities, SKUs, revisions and frozen exact conversions. Proposal edits
remain A-owned and audited; purchasing never recalculates replenishment needs.

Supplier profiles record accepted ordering email, account/delivery references,
cutoffs, minimums, fees, payment terms and versioned product mappings. Verify that
each supplier actually accepts emailed POs; published Baldor guidance currently
does not establish that channel. No supplier contact or account access has been
authorized by this development plan.

Managers approve a complete snapshot and explicit total spending cap. Missing
prices stay unavailable, never zero. The cap includes tax/delivery/other charges
and reserves the approved amount against owner-configured limits before sending.
Supplier acceptance of the cap process is required. The emailed cap communicates
an instruction, not a technical restriction on the supplier's invoice. Above-cap
confirmations require renewed approval and explicit resolution.

Freeze recipient, account/location, quantities/conversions, estimates, cap and PDF
at approval/send. Editing an unsent approved PO invalidates approval. Sent versions
remain immutable; record supplier changes as amendments. A cancellation request
is not a confirmed cancellation and does not itself release commitments.

Replies go to the café's existing inbox. Managers manually record acceptance,
supplier reference, confirmed quantities/prices, backorders and changes. Keep email
dispatch, commercial confirmation and delivery status separate: recipient-mail-
server delivery is not supplier acceptance or receipt of goods. No inbound parsing
or automatic email-to-API fallback is included in the first release.

## Durable history, documents and permissions

D1 stores supplier/mapping versions, PO headers and immutable revisions/lines,
approvals, dispatch claims/events, confirmations, receiving drafts/receipts,
line dispositions, budget/incoming ledgers and audit/operation receipts. Preserve
legacy Pantrack orders read-only without inventing acceptance or inventory
evidence. Track new Pantrack orders first; importing externally placed historical
orders is a later outcome. Archive issued records instead of deleting them.

The Purchasing workspace will provide Suppliers, Purchase orders and Receiving.
Search/filter by PO reference, supplier, product, date and status. Detail includes
original versions, approvals, email evidence, supplier changes, delivery counts,
remaining quantities and audit history. Server authorization scopes every operation
to company membership. Staff see operational receiving fields, not restricted
pricing/budget/account data; managers and owners manage purchasing and exports.

PDF defaults: PDF-lib, embedded licensed Unicode font, paginated US Letter,
private R2 storage and document hash/template metadata in D1. Drafts say
**Draft — not sent**. Issued PDFs include PO number/revision, all references,
quantities/conversions, price status, cap and delivery instructions. The email
attachment and later download use identical immutable bytes. Verify Worker build
and served generation before adopting the library in its implementation slice.

Excel defaults: lazy-loaded ExcelJS document workbook, genuine `.xlsx`, authorized
server snapshots, Orders/Lines/Deliveries/History sheets. Support one PO and full
filtered history across pagination. Reject oversized exports explicitly rather
than silently truncating. Preserve long identifiers/exact quantities as text and
treat user content as literal cells. Do not rename CSV files to XLSX.

## Safe email and receiving contracts

Use an injectable transport with deterministic local fake and Resend as initial
provider. A verified Pantrack subdomain supplies From; display the café and use
its inbox as Reply-To. Configure provider secrets privately. Persist an outbox
claim before networking, permanent operation identity and provider references.
Verify webhook signatures and tolerate duplicate/out-of-order events. Resend's
24-hour idempotency retention does not replace the permanent application ledger.
Hold unknown dispatch outcomes for manager review; never blindly resend or switch
channels after an uncertain result.

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
| Purchase approval | C4 with A handoff | Atomic quantity commitments, duplicate-source prevention, owner spending controls and immutable approved snapshots. |
| Documents/history | C4 | Searchable new/legacy history, inspected PDF and XLSX exports; private immutable issued documents. |
| Email dispatch | C4 then C5 | Fake concurrency/unknown tests, durable outbox, verified provider events; live acceptance separately authorized. |
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
This review is separate from purchase approval. True approval next needs A/C
atomic quantity commitments, duplicate-source prevention and owner spending
controls. No budget/quantity reservation, purchase approval, sending or receiving
is enabled yet. Existing fictional handoffs remain explicitly
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

Keep supplier sending and automatic purchasing disabled until the corresponding
roadmap gates. Prerequisites include accepted M7, café authorization, accepted email
PO terms, provider/domain configuration, private storage and A's atomic inventory
contract. No remote migration, deployment, live email/order, café data import or
account access is authorized here. Disable the preview for code rollback, retain
history tables/documents, and forward-repair schema rather than destroying data.

Primary references: [Baldor ordering](https://www.baldorfood.com/how-to-order),
[Baldor terms](https://www.baldorfood.com/terms-of-use),
[Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Resend webhooks](https://resend.com/docs/webhooks/introduction),
[PDF-lib](https://pdf-lib.js.org/),
[ExcelJS document workbooks](https://github.com/exceljs/exceljs#browser).
