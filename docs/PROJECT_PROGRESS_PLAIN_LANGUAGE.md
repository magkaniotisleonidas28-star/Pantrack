# Pantrack progress and milestone checklist

Updated: 2026-10-26 for the local permanent-document contract and PDF/Excel. The historical verification table
below retains its October 14 results. Detailed evidence is
in [current status](CURRENT_STATUS.md) and the [full roadmap](PANTRACK_MILESTONES.md).

## Where we are

**Pantrack has its development foundations. We are finishing restocking
suggestions and the supplier-cart workflow before a real café trial.**

Accounts, inventory, recipe history and the sales-processing foundation are
accepted for development. Clover passed its approved, limited sandbox tests.
Restocking calculations and proposal history are built locally. Purchase-order
and practice-cart components are also built locally.

The [online update is now prepared](C2_DEV_RELEASE_PREPARATION_20261024.md):
the backup restored correctly, all eleven database updates preserved existing
records in rehearsal, and the release files passed local checks. The online app
is still on its old version. The owner confirmed test data and no connected
automatic-build repository, then chose to defer the online update for now. The
prepared files and backup are retained; no maintenance or database update ran.

The [local draft PDF](C4_DRAFT_PDF_LOCAL_EVIDENCE.md) is now built and tested.
The practice screen can download a readable supplier list with exact quantities,
estimated prices and review warnings. Missing prices stay clearly unavailable.
This works with fictional examples on this computer; adding it to the signed-in
app remains separate work.

The [Excel download](C4_DRAFT_XLSX_LOCAL_EVIDENCE.md) is now built and tested too.
It includes a summary and a sortable/filterable item list, preserves exact values
as text, and keeps missing prices clearly unavailable. Editing the spreadsheet
does not change Pantrack.

The [saved-draft export checks](C4_SAVED_DRAFT_EXPORT_LOCAL_EVIDENCE.md) now pass
locally. Only a manager or owner from the correct company can read the export,
and it must match the current saved revision. Changed or canceled drafts are
blocked; manual items, quantities and missing prices keep their saved values.
The [saved-draft PDF/Excel adapter](C4_SAVED_DRAFT_DOCUMENTS_LOCAL_EVIDENCE.md)
now uses those saved values with the existing document engines. Browser downloads
and independent file readers passed, including manual items, missing prices and
long quantities. The [manager download buttons](C4_SAVED_DRAFT_DOWNLOADS_LOCAL_EVIDENCE.md)
are now connected and tested locally. They use the current saved revision,
stop if access or the draft changes, and let the manager cancel, retry or reload.
PDF/Excel downloading from a saved draft is complete on this computer.
The [saved-order search and filters](C4_PO_HISTORY_FILTERS_LOCAL_EVIDENCE.md)
are now built and tested locally too. Managers can search PO numbers/suppliers,
filter draft/reviewed/canceled status, and page through matching results.
The [complete history downloads](C4_FILTERED_HISTORY_EXPORTS_LOCAL_EVIDENCE.md)
now export every matching page to PDF or Excel, up to 100 drafts and 1,000 lines.
They stop if access or matching records change, and refuse oversized results
without a partial file. Canceled drafts remain labeled as history. Actual app
downloads and independent file readers passed after combining the other
contributor's spending-limit work. This export feature needed no new database
structure. The [date filters](C4_HISTORY_DATE_FILTERS_LOCAL_EVIDENCE.md) now let
managers choose From/To days in New York time or UTC. The history and downloaded
files use the same dates, including daylight-saving changes. This passed the
full local checks and actual app downloads without a new database structure.
The [product/item filter](C4_HISTORY_PRODUCT_FILTERS_LOCAL_EVIDENCE.md) now finds
orders by saved descriptions, supplier SKUs or product IDs. It combines with
the other filters and keeps every line of each matching order in PDF and Excel.
Full local checks and actual downloads passed without a new database structure.
The [private, permanent document-copy contract](C4_DOCUMENT_ARCHIVE_CONTRACT_LOCAL_EVIDENCE.md)
is now built and tested locally. It keeps an exact saved copy, checks who can read
it, detects damaged files and handles an interrupted save without creating a
duplicate. Tests include recovery in a new process. It is not connected to the
app yet. The [database record-keeping adapter](C4_DOCUMENT_ARCHIVE_D1_LOCAL_EVIDENCE.md)
now has its real application migration after the other contributor's receiving
work merged. It safely records saved-copy identity, permissions, retries and
history, and its migration/lifecycle checks pass locally. Next is private file
storage; app save/read controls follow after that.
The online release remains paused, and C4/M8 still have other open work.

