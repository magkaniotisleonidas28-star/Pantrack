# Pantrack progress and milestone checklist

Updated: 2026-11-13 for the first real supplier decision.

**First real supplier:** Amazon Business, through Amazon's official connection for
business software ([decision 0007](decisions/0007-amazon-business-first-supplier.md)).
Baldor's and Amazon's website rules both forbid automated use, so the AI won't
work on either website. Amazon's official connection can search products, fill a
cart and test an order without placing it. The owner has created the Amazon
Business account and registered as a developer using the
[checklist](C3_AMAZON_BUSINESS_PREPARATION.md). Amazon's identity check needs a
registered business, so it waits until the owner registers one. Building starts
with pretend data, then Amazon's free practice version. Baldor is set aside for
later. Nothing has been ordered and no supplier has been contacted.

The [seven document PRs](C4_PR_STACK_INTEGRATION_20261108.md) are merged into main.
They cover save-history review, exact-request continuation and explicit checks
of issued and unfinished files. All refreshed Windows/Linux CI jobs and the
complete combined local pipeline passed. No merge conflicts were found, and the
other contributor's G10 work is preserved. The next gate needs preparation on
the merged source; these merges did not deploy the app, run the gate or change
the hosted database.

[G10](C4_FULL_OFFLINE_GATE_RUN_20261105.md) stopped at the same browser step as
G9, with every safety audit passing. Testing outside the real project folder
found the cause: a browser tab occasionally freezes, while a new tab still works.
The worker now switches once to a fresh tab for pages that only show information.
After adding an item, it switches only when the store has confirmed that addition,
and it never adds the item again.

[G11](C4_PACK_LABEL_EVIDENCE_20261109.md) passed every step and safety audit. The
paid test with the real AI model then stopped safely at its first practice case.
After adding two items correctly, the AI's own checker called the cups label
"sleeve of 50" incomplete because it has no size like "× 1 lb", so the worker held
the job for review. It cost about one cent. The AI now gets one shared rule:
a pack label copied exactly as shown is complete, whatever its form.

[G12](C4_VERIFIER_REHEARSAL_20261109.md) also passed everything. Its paid test
stopped at the first case again: the AI's checker looked for a field literally
called "pack label" and missed `unitLabel`. The instructions now name every field
exactly. To stop finding these one hour-long cycle at a time, a new practice round
sends only the AI's checking step the saved readings for every practice case, for
a few cents and with a separate go-ahead. That practice round passed.

[G13](C4_DUPLICATE_INDEX_20261110.md) passed everything. Its paid test passed five
practice cases, then stopped safely at the sixth. There, two products share the
same code, and the AI's checker said it still needed to check their position
numbers, so the worker held the job. It cost about four cents. The AI now gets one
shared rule for counting product positions. Each AI reading is now kept privately,
so a future failure shows its cause, and the practice round now covers every
problem case in both page layouts. The budget counter reserves a cautious maximum
for every AI request and showed $3.41 used, while real use is about $0.22. After
the owner compares OpenAI's billing page, a recorded settlement will set it to the real
amount, keeping the $5 limit. That settlement is done: $0.22 used, $4.78 free.

The practice round that followed read every real page correctly, including the one
that failed. But in 2 of 24 checks of saved readings, the checker wrongly said "not
complete". One was a wording slip in the new rule, now fixed. The other looked like
chance. A paid test needs about 36 checks to all come back complete, so the next
practice round checks each page four times, to measure how often this happens,
before G14.

That practice round came back 48 of 48 complete, and G14 passed everything. The
paid test then passed 11 of 12 cases for about nine cents. In the last one, the AI
read both identical coffee listings correctly. But the checker said "not complete"
because an oat-milk product appeared after them, so the job was safely held for
review. The checker is now told that other products before, between or after the
requested ones never make a reading incomplete. The next steps are another
practice round, a budget settlement, G15, and a fresh go-ahead for the paid test.

After a second budget settlement, the practice round came back 48 of 48 complete
again, and G15 passed everything. But the paid test stopped at its very first
request, because OpenAI refused the AI key: it had expired. Nothing was read or
added. After the key is replaced, a short practice round will confirm it works,
then G16 and a fresh go-ahead for the paid test.

