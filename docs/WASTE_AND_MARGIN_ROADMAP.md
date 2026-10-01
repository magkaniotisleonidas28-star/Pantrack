# Quick waste recording and menu analysis roadmap

Prepared: 2026-09-30. Updated: 2026-10-01. Status: W1/W2 implemented for local review;
W3 and P1–P4 remain planned. The owner approved a roadmap alongside
[C3 Baldor preparation](C3_BALDOR_PREPARATION.md).

## Goal and starting point

Make waste recording quick enough for workers to use during a busy shift, and
give managers explainable ingredient/packaging margins and waste analysis.

Basic ingredient waste already exists in the general inventory form. The
general inventory API restricts writes to managers/owners; W1 adds narrowly
authorized staff waste entry. Exact quantities, inventory
events, recipe versions, and sales duplicate protection are reusable foundations.
The exact inventory flow remains behind its existing development gate.

Catalog prices are currently estimates. The common sales contract tracks
quantities and revisions but contains no normalized selling-price, discount,
tax, or revenue fields. Actual period profitability requires additional data
and validation. A POS connection does not establish financial-report accuracy.

Defaults adopted in the approved plan: cover both ingredients and prepared
items, introduce menu margins before business expenses, and start with online
recording. Toast access and an automatic supplier connection are not prerequisites
for local waste entry or manually entered costing.

## Delivery order

Each row is a separate reviewable outcome, with a focused implementation plan
and evidence record. W/P identifiers belong to this extension roadmap; they do
not rename the existing A/B/C milestone checklist or reopen accepted M3/M4 work.

| Step | Lead and handoff | Deliverable | Acceptance goal |
| --- | --- | --- | --- |
| C3 preparation | C / owner | Baldor inquiry and access checklist; this roadmap | Prepared locally; access and pilot permission remain explicit open gates |
| W1 — Quick ingredient waste | A, with C authorization review | Staff entry and audited ingredient movements | Common waste recorded in roughly 10 seconds in a measured usability walkthrough; stock deducted once |
| W2 — Prepared-item waste | A with B sales-contract handoff | Recipe/modifier waste and sales overlap handling | Multiple ingredients handled atomically; an already counted preparation is not deducted again |
| P1 — Cost foundation | A with C supplier-price handoff | Dated ingredient/packaging cost and selling-price records | Exact pack/unit arithmetic; missing costs are visible; old records remain reproducible |
| W3 — Waste review | A; uses W1/W2 and P1 | Manager corrections, history, summaries, estimated waste cost | Corrections are traceable; time/reason/item filters and cost coverage are clear |
| P2 — Menu margins | A; uses P1 and recipe versions | Manager menu-cost and margin section | Per-item/modifier calculations explain every input and preserve cost/recipe versions |
| P3 — Sales and waste analysis | B revenue handoff; A reporting; C price-source handoff | Popularity, contribution estimates, price trends, waste trends | Validated revenue and coverage before actual period results; waste is not charged twice |
| P4 — Business profitability | Owner chooses expense sources; A/C implement | Labor, rent, utilities, other expenses | Separate scope and accounting rules agreed before implementation |

While supplier access is pending, W1/W2 worker usability review is the next
unblocked product step, followed by a separate P1 cost-foundation outcome. Keep
Baldor inquiry preparation and local development independent. M7/A8 acceptance
and approved supplier access still gate C5/M8; this roadmap bypasses no existing
pilot or production requirement.

## W1 — A quick, repeatable staff flow

**Local status:** [implementation and evidence](W1_LOCAL_EVIDENCE.md) are ready
for review. The full local pipeline passed, including 35 test suites and a
fresh database with additive migration `0018`. Fictional Safari walkthroughs
covered light/dark, phone/tablet, staff access, manager shortcuts, and recovery
after server loss. Automated favorite-item tasks took 6.48 and 6.137 seconds;
these are preliminary measurements, not a worker usability study.

- [x] Implement the narrow flow, authorization, exact stock effects, and safe retries locally.
- [x] Verify automated contracts and fictional served visual behavior.
- [ ] Complete manual keyboard and physical-device/worker usability review.
- [ ] Record owner acceptance of the reviewed W1 scope.

No hosted migration, deployment, pilot, or production acceptance is included.

**Flow:** Record waste → choose ingredient → choose quantity and reason → Save.

- Put a labeled **Record waste** action within easy reach of the workspace;
  keep it usable when the sidebar is collapsed. Open a compact phone/tablet
  friendly panel rather than navigating through inventory setup.
- Show favorites/recent ingredients and search. Present familiar units and
  manager-configured quantity shortcuts, with a custom quantity option.