The new commits add an optional AI reader for practice supplier carts and private
records of its completion checks. On October 25 the complete offline gate, including
the AI safety run, [passed all 21 checks](C4_FULL_OFFLINE_GATE_RUN_20261025.md) with
fake suppliers and mocked AI. The older second-item timeout's cause is still not
explained, and real AI, supplier and café tests remain. C4/M8 therefore remain open.

At the last inspection, the online development app was behind GitHub. The six
bug fixes are merged, and the CI portability repair passed Windows/Linux checks
on its reviewed branch.
Online release/testing are still needed. No real supplier order or café pilot is
complete.

This computer is now updated to the October 20 GitHub code, with a local startup
fix. The [October 22 checks](C2_LOCAL_READINESS_20261022.md) passed the complete
local pipeline, including sign-in and company isolation. The test runner
executed 98 suites successfully and explicitly skipped ten POSIX-specific suites
on Windows. Existing stock/history and saved configuration were preserved.

**A checked box means complete within its stated scope.** Local means tested on
a computer with fictional data. Sandbox means tested with a provider's test
account. Neither means approved for real customers or production.

## Milestone checklist

| Milestone | What it means | Current status |
| --- | --- | --- |
| M0 | Run the project on a computer. | Baseline complete; desktop startup and the full local pipeline passed again on October 22. |
| M1 | Automatically check changes for errors. | Complete; the new missing-tool CI failure is repaired and covered by Windows/Linux branch checks. |
| M2 | Accounts, company access and permissions. | Accepted for development; hosted signup/recovery and independent security review remain follow-ups. |
| M3 | Reliable inventory, units and recipe history. | Accepted for development; newest fixes still need online validation. |
| M4 | Safely turn sales into ingredient deductions. | Accepted locally; newest recovery fixes still need online validation. |
| M5 | Connect and test Clover. | Accepted for the tested development sandbox scope; excluded cases and real café use remain unverified. |
| M6 | Connect a second register provider, Toast. | On hold awaiting Toast approval/testing access. |
| M7 | Explain what needs restocking and let managers review it. | Built locally; A8 online acceptance remains open. |
| M8 | Prepare exact supplier carts, let a manager check out, and record deliveries. | Partly built locally; the full offline gate (with mocked AI) passed on October 25. Supplier/full workflow acceptance remain open. |
| M9 | Reliable schedules, reminders and background work. | Planned/prototype only; new hosting and scheduling are not provisioned. |
| M10 | Spending limits and financial safeguards. | Partial local safeguards; full acceptance remains open. |
| M11 | Prove the workflow in a real café. | Not started; requires two supervised count-to-delivery cycles. |
| M12 | Make it ready for multiple real businesses. | Not started; requires the café pilot first. |
| M13 | Add optional direct supplier APIs. | Deferred until production users exist. |
| M14 | Consider automatic purchasing or AI checkout. | Separate later project; disabled. |

The first launch is planned around **manager-controlled checkout**. AI prepares
a cart; it does not place an order. M13/M14 do not block that launch. The Toast
gate has not been waived.

## Person A — inventory and restocking

A1–A7 are complete for local development. **A8 is the next open A step.**