With a new key, the practice round passed 48 of 48 again, and G16 passed
everything. The paid test passed its first case, then stopped safely on the
second: the AI read the cart's existing item code and its pack size as one name,
and the program caught the mismatch before adding anything. The AI is now told to
keep the item code and the pack size apart, and the practice round now also
re-reads every starting cart. The next steps are that practice round, a budget
settlement, G17, and a fresh go-ahead for the paid test.

After a budget settlement, the practice round read every cart correctly, and G17
passed everything. **The paid test then passed all 12 cases** for about $0.09:
the four normal and trick carts were prepared exactly, and the eight problem carts
were held for a person to review. Nothing was sent anywhere outside the test store,
and no checkout or order happened. This proves the AI cart preparation on the
fictional local store only. The OpenAI bill for the practice round and the paid
test together was $0.16, a little under the program's own count of $0.23, so the
program's budget stays on the safe side. Timing it against doing it by hand and
trying a real supplier are still to come.

Latest addition: [Check prepared file now](C4_PREPARED_FILE_CHECK_LOCAL_EVIDENCE.md)
checks the current file for an unfinished save and records what it found. It can
recover the same result after a lost reply or stop/retry. It does not issue,
generate, replace or approve a copy. A new local migration adds safe check-history
entries while preserving save rules; no hosted database was changed. Native,
signed-in desktop/phone and all six complete local project checks passed.
Final-head Windows/Linux CI remains an integration requirement. Formal replacement
copies still need the owner/manager role decision.

Latest addition: [Prepared file evidence](C4_PREPARED_FILE_EVIDENCE_LOCAL_EVIDENCE.md)
shows the original details and recorded checks for copies that never finished
being issued. It distinguishes no preparation record from a prepared file and
explains when a stored check matched or remained uncertain. Opening/refreshing it
does not inspect storage, issue a copy or change records. Signed-in desktop/phone
and all six complete local project checks passed. Final-head Windows/Linux CI
remains an integration requirement. This is separate from continuing a save or
checking a file now.

Latest local addition: [Continue original save](C4_DOCUMENT_SAVE_CONTINUATION_LOCAL_EVIDENCE.md)
can recover a document save from its server record after the browser loses it.
Only the person who started it can continue it, with current manager/owner access.
It keeps the same request and copy identity; changed sources or unsafe files stay
held. Its feature/browser tests and all six local project checks pass, including
the complete test run. Clean-machine checks are pending at publication.
No new database structure or online changes are added. G8 is the latest separate
testing plan; its protected merge window still applies.
The historical verification table below retains its October 14 results. Detailed evidence is
in [current status](CURRENT_STATUS.md) and the [full roadmap](PANTRACK_MILESTONES.md).

## Where we are

**Pantrack has its development foundations. We are finishing restocking
suggestions and the supplier-cart workflow before a real café trial.**

Accounts, inventory, recipe history and the sales-processing foundation are
accepted for development. Clover passed its approved, limited sandbox tests.
Restocking calculations and proposal history are built locally. Purchase-order
and practice-cart components are also built locally.

The [October 24 online-update rehearsal](C2_DEV_RELEASE_PREPARATION_20261024.md)
passed for its old candidate and eleven updates, `0024`–`0034`. The source now
has 45 database migrations through `0044`, so that rehearsal does not cover the
latest changes. The owner confirmed test data and no connected automatic-build
repository, then deferred the online update. The files and backup are retained;
before resuming, refresh the online state, backup, rehearsal and release files.
No new online inspection, maintenance, database update or deployment ran here.