- Use large one-tap reason buttons: spilled, spoiled/expired, preparation error,
  and other. Require a reason selection; notes stay optional.
- Default occurrence time to now and derive company/staff identity from the
  authenticated session. Keep time editing out of the normal staff path.
- Show a clear saved state and an easy **Record another** action. Lock duplicate
  submits; reuse the same operation identity after an uncertain save. Preserve
  entered details on failure and say what the worker needs to do next.
- Start online only. An offline or expired-session result must not claim that
  stock was updated. Offline queuing needs a later conflict/retry design.
- Employees may record waste in their company and see their entry result.
  Managers/owners configure shortcuts and perform corrections. This permission
  must not grant staff counts, receipts, purchasing, recipe edits, or financial
  reports. Financial values must be excluded server-side from staff responses.

Use the exact inventory model through a focused waste service; retain legacy
behavior while its cutover gate is off. Reuse exact units and movement rules,
including count cutoffs and stock bounds. A correction is a linked audited
action, never a silent edit/delete. If safe correction requires new domain
behavior, deliver it as the W3 outcome rather than loosening stock rules.

**W1 acceptance:** anonymous/wrong-company access denied; staff permitted only
for waste; repeat save deducted once; concurrent updates handled without lost
stock; invalid quantity/unit, insufficient stock, expired session, and count
cutoff failures preserve the form. Time representative favorite-item tasks from
panel open to confirmed save, aiming for roughly 10 seconds. Review keyboard,
touch, loading/empty/error/success states, light/dark themes, and phone/tablet
layouts. Record actual timings; the target is not proof of usability yet.

## W2 — Café items without duplicate ingredient use

**Local status:** [W2 implementation and evidence](W2_LOCAL_EVIDENCE.md) cover a
dedicated Waste page, bought ready-made item setup/counts, immutable recipe and
modifier waste, and guarded sold-unit classification. All 36 local suites and
the complete pipeline passed. Fictional Safari evidence includes purchased
items, recipe effects, sold classification, delayed-sale review, shared drafts,
staff restrictions, themes and phone/tablet layouts. No hosted/provider or pilot
acceptance is claimed.