- [x] **A1:** Agree how units, old records, counts and recipe history work.
- [x] **A2:** Define how sales safely subtract ingredients.
- [x] **A3:** Add the required inventory/history database structures.
- [x] **A4:** Build exact inventory, recipes, counts and manager screens.
- [x] **A5:** Accept M3 for development and hand the inventory contract to B.
- [x] **A6:** Build the restocking calculation engine; suggestions only.
- [x] **A7:** Save proposal history, handle edits/changed stock, prevent duplicate quantities and hand the contract to C.
- [ ] **A8:** Finish M7 acceptance with online manager/browser, end-to-end and simultaneous-request tests.
- [ ] **A9:** Measure inventory and suggestion accuracy during the approved café pilot.
- [ ] **A10:** Verify inventory onboarding, export/deletion and backup recovery before release.

Evidence: [A5 acceptance](M3_A5_ACCEPTANCE.md), [A6 calculations](M7_A6_LOCAL_EVIDENCE.md),
[A7 lifecycle](M7_A7_LIFECYCLE_EVIDENCE.md) and [A8 local flow/remaining gates](M7_A8_SERVED_LOCAL_EVIDENCE.md).
B7 is accepted within its recorded scope; waiting for B7 is no longer A8's blocker.

## Person B — sales and register connections

B1–B7 are complete within their local or accepted sandbox scope.
**B8 is on hold for Toast access.**

- [x] **B1:** Agree on sales events, duplicates, refunds and held sales.
- [x] **B2:** Test sales processing against a fake inventory service.
- [x] **B3:** Store sales events and their review/audit history.
- [x] **B4:** Connect sales to exact inventory and manager recovery tools.
- [x] **B5:** Accept M4 for local development.
- [x] **B6:** Build Clover locally and test with fake provider responses.
- [x] **B7:** Accept the tested Clover development sandbox cases.
- [ ] **B8:** Obtain approved Toast access, build its native connection and pass its sandbox tests.
- [ ] **B9:** Measure missed, delayed, duplicate and held sales during the approved café pilot.
- [ ] **B10:** Finish register onboarding, abuse protection and company-isolation release checks.

Evidence: [B5 acceptance](M4_B5_LOCAL_EVIDENCE.md), [B6 local adapter](M5_B6_LOCAL_EVIDENCE.md),
[B7 bounded acceptance](M5_B7_ACCEPTANCE_REVIEW.md) and [Toast handoff](M6_TOAST_ACCESS.md).
B7 does not prove native webhook retry or every Clover order state. Polling
recovery is the accepted fallback; real café and production approval are separate.

## Person C — platform, suppliers and operations

C1–C2 are complete for development. **C3 decisions and C4 components remain
open**, although substantial C4 code has been merged.

- [x] **C1:** Accept development accounts and company permissions.
- [x] **C2:** Record the development evidence and deployment limits.
- [ ] **C3:** Finish supplier permission, account/location/product, budget, payment and operations decisions.
- [ ] **C4:** Finish the safe purchasing platform and controlled browser/model tests.
- [ ] **C5:** Accept the complete supplier/cart/manager-checkout/confirmation/delivery workflow after M7.
- [ ] **C6:** Provision and test schedules, reminders, worker recovery and alerts.
- [ ] **C7:** Finish spending controls and financial acceptance.
- [ ] **C8:** Coordinate the two approved café pilot cycles and collect A/B/C evidence.
- [ ] **C9:** Finish security, support, privacy, recovery and production release evidence.

C4 already has local purchase-order drafts/revisions, supplier profiles,
preparation permission and spending reservations, saved jobs, worker access,
private practice-browser sessions, progress screens and uncertain-cart recovery.
The new commits also add evaluation-only AI discovery/cart checks and private
completion evidence. The latest 16-case fake completion-check matrix passed;
the larger reliability run passed 24 jobs, then timed out on job 25. That is
unfinished acceptance. Earlier real-model runs also stopped before the full
matrix completed. No paid retry is authorized.