The [local draft PDF](C4_DRAFT_PDF_LOCAL_EVIDENCE.md) is now built and tested.
The practice screen can download a readable supplier list with exact quantities,
estimated prices and review warnings. Missing prices stay clearly unavailable.
This first slice used fictional examples; subsequent slices below completed
saved-draft PDF/Excel downloads in the signed-in local app.

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
duplicate. Tests include recovery in a new process. Subsequent slices below
completed the local app connection. The [database record-keeping adapter](C4_DOCUMENT_ARCHIVE_D1_LOCAL_EVIDENCE.md)
now has its real application migration after the other contributor's receiving
work merged. It safely records saved-copy identity, permissions, retries and
history, and its migration/lifecycle checks pass locally. The
[private file-storage adapter](C4_DOCUMENT_ARCHIVE_R2_LOCAL_EVIDENCE.md) is now
built and tested locally too. It saves a copy once, checks its exact contents,
and can recover an interrupted save without creating another copy. Damaged or
missing files are held for review. This step adds no database structure and
does not change the online app or its database. The
[permanent-copy controls](C4_DOCUMENT_ARCHIVE_APP_LOCAL_EVIDENCE.md) are now
connected and tested in the local app too. Managers can save PDF/Excel copies
from an order or matching history and download the original file later, even
after the order changes or is canceled. Interrupted saves can be checked again
without creating a duplicate while the tab remains open, including after a
reload. Closing the tab loses the pending-save recovery record; issued copies
stay available in the server list. The
[read-only review screen](C4_DOCUMENT_ARCHIVE_REVIEW_LOCAL_EVIDENCE.md) is now
built and tested locally. It shows saves needing attention, their safe recorded
reasons and older checks. Refresh reads that history without retrying a save or
checking/changing a file. It handles waiting/unconfirmed saves and recorded
missing/damaged files, and refuses access outside the current owner/manager's
company. The [recovery policy](C4_DOCUMENT_RECOVERY_POLICY_20261101.md) now
separates retrying the same save, checking an existing file and making a linked
replacement. Originals and old failures stay recorded. Owner-only authorization
for formal replacements is proposed; whether managers may also authorize them
is still a pending choice. The [**Check file now** button](C4_ISSUED_FILE_CHECK_LOCAL_EVIDENCE.md)
is now implemented for saved copies. It checks the original file and records a
result without creating or replacing it. If the reply is interrupted, retry
retrieves that same check. Its local file-check and signed-in screen tests pass.
Broader testing hit two existing worker-test failures, including a Windows file
permission error; separate reruns passed. Clean-machine checks are still needed
before merging. The evidence report keeps that caveat visible.
That document step is now implemented in the continuation slice linked above.
The policy itself changed no app behavior.
The online release remains paused, and C4/M8 still have other open work.

The new commits add an optional AI reader for practice supplier carts and private
records of its completion checks. On October 25 the complete offline gate, including
the AI safety run, [passed all 21 checks](C4_FULL_OFFLINE_GATE_RUN_20261025.md) with
fake suppliers and mocked AI. The older second-item timeout's cause is still not
explained, and real AI, supplier and café tests remain. Since later changes
altered the source, [G7 subsequently passed every step and audit](C4_FULL_OFFLINE_GATE_RUN_20261031.md).
The paid attempt stopped before any provider request. The merged G8 plan fixes
that build boundary and requires fresh protected testing and authorization. Check its
operator's status before merging: no merges are allowed from preparation until
the paid run finishes. This update starts neither run. C4/M8 remain open.

At the last inspection, the online development app was behind GitHub. The six
bug fixes are merged, and the CI portability repair passed Windows/Linux checks
on its reviewed branch.
Online release/testing are still needed. No real supplier order or café pilot is
complete.

The [October 22 checks](C2_LOCAL_READINESS_20261022.md) verified October 20
source plus the local startup fix and passed the complete
local pipeline, including sign-in and company isolation. The test runner
executed 98 suites successfully and explicitly skipped ten POSIX-specific suites
on Windows. Existing stock/history and saved configuration were preserved.
Those are dated results; the newer local features above have their own linked
evidence and do not imply an online release.

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
| M9 | Reliable schedules, reminders and background work. | Weekly draft logic and settings screens are built/tested locally. Automatic Cron checks, hosted operations and alerts remain open. |
| M10 | Spending limits and financial safeguards. | Owner limit controls and password-confirmed over-cap approval are built/tested locally. Payment responsibility is decided; full acceptance remains open. |
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
The document downloads, filters and permanent saved copies above are complete
locally. Later merged work also includes:

- [Supplier confirmation](C4_SUPPLIER_CONFIRMATION_LOCAL_EVIDENCE.md) and
  [owner approval above the cap](C4_OVER_CAP_APPROVAL_LOCAL_EVIDENCE.md).
- [Blind delivery counts and manager approval](C4_DELIVERY_RECEIVING_LOCAL_EVIDENCE.md),
  followed by [order closure](C4_ORDER_CLOSURE_LOCAL_EVIDENCE.md).