The 2026-10-01 [W2 usability refinement](W2_LOCAL_EVIDENCE.md#w2-usability-refinement--2026-10-01)
centers Waste content, removes repeated inventory summary cards, and places
modifier setup inside recipes. Managers can copy an active ingredient rule
into an independent draft instead of retyping it. Local verification passed;
POS modifier import and worker acceptance remain separate follow-ups.
The later [Inventory navigation refinement](W2_LOCAL_EVIDENCE.md#w2-inventory-navigation--2026-10-01)
groups the same tools into four sidebar sections and preserves unfinished
modifier edits when switching Inventory views. It remains local only. The [recipe/stock builder preview](W2_RECIPE_STOCK_USABILITY.md)
adds reviewed atomic recipe/option saves, required milk selection, compact recipe
rows and inline stock creation. Its normal-login local site isolates practice
data from hosted D1; migration `0020` has not been applied remotely.
The [package-unit improvement](W2_PACK_UNIT_USABILITY.md) adds separately
configured purchase containers and recipe measurements, package receiving,
whole-container/remainder counts, and atomic audited conversion receipts.
All 39 local suites and the full pipeline passed; `0021` is local only.

- [x] Implement café-item setup, atomic waste and sold-unit allocation locally.
- [x] Verify route security, retry/rollback contracts and fictional served screens.
- [ ] Complete worker usability and full accessibility/recovery walkthroughs.
- [ ] Record owner acceptance of the reviewed W2 scope.

Common flow: **Waste → café item → count → reason → Save**. For newly added
croissants/bagels, a manager uses **Item setup → Bought ready-made café item**,
then **Inventory → Stock → Add stock** with `each`, quantity per box and an
opening count.
Already counted sales are classified without another deduction; extra
replacements are additional use. Missing sales go to **Needs review**.

Use active recipe and modifier versions to explain the ingredients for an
unsold or additionally prepared wasted item. Save all ingredient effects and
the waste record atomically. Hold missing mappings, unavailable versions, or
ambiguous overlap for manager review with no partial deduction.

For waste already covered by a recorded preparation, link the existing
consumption trail and classify it without consuming those ingredients again.
An additional remake is additional ingredient use. A refund alone establishes
no ingredient restoration. B's existing sale/remake/revision policy must agree
with this behavior before the contract changes.

Do not ask busy staff to resolve technical POS identities. Keep the common
unsold-waste path simple; send uncertain sales overlap to manager review. Test
POS events arriving before and after waste entry, duplicate notifications,
recipe changes, modifiers, remakes, and multi-ingredient rollback.

## P1 / P2 — Explainable menu margins

Allow managers/owners to enter dated ingredient and packaging pack costs and
menu selling prices manually. Later accept approved supplier prices through
the same costing interface. Record currency, unit conversion, source, and
effective date; distinguish estimates from confirmed account/invoice data.
Do not overwrite historical costs when a supplier changes its price.

Calculate using exact quantities and money arithmetic:

```text
Recipe cost = sum(ingredient quantities × unit costs) + packaging cost
Margin dollars = selling price − recipe cost
Margin percent = margin dollars ÷ selling price × 100
```

Include modifier effects and clearly show the ingredient/packaging cost scope.
Tax-inclusive/exclusive inputs require a stated basis; preserve the source
basis until validated normalization exists. Missing/incompatible costs produce
an incomplete result rather than zero cost. A zero selling price has no margin
percentage. Show price dates, source, recipe version, and cost coverage beside
each result. Labor and overhead are P4 inputs.

Place **Menu analysis** in a labeled manager/owner sidebar section when P2 is
implemented. Show item, selling price, recipe cost, margin dollars/percentage,
and a breakdown. A dated report must retain its recipe and cost versions;
label recalculations at current prices explicitly. Decide freshness thresholds
in the P1 task using actual source rules; do not invent supplier validity periods.

Test pack/unit conversion, packaging, modifiers, decimal rounding, effective
dates, changed recipe versions, zero prices, negative margins, missing inputs,
company isolation, manager/owner access, and staff denial. No costing calculation
may place an order or mutate inventory.

## W3 / P3 / P4 — Review and deeper analysis

W3 adds manager corrections with reason, actor, timestamp, original entry link,
and auditable stock effect. Show daily/weekly waste by item and reason and the
estimated cost coverage. Classifications of previously consumed items must not
inflate total ingredient cost a second time. Missing costs remain explicit.

P3 first defines and tests a provider-neutral revenue handoff with B: selling
amounts, currency, discounts, refunds, tax basis, revisions, time range, and
coverage. Quantity × current menu price is a labeled estimate, not actual
revenue. Once validated, compare popularity and contribution alongside price
and waste trends. Identify extra waste separately from waste already included
in sales consumption before building adjusted totals.

P4 is a separate later feature for labor, rent, utilities, and other expenses.
Choose expense sources and allocation/time-period rules with the owner before
building overall business profit. Do not claim full business profitability from
ingredient-only calculations.

## Implementation gates

- W1 introduces narrow company-scoped waste access and additive migration
  `0018`; its local contracts and compatibility are in the evidence record.
  W2 adds migration `0019` and coordinates consumption identities and the
  correction exclusion guard with B; P1 adds dated cost records; P3 publishes a revenue contract.
- Preserve accepted inventory/sales semantics. New persisted records use new
  additive migrations through the single schema merge queue, never reserved
  migration numbers or rewritten used migrations.
- Run focused checks during each feature task and the risk-appropriate full
  local pipeline before closeout. Keep local, sandbox, pilot, and production
  evidence separate; capture visual evidence for each UI outcome.
- Keep supplier submission and automatic purchasing disabled. Remote migrations,
  deployments, real café data, supplier contact, and purchases each require the
  relevant task's authorization and roadmap evidence.

## Original preparation handoff

The following records the earlier documentation-only C3 preparation task.
W1's later implementation has its own [handoff](W1_LOCAL_EVIDENCE.md#handoff).

**Workstream/outcome:** C3 Baldor preparation packet plus the approved staged
feature roadmap; B8 recorded as waiting on Toast. These documents are ready for
review, and all future features remain planned.

**Evidence:** source/API/test inspection confirms existing manager-only waste,
exact inventory and recipe foundations, the quantity-only sales contract, the
generic connector, and submission block. Public Baldor pages establish ordering
guidance only. The NYC café/account is owner-reported, not independently verified.
No inquiry, supplier API call, café data import, account change, purchase, payment,
migration, deployment, schedule, or runtime setting change was performed.

**Verification:** `git diff --check` passed. A read-only Python link/anchor check
passed for all 75 unique relative link occurrences across the five changed
documents, including the new files. The complete diff and both new documents
were reviewed for scope, private data, unsupported claims, and conflicting gates.
Runtime tests were not run for this documentation-only change; earlier test
evidence is not a fresh test pass.

**Blockers/next:** Baldor channel, approval, test access, commercial terms, and
future pilot permission are pending. Owner can review/send the prepared inquiry;
W1 can be planned and developed locally while awaiting supplier/Toast replies.
C3 overall, C4 overall, C5/M8, B8/M6, and feature acceptance remain incomplete.

**Rollback:** revert this preparation commit to remove these documents and their
status links. No database or external action requires reversal.