Still open: resolve that reliability failure and pass the fresh full AI gate,
then separately authorized real-model validation, hosted privacy/safety,
permitted Baldor access, production mappings, signed-in PDF/Excel exports, confirmation
and approved receiving.

Evidence: [C2 closeout](C2_M2_CLOSEOUT.md), [Baldor preparation](C3_BALDOR_PREPARATION.md),
[latest local cart reconciliation](C4_PO_CART_RECONCILIATION_LOCAL_EVIDENCE.md),
[AI evaluation and remaining blocker](C4_PO_CART_AI_LOCAL_EVIDENCE.md)
and [PO/cart integration checklist](PO_AI_CART_INTEGRATION_ROADMAP.md).

## What was verified today

| Check | Result on 2026-10-14 |
| --- | --- |
| Code reviewed | New feature commits `de970c8` and `12de73b`, above merged PR #8/#9; the checklist/CI follow-up is PR #10. |
| Automated checks | Incoming `12de73b` failed both OS jobs because a tool was missing. The focused repair passed Windows/Linux CI on its reviewed branch; PR preview was skipped by configuration. |
| This computer | 87 test suites, typecheck, build and all 35 local database migrations passed. The app-startup check failed and needs investigation. |
| Six tracked bugs | All six are locally closed; their source is on main. This is not a full security review. |
| New AI cart tests | Optional reader and completion-evidence code are built. Full real-model acceptance and the latest offline reliability gate remain unfinished. |
| Online app | Cloudflare still runs `65373b3`, deployed October 5. It does not yet have the PR #8/#9 changes. |
| Online database | 24 migrations applied, through `0023`; 11 newer migrations, `0024`–`0034`, are pending. |
| Cloudflare automatic builds | Could not verify the Git/build settings: its read APIs denied access (`403`). |

A migration is an ordered database update. Pushing commits to GitHub does not
prove that the online code or database received them. Today's database check
only read migration history and wrote no data. It did not validate every saved
business record. No signed-in hosted/browser walkthrough was performed today.

The repair's [Windows/Linux CI](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/38508252498)
passed for `456ad67`; [PR #10](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/10)
tracks the final synchronized checklist. Incoming main's Supabase Preview passed,
while PR preview creation was skipped because it is disabled. Neither proves
the full login/recovery workflow. See the [sync verification record](C2_STATUS_SYNC_20261013.md).

## What happens next, in order

The local startup error is repaired within the recorded October 22 scope.
Release preparation passed on October 24, but the owner deferred the online
update. Independent local supplier/cart work can continue while it waits.
The cart/browser acceptance gate remains unfinished.

1. **Online release is on hold.** The 11 updates and backup/recovery plan are
   reviewed and rehearsed. Keep the preparation and resume only when the owner
   requests it; independent local work can proceed meanwhile.
2. **Authorize and perform that specific development release, then test it online.**
   Record the inventory, sales recovery/readiness and count/planning results with
   fictional data. The old stock history must stay intact.
3. **Finish A8/M7.** Record the online proposal screens, complete sales-to-proposal
   flow and simultaneous-request/source-change tests.
4. **Finish C4/C5 and M8.** The next C4 task is to review the retained second-item
   timeout and resolve it safely before repeating the full offline gate. Paid
   model validation needs separate approval after those checks pass. Resolve
   supplier access/budgets, then complete hosted safety, documents, confirmation
   and receiving. Supplier cart tests and real manager checkout need separate approval.
5. **Finish operations and spending controls, then the café pilot.** Complete
   M9/M10 and resolve M6/Toast before M11; run two supervised delivery cycles.
6. **Finish M12 production readiness.** Complete security, backup/restore,
   monitoring, support and onboarding checks after the pilot.

Supplier decisions and bounded local C4 development can continue alongside
release preparation and A8. Toast can resume when its approved access arrives.
Supplier submission and automatic purchasing remain disabled.