- [Suggestions per supplier](C4_SUPPLIER_SUGGESTIONS_LOCAL_EVIDENCE.md),
  [weekly draft logic](C4_WEEKLY_SCHEDULES_LOCAL_EVIDENCE.md) and
  [schedule settings/results screens](C4_WEEKLY_SCHEDULE_SCREENS_LOCAL_EVIDENCE.md).
  Automatic Cron execution is not connected.

[G5 passed the complete 21-step offline gate](C4_FULL_OFFLINE_GATE_RUN_20261025.md),
including 30/30 reliability cases and 50 AI safety cases. All AI was mocked and
suppliers were fictional; this does not explain the older timeout or prove real
model/supplier acceptance. The merged G6 plan requires new evidence on current
source before a separately authorized paid test, with no intervening merges.

Still open: the explicit file-check feature, server-assisted continuation and
the formal replacement-role choice/implementation; the current-source G6/real-model
sequence; hosted privacy/safety and document acceptance; permitted supplier
access and production mappings; and complete supplier/checkout/confirmation/
delivery acceptance. Reuse the local features rather than rebuild them.

Evidence: [C2 closeout](C2_M2_CLOSEOUT.md), [Baldor preparation](C3_BALDOR_PREPARATION.md),
[Amazon Business preparation](C3_AMAZON_BUSINESS_PREPARATION.md),
[latest local cart reconciliation](C4_PO_CART_RECONCILIATION_LOCAL_EVIDENCE.md),
[earlier AI evaluation and its recorded limits](C4_PO_CART_AI_LOCAL_EVIDENCE.md)
and [PO/cart integration checklist](PO_AI_CART_INTEGRATION_ROADMAP.md).

## Historical verification — October 14

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
prove that the online code or database received them. The October 14 database
check only read migration history and wrote no data; it did not validate every
saved business record. No signed-in hosted/browser walkthrough was performed in
that check. Later local startup and G5 passes supersede the failure/pending
results above. Hosted reads were last refreshed October 24; the old 11-update
range does not describe the complete current source through `0044`.

The repair's [Windows/Linux CI](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/38508252498)
passed for `456ad67`; [PR #10](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/10)
tracks the final synchronized checklist. Incoming main's Supabase Preview passed,
while PR preview creation was skipped because it is disabled. Neither proves
the full login/recovery workflow. See the [sync verification record](C2_STATUS_SYNC_20261013.md).

## What happens next, in order

The local startup error is repaired within the recorded October 22 scope.
Release preparation passed on October 24, but the owner deferred the online
update. Independent local supplier/cart work can continue while it waits.
The October 25 mocked gate passed; the new G6 plan requires current-source
evidence for a real-model test, whose status must be coordinated with its operator.

1. **Keep the deferred online release on hold.** Its old eleven-update rehearsal
   is retained. Refresh the online state, complete current migration range,
   backup/recovery rehearsal and candidate when the owner requests resumption.
2. **Authorize and perform that specific development release, then test it online.**
   Record the inventory, sales recovery/readiness and count/planning results with
   fictional data. The old stock history must stay intact.
3. **Finish A8/M7.** Record the online proposal screens, complete sales-to-proposal
   flow and simultaneous-request/source-change tests.
4. **Finish C4/C5 and M8 without duplicating local features.** Coordinate the G6
   preparation/gate and separately authorized real-model run. Merge no work
   between preparation and the paid run's finish. After that restriction clears,
   integrate the local document review and policy in order. The next isolated
   document build is the explicit issued-file check; formal replacements wait
   for their role choice and implementation.
   Finish supplier access/budgets and hosted/full-workflow
   acceptance using the existing document, confirmation and receiving features.
   Supplier cart tests and real manager checkout need separate authorization.
5. **Finish operations and spending controls, then the café pilot.** Complete
   M9/M10 and resolve M6/Toast before M11; run two supervised delivery cycles.
6. **Finish M12 production readiness.** Complete security, backup/restore,
   monitoring, support and onboarding checks after the pilot.

Supplier decisions and isolated local C4 development can continue alongside
release preparation and A8; coordinate integration around the G6 merge restriction.
Toast can resume when its approved access arrives.
Supplier submission and automatic purchasing remain disabled.
