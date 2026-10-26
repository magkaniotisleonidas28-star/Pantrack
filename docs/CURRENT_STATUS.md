# Pantrack current status

Updated: 2026-10-25

This is the authoritative progress summary for Pantrack. It separates
work that has passed evidence checks from prototype features and future work.
Recorded acceptance uses development/fictional data and bounded provider sandbox
tests. No café pilot or production acceptance is claimed. The owner confirmed on
October 24 that the hosted app still contains test data.

For the short milestone and A/B/C checklists, use the
[plain-language progress guide](PROJECT_PROGRESS_PLAIN_LANGUAGE.md).

## Latest local C4 filtered history exports — 2026-10-25

The [complete filtered-history exports](C4_FILTERED_HISTORY_EXPORTS_LOCAL_EVIDENCE.md)
now download PDF or native Excel for every matching current saved draft across
pages. They reuse the existing criteria, validators and document/download engines.
Company owner/manager access and the matching snapshot are checked before
generation and again before download. Canceled records stay clearly labeled as
history; oversize results are refused in full, with no partial file.

Both newly merged owner spending-limit PRs were integrated without application
file conflicts. All six local checks passed on the combined source: 116 executed
suites plus twelve Windows skips, typecheck, build, all 37 migration checks,
isolated local apply and HTTP smoke. The signed-in browser proved all 33 matches
from page two, filtered/canceled files, cancel/retry/refresh, access/change holds,
101-record refusal and desktop/mobile/keyboard behavior. Independent readers
verified the actual downloads. Export reads preserved every application table.

This feature adds no migration. Incoming owner-limit migrations `0035`/`0036`
were checked only in the isolated test database; the root and hosted databases
were untouched. Next bounded C4 task: creation-date range filters shared by the
history list and complete exports. Issued artifacts, product filters and receiving
remain separate. C4/C5/M8 remain open; the hosted release stays paused.

## Latest local C4 history filters — 2026-10-25

The [saved-PO history filters](C4_PO_HISTORY_FILTERS_LOCAL_EVIDENCE.md) add
search, status and supplier criteria to the existing manager list. They apply
before pagination and bind current company membership to each read, including
empty pages. Apply/Clear reset paging, and delayed responses cannot overwrite a
newer search or another company. Existing detail/review/download behavior passed.

All six local checks passed: 106 executed suites plus twelve Windows skips,
typecheck, build, all 35 migration checks, fresh local apply and HTTP smoke.
The signed-in browser walkthrough covered 33 POs, pagination, literal characters,
retry, no matches, real permission refusal, and desktop/mobile/keyboard behavior.
Every application table stayed unchanged by the read/detail/export sequence.
No new schema or migration was needed.

Before this slice, the four completed export/integration commits were pushed
to GitHub at `336c447`; [Windows and Ubuntu CI](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/40249939780)
both passed. No open PR or overlapping shared history-file work was found.
The subsequent [complete filtered export](C4_FILTERED_HISTORY_EXPORTS_LOCAL_EVIDENCE.md)
now uses an authorized all-matches snapshot. C4/C5/M8 remain open; the hosted
release is paused.

## Latest local C4 manager downloads — 2026-10-25

The [signed-in download controls](C4_SAVED_DRAFT_DOWNLOADS_LOCAL_EVIDENCE.md)
now connect PDF/Excel to the manager's current saved draft. They reuse the
existing API/formatters, check current company access/revision before generation
and again before file handoff, and cancel when editing, leaving or switching
companies. Busy/cancel/retry/reload states and the locally served licensed font
are verified in the real local app. Six downloaded files passed independent
inspection; desktop/mobile and real revocation/stale/canceled paths passed.

The other contributor's merged G5 work and our two local export commits were
combined without conflicts. All six local checks passed on that combined source:
105 executed suites plus 12 Windows skips, typecheck, build, all 35 migration
checks, fresh local apply and HTTP smoke. Local production-bundle assets and
anonymous export refusal passed too. The prior G5 result retains its own scope.

Current saved-draft downloads are complete locally. Their history search/status/
supplier follow-up is now recorded above. C4/C5/M8 remain open and the online release stays
deferred; no provider/purchasing gate or schema changed.

## Latest local C4 saved-draft documents — 2026-10-25

The [saved-draft document adapter](C4_SAVED_DRAFT_DOCUMENTS_LOCAL_EVIDENCE.md)
now generates PDF/XLSX from the existing authorized export response, including
manual/non-stock items, saved supplier packs and reviewed revisions. It reuses
the existing PDF layout and Excel escaping engines. Ten actual local browser
downloads passed independent inspection, with exact quantities, missing/zero
prices, revision/draft labels and a readable 50-item PDF. The full suite passed:
103 executed suites plus ten explicit Windows skips.

This completes the saved-document adapter locally. Its signed-in controls,
authorized fetch, selection/error states and font asset are now recorded above.
C4/C5/M8 remain open, and
the online release remains deferred. No API/schema or purchasing gate changed.

## Latest local C4 saved-draft export snapshot — 2026-10-24

The [saved-draft export foundation](C4_SAVED_DRAFT_EXPORT_LOCAL_EVIDENCE.md)
adds a read-only JSON endpoint for an explicitly selected current PO revision.
Server-side owner/manager membership, company, revision and cancellation checks
are bound to one database read. Saved manual/non-stock/proposal/registry values,
missing prices and exact quantities are preserved without database/provider
writes. Full local checks passed: 102 executed suites plus ten Windows skips,
typecheck, build, all 35 migration checks, fresh local apply and HTTP smoke.
A separate real-framework check passed with the preview gate temporarily enabled.

This completes the permission/revision foundation locally; it adds no migration
or signed-in download buttons. Its PDF/XLSX adapter is now recorded above;
manager-screen wiring is also verified locally above. C4/C5/M8 remain
open, and the online release remains deferred.

## Latest local C4 draft Excel — 2026-10-24

The [fictional Excel slice](C4_DRAFT_XLSX_LOCAL_EVIDENCE.md) adds a genuine XLSX
download beside PDF/CSV in the isolated preview. Draft/Lines sheets retain exact
text quantities, estimates, revisions, supplier context and review warnings,
with filterable/frozen headings and safe literal cells. Missing prices remain
unavailable; oversized or ambiguous values are refused without truncation.
Typecheck, build, all 35 migration checks, 100 executed suites plus ten Windows
skips, actual Edge downloads and independent ZIP/XML/openpyxl checks passed.
Repeated exports preserve fictional source/DB snapshots and make no provider calls.

This is local preparation only. C4/C5/M8 remain open, and the online release
stays deferred. The server-authorized, revision-bound saved-draft export
foundation is now recorded above; document generation and signed-in manager
controls remain separate outcomes.

## Latest local C4 draft PDF — 2026-10-24

The [fictional draft PDF slice](C4_DRAFT_PDF_LOCAL_EVIDENCE.md) adds Download PDF
to the isolated draft/CSV preview. Supplier/account/location, proposal revisions,
whole packs, exact stock quantities, estimates and review warnings are preserved.
Every page is labeled as a fictional draft, missing prices stay unavailable,
and invalid sources are blocked. Typecheck, application build, migration checks,
99 executed suites plus ten Windows skips, actual Edge downloads and independent
PDF reading/rendering passed. Export leaves fictional source/DB snapshots intact.

This is local preview preparation only; no app API/schema or hosted deployment
changed. C4/C5/M8 remain open and the online release below remains deferred.
The follow-up Excel slice is recorded above; saved-draft integration remains separate.

## Latest development-release preparation — 2026-10-24

The [C2 release packet](C2_DEV_RELEASE_PREPARATION_20261024.md) is technically
prepared for application commit `911fcb1`. Today's read-only inspection confirms
the online Worker still runs `65373b3` and D1 still has `0000`–`0023`: all eleven
`0024`–`0034` migrations remain pending. Windows and Ubuntu GitHub CI passed for
`911fcb1`. Clover sync remains disabled, the expected nine secret-binding names
remain present, and no cron schedules are configured.

A private hosted backup was restored and upgraded locally: all 66 original
application/ledger tables and 474 rows were preserved, and 40 new tables stayed
empty. The resulting schema matches current source. Fresh local Wrangler apply,
focused tests, build, frozen deployment dry run, production-bundle local HTTP
and maintenance-response checks passed. The packet records a file-import plan
for the used `0027`/`0029` splitter grouping issues and coordinated `0034` fencing.

**The online update is deferred at the owner's request.** The owner confirmed
test data and no repository connected under Cloudflare Builds, then asked to
skip this release for now. The Builds report is owner attestation; API reads
still return 403. Keep the prepared candidate and private backup, and perform no
maintenance, remote migration or deployment until the owner requests resumption.
Local work may continue independently. No supplier/model execution or milestone
acceptance is advanced.

## Latest desktop verification — 2026-10-22

The clean checkout was fast-forwarded by 26 commits to GitHub `main` at
`7a516ea`. The [C2 local-readiness task](C2_LOCAL_READINESS_20261022.md) reproduced
the startup timeout, then restored local startup by excluding generated
runtime/state directories and other worktrees from Vite file watching. Source
edits still publish reloads. The final six-command pipeline passed: 98 executed
test suites plus ten explicit Windows skips, all 35 migration checks, build,
local migration application with nothing pending, and the fictional HTTP smoke.
Existing business rows and saved configuration were preserved.

This was desktop evidence only. Hosted facts and GitHub CI have since been
refreshed in the October 24 preparation above; signed-in hosted acceptance,
C4 browser/model gates and milestone completion remain separate.

## Verified snapshot — 2026-10-14

**The development foundations are accepted; the project is not ready for a real
café or production launch.** A1–A7, B1–B7 and C1–C2 are checked in the roadmap,
within their recorded development or sandbox scope. A8/M7 and C4/C5/M8 remain
open. B8/M6 remains on hold for Toast approval/testing access.

| Area | Verified position | Limit or next gate |
| --- | --- | --- |
| Shared source | GitHub `main` is `911fcb1`, including the October 20 fixes and October 22 local-startup repair. | The October 24 release packet prepares this application source; it has not been deployed. |
| GitHub verification | The [full Windows/Ubuntu CI run](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/39869805536) passed at `911fcb1`; today's API read also confirms successful Supabase Preview. | These are source/CI checks; they do not prove hosted signup/recovery, provider behavior or C4 acceptance. |
| Desktop local startup | The October 22 [C2 watcher repair and complete local pipeline](C2_LOCAL_READINESS_20261022.md) passed, including HTTP startup and actual source reloads. | Ten POSIX-specific suites are skipped on Windows. Earlier internal-runner failures remain historical; this is not a clean-cache reliability matrix, hosted validation or C4 acceptance. |
| Six correctness/security fixes | All six are locally closed; BUG-01 was already on `main`, and PR #9 integrated BUG-02–06. The final stacked local evidence records 82 suites and the full pipeline. | These fixes do not constitute a full security review or hosted acceptance. See the [fix checklist](CORRECTNESS_SECURITY_FIX_CHECKLIST.md) and [original local integration evidence](BUG06_COUNT_RECEIPT_RACES.md); current combined-source verification is recorded separately. |
| New C4 AI evidence | The [fresh full-gate attempt](C4_FULL_OFFLINE_GATE_20261014.md) stopped at reliability job 5; its partial cart, unresolved attempt and failed audit remain retained. The [credential-audit repair](C4_CREDENTIAL_AUDIT_REPAIR_20261015.md) passed locally. The October 15 [display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md) then passed twelve fresh jobs with 1,500 ms delays, sixty mocked requests, healthy power evidence and the 95-suite preparation pipeline: **not reproduced with display on; cause unresolved**. | C4/M8 and real-model acceptance remain open. Both invocations are consumed; no retry is authorized. Owned cleanup and business preservation passed; strict artifact preservation found seventeen changed older browser cache/QuotaManager files. Historical carts/holds remain retained. Separately scope causal investigation/repair or a fresh complete gate; paid execution stays blocked. |
| C4 preservation preflight | The [source-only profile guard](C4_PROFILE_PRESERVATION_PREFLIGHT_20261015.md), [stopped legacy cleanup](C4_LEGACY_PROFILE_CLEANUP_20261015.md) and [verification repair](C4_LEGACY_VERIFICATION_REPAIR_20261015.md) remain recorded. The [single remaining-profile attempt](C4_REMAINING_PROFILE_CLEANUP_20261015.md) passed eight focused suites and the 99-suite/full preparation pipeline, then stopped after SIGTERM only to leader 30082: captured helper 30095 had changed identity in a bracketed observation. | Eighteen historical processes are now gone; nine original processes rooted at 30474 and one live lock reference still block idle preflight. PID 4303 is absent, all 46 worker locks remain unarchived, and task guards are cleared. Both maintenance invocations are consumed; no retry or idle baseline followed. The earlier seventeen-file failure, partial cleanup audits and unresolved causes remain retained. |
| C4 isolated shutdown diagnosis | The [disposable-browser diagnostic](C4_SHUTDOWN_OBSERVATION_DIAGNOSIS_20261015.md) passed five focused suites, type checking, 100 test suites and build. Its sole invocation stopped during the first case after recording unchanged start times, changed command/executable metadata and a zombie transition; its additional metadata check labeled that `process_instance_changed`. | Matrix blocked: one attempted case, zero completed, eleven unstarted. All nine fixture processes are gone without additional cleanup signals; historical processes, all 46 locks, evidence, carts, business rows, budgets and consumed records are preserved. The diagnostic label overstates the metadata evidence. Repair diagnostic classification from the retained observation before separately scoping a fresh isolated run; no verifier-policy change, maintenance retry or historical cause determination followed. |
| C4 diagnostic observation repair | The [source-only repair and offline replay](C4_SHUTDOWN_OBSERVATION_REPAIR_20261015.md) passed five focused suites, type checking, 100 test suites and build. It observes shutdown text/zombie transitions without claiming PID reuse, independently detects helper 61598 despite the leader's first verifier failure, and retains primary diagnostic failures separately from audit failures. | Proof is offline: exit follows a simulated complete absence snapshot. Existing verification/signal/disposal policy, fixed root/matrix and consumed records are unchanged. No browser run, execution allowance or idle baseline was created. Historical evidence/business state, nine process identities and all 46 locks are preserved. Separately scope a fresh disposable matrix; C4/M8 and historical causes remain open. |
| C4 real lifecycle validation | The [single hardened-lifecycle Chrome matrix](C4_BROWSER_LIFECYCLE_VALIDATION_20261015.md) passed eight focused suites, type checking, 103 suites and build, then completed all twelve collected version-two cases. Independent audits passed: **reproduced**, four protocol-close signature cases, zero audit failures. | Historical identities, all 46 locks, protected evidence, carts, business rows, budgets and prior consumed attempts are preserved. Seven profile changes were confined to the profile already active initially. Invocation consumed; C4/M8, historical causes and the later idle gate remain open. Separately scope historical verification/disposition review; no cleanup or gate follows. |
| C4 historical shutdown review | The [read-only review and disposition plan](C4_HISTORICAL_SHUTDOWN_REVIEW_20261016.md) independently rechecked the twelve retained real cases and refreshed nine historical identities, canonical executable/profile ownership, all 46 lock metadata records and PID-4303 absence. Five completed protocol cases retain strict identity refusals; four match the narrower signature. Three simulated suites passed; executable source is unchanged. | The historical 30095 sample lacks transition-time start/command evidence, so its cause remains unresolved. Next: source-only separation of maintenance waiting from strict signal authorization, then separately scope one remaining-instance/stale-lock maintenance task. No cleanup, invocation, idle baseline or acceptance advance occurred. C4/M8 remain open. |
| C4 maintenance observation refinement | The [source-only refinement](C4_MAINTENANCE_OBSERVATION_REFINEMENT_20261016.md) passed 32 simulated actual maintenance lifecycles, independent auditing, five retained-transition replays, nine focused suites, type checking, 104 suites and build. Version-two inputs precede decisions; bounded waiting records terminal transitions separately from strict pre-signal checks. | Signal/reconciliation/consumption/archive primitives are unchanged. Historical identities, all 46 locks, evidence, business rows, budgets and consumed attempts are preserved; six profile differences are confined to the already-active profile. No cleanup, allowance or real validation ran. Next separately scope the one-instance/stale-lock maintenance plan and its collected evidence/idle gates; C4/M8 and historical causes remain open. |
| C4 single-instance maintenance preparation — Lane A | The [fixed runner/binding/adapter preparation](C4_SINGLE_INSTANCE_MAINTENANCE_PREPARATION_20261016.md) passed 21 injected controller modes plus concurrency/reuse/evidence-ownership cases, independent lock/process/stability checks, ten focused suites, type checking, 105 suites and build. Eight retained simulated proofs passed its offline audit and all failed the collected-evidence gate. Independent historical/business preservation passed; seven profile differences are confined to the already-active profile. | This result covers Lane A's original snapshot; combined verification and stricter proof reassessment are recorded below. No execution root, allowance, historical signals, lock archival, idle baseline or acceptance advance was created; C4/M8 remain open. |
| C4 combined maintenance preparation | The [parallel integration](C4_MAINTENANCE_PARALLEL_INTEGRATION_20261016.md) selectively integrates Lane B's auditor and adversarial suite, preserving its API. Thirty-two simulated lifecycles, 46 forged-proof refusals, two malformed-sample refusals, fixed-adapter optimization refusal, eleven focused suites, type checking, 106 suites and build passed on the combined frozen source. Seven retained proofs are valid offline; one deliberate permanent-write proof is held as truncated, with its primary retained. All eight fail collected acceptance. Independent historical/business preservation passed; six profile differences are confined to the already-active profile. | Source preparation is integrated; real maintenance remains separately scoped with immediate revalidation. No historical cleanup, lock archival, invocation/allowance, idle baseline or acceptance advance ran. C4/M8 and historical causes remain open. |
| C4 single-instance maintenance plan | The [read-only planning observation](C4_SINGLE_INSTANCE_MAINTENANCE_PLAN_20261021.md) found all nine captured 30474 members absent without a reboot. Active-profile writes ended at about 11:01 on 2026-10-21; exit cause unobserved. PID 4303 is absent, no process references a historical profile, and both preflight reads return `idle`. All 46 locks match exactly and no inactive profile changed. | Point observations only, not collected evidence. The fixed runner would now refuse at target validation: the owner retired it unexecuted and excluded stale-lock archival. Next: a source-only, signal-free observation-baseline entrypoint, then one separately authorized run. No signal, guard, archive, invocation, baseline or acceptance advance occurred; C4/M8 remain open. |
| C4 observation-baseline source | The [signal-free baseline entrypoint and independent auditor](C4_OBSERVATION_BASELINE_SOURCE_20261021.md) passed its focused offline lifecycle suite. That suite covers reuse, a race, reappearance, PID reuse, a live-lock flip, lock/singleton changes, write/audit failures and primary-failure preservation, with zero signal calls. Three planted defects were caught. Type checking, 109 suites and build passed. A live read-only dry check found every gate currently satisfiable. | No root, invocation or baseline was created, and no preservation audit was run for this source task. Next: one separately authorized Task 2 run with its documented preparation order. C4/M8 remain open. |
| C4 observation-baseline run | The [single authorized run](C4_OBSERVATION_BASELINE_RUN_20261021.md) **passed** and published a fresh baseline, with zero signals. All 27 historical PIDs and PID 4303 are absent. Preflight was idle throughout and all 46 locks are exact. Two equal 353,361-entry fingerprints were taken 6.83 s apart. Drift since 2026-10-16 is confined to the already-active profile. 24,564 evidence files, 494 carts and 46,678 business rows across 118 databases are preserved, and reserved exposure is unchanged. | Invocation consumed. Two uninvoked preparations exposed and fixed auditor scope defects first. This unblocks consideration of a separately scoped fresh full offline gate; it does not close C4/M8 or explain historical causes. |
| C4 fresh full offline gate scope | The [read-only scope](C4_FULL_OFFLINE_GATE_SCOPE_20261021.md) confirms that the existing runner is bound to the consumed October 14 root and source. Its preservation audit cannot open sidecar-less WAL copies and audits a hand-picked database set. | Next: G1, a source-only rebinding to a fresh root/policy with corrected preservation and the display-on power guard; then G2, one separately authorized run. A repeat second-addition failure would route to causal investigation. Nothing ran; C4/M8 remain open. |
| C4 full gate rebinding (G1) | The [source-only rebinding](C4_FULL_GATE_REBINDING_20261021.md) moves the gate to a fresh root and refuses the consumed October 14 root; the policy is unchanged. It adds a fixed capture over every local database, read-only WAL-copy opening, and a pre-invocation check that the published baseline still holds. Focused suites, type checking, 110 suites and build passed. The live `before` dry run passed. | The owner chose an external `caffeinate -di` for G2, with a repeat second-addition failure routing to investigation. Next: G2, one separately authorized gate run. Nothing ran; C4/M8 remain open. |
| C4 fresh full offline gate (G2) | The [single authorized gate](C4_FULL_OFFLINE_GATE_RUN_20261021.md) passed steps 1–14 under `caffeinate -di`. Reliability passed **30/30 ready** (300 mocked requests), and Metadata, served, safety, faults and all six pipeline commands passed. It stopped at step 15: `finishOfflineFixture` vacuums into a case directory that does not yet exist. All final audits passed; no historical row was changed and there were zero real requests. | Invocation consumed with six unrun steps. The reliability pass is not a causal finding. Next: a source-only repair of the cleanup directory with a regression test, then a separately authorized fresh gate. C4/M8 remain open. |
| C4 gate cleanup repair | `finishOfflineFixture` now creates the private case directory before `VACUUM INTO` and refuses symlinks. A [real-SQLite regression](C4_FULL_OFFLINE_GATE_RUN_20261021.md#repair--2026-10-21) covers it, and reverting the fix fails the suite. Type checking, 110 suites and build passed. | No real-browser check ran. G2's 133 recorded task profiles break G1's exact-baseline pre-check. Next: rebinding with a choice between allowing recorded gate profiles (recommended) or a fresh baseline, then a separately authorized gate. C4/M8 remain open. |
| C4 gate rebinding for the next gate | The owner chose to allow recorded gate profiles. The [rebinding](C4_FULL_GATE_REBINDING_20261022.md) consumes the G2 root and binds `…-20261022`. The pre-check accepts drift only inside profiles recorded by a consumed, invoked gate whose retained audits pass and whose referenced evidence is unchanged. Seven planted defects were caught. Type checking, 110 suites and build passed. A live read-only pre-check passed: 32,366 changed entries, all inside G2's 133 recorded profiles. | Nothing ran or was written. Next: one separately authorized fresh gate under `caffeinate -di`, whose step 15 is the first real-browser run of the cleanup repair. C4/M8 remain open. |
| C4 fresh full offline gate (G3) | After a CI portability fix (both platforms green), the [single authorized gate](C4_FULL_OFFLINE_GATE_RUN_20261022.md) passed **steps 1–20**. That includes 30/30 reliability and step 15, the first real-browser confirmation of the cleanup repair. It stopped at step 21, `cart:manager:check:launcher` (exit 1), about 9 s after the launcher's graceful restart. All final audits passed; no historical row changed and there were zero real requests. | Invocation consumed. The step-21 cause is not established because the safe log kept no error text. Next: an authorized isolated reproduction and repair, then rebinding and a separately authorized gate. C4/M8 remain open. |
| C4 step-21 reproduction and repair | An isolated clean-clone reproduction found a [harness restart race](C4_FULL_OFFLINE_GATE_RUN_20261022.md#step-21-cause-harness-restart-race--2026-10-24): Vite's reconnect reload aborted the post-restart navigation, and the cleanup assertion masked that error. The check now leaves the page before the restart and keeps the original failure; the launcher reports its cleanup categories. Six planted defects were caught; 111 suites passed; the real check passed 3/3 in isolation. | Gate not re-run. A read-only pre-check found four worker locks left by G3's deliberate crash scenarios. The rebinding needs an owner decision on them. C4/M8 remain open. |
| C4 gate rebinding for G4 | The owner chose to account for gate-left locks. The [rebinding](C4_FULL_GATE_REBINDING_20261024.md) consumes G3's root and binds `…-20261024`. The pre-check accepts an extra worker lock only if a consumed, passing gate recorded its profile, it holds that gate's recorded PID and its owner is gone; the 46 historical locks stay exact. Failed step logs now keep a fixed-shape summary (exit, error classes/codes, timeouts, repository file:line, cleanup categories) and never message text. Fifteen planted defects were caught; 113 suites passed. A live read-only pre-check passed with 4 accounted locks and 80,692 entries inside 329 recorded profiles. | Nothing ran or was written. Next: the separately authorized preparation, then one gate run under `caffeinate -di`. C4/M8 remain open. |
| C4 fresh full offline gate (G4), repair and G5 rebinding | The [single authorized gate](C4_FULL_OFFLINE_GATE_RUN_20261024.md) passed **steps 1–20** (30/30 reliability) and stopped at step 21 after that check's body passed. The new failure summary pinned the final graceful stop. The check revoked the supervisor's credential before stopping the launcher, so a discovery poll stopped it with exit 1, which an isolated revoke-then-stop run confirmed. Cleanup now stops the launcher first, then revokes and verifies HTTP 401 against the app alone. Nine planted defects were caught and one equivalent mutant noted; 113 suites passed, and the real check passed 3/3 in an isolated clone. The rebinding consumes G4's root and binds `…-20261025`; a live read-only pre-check passed with 8 accounted locks inside 527 recorded profiles. | All final audits passed and the invocation is consumed. Next: a separately authorized G5 preparation and gate run. C4/M8 remain open. |
| C4 fresh full offline gate (G5) | The [single authorized gate](C4_FULL_OFFLINE_GATE_RUN_20261025.md) **passed all 21 steps** on frozen source `4e986126…`, including 30/30 reliability, 50 AI-safety cases and step 21's first in-gate pass of both launcher repairs. Final audits passed: 179 credentials revoked with HTTP 401, processes and ports clear, and no historical row changed across 424 databases. Local mocked-provider evidence only. | The gate's own status keeps the second-addition timeout's original cause unresolved. No checkbox advances; C4/M8 remain open for the roadmap's remaining outcomes. |
| C7/M10 groundwork: owner spending limits (Part 1) | Per the [owner-approved plan](C7_OWNER_SPENDING_LIMITS_PLAN_20261025.md), the [server rules](C7_OWNER_SPENDING_LIMITS_LOCAL_EVIDENCE.md) let only the owner set a café time zone and per-order, per-day, optional per-month and in-progress limits. Each is an immutable, audited version, and loosening needs a recent password confirmation. Cart authorization refuses by limit, with amounts shown to owners only, and the reservation guard enforces local-day and local-month sums atomically. Migration `0035` is additive and local only. 117 suites, the full local pipeline and 17 planted defects passed. | Fictional, default-off preview only; no payment, supplier checkout control or purchasing. Next: Part 2, the owner settings screen. No checkbox advances; C7/M10 remain open. |
| C7/M10 groundwork: owner spending-limits screen (Part 2) and D1 repair | [Part 2](C7_OWNER_SPENDING_LIMITS_SCREEN_LOCAL_EVIDENCE.md) adds an owner-only **Spending limits** page in the cart preview. It shows current use and history, and tightening saves directly. Loosening and time-zone changes open a focused password prompt that resends the same request. Building it found that `0035`'s ISO GLOBs exceed D1's 50-byte pattern limit, so owner rows could not save on D1. Migration `0036` recreates the three guards with exact `strftime` checks, and a new suite fails any over-limit pattern. 20 planted defects were caught, the served browser check passed in an isolated clone, and the full local pipeline passed. | Practice sign-in has no password, so a confirmed loosening is proved by server/HTTP tests, not by hand. Hosted D1 has run neither migration. No checkbox advances; C7/M10 remain open. |
| C4 served check repair | Two older served checks (cart authorization and jobs) expected anonymous requests to get 401. Since the October 20 session-outage fix, the local cart preview returned 503, because its origin is not an accepted local origin. [The repair](C4_SERVED_CHECK_REPAIR_20261025.md) treats a request with no session cookie as anonymous before reading origin configuration. Present but unverifiable sessions still return 503. The security suite has new cases and a caught planted defect. Both checks pass unmodified, and so do the full pipeline (124 suites) and the related served checks. | Local only; no schema or data change. It corrects the Part 1 spending-limit record's attribution of the jobs check failure. |
| C4 supplier confirmation, Part 1: order-linked incoming port | Per the [owner-approved plan](C4_SUPPLIER_CONFIRMATION_PLAN_20261025.md), [A's port](C4_ORDER_INCOMING_PORT_LOCAL_EVIDENCE.md) was built in A's modules at the owner's request. It returns guarded statements for the caller's batch that add a confirmed order's frozen exact quantities to incoming exactly once, across products and beside manual incoming. It aborts all-or-nothing on any stale balance, legacy mirror or count. Manual `incoming` edits and receipts stay above what orders owe, and a database floor enforces it. Migration `0037` is local only. 12 planted defects were caught and 130 suites passed. | Nothing calls the port yet; Part 2's confirmation record will. Receiving is later. No checkbox advances; C4/M8 and A8 remain open. |
| Hosted development code | A read-only Cloudflare deployment inspection still shows release `65373b3`, deployed at `2026-10-05T02:50:23Z`; active Worker version `ed5e9c65-31b7-432f-bff9-bf4df45e9b68`. | The merged PR #8/#9 work has not reached this Worker. |
| Hosted development database | The read-only `d1_migrations` query returned 24 entries, `0000`–`0023`, with zero rows written and `changed_db=false`. Main contains 35 migrations. | All 11 migrations `0024`–`0034` are pending here. A release must review the entire ordered range, not just `0034`. This query did not inspect or validate all business data. |
| Runtime gates | Exact inventory preview is enabled; Clover sales sync is disabled. Supplier submission and automatic purchasing remain disabled. | Existing gate state is not approval to use real services or place orders. |
| Cloudflare Git/build connection | The Workers Builds trigger and build APIs both returned `403` with the existing credential. | Automatic deployment configuration remains independently unverified. GitHub CI success does not prove Cloudflare Builds is configured. |

Deployment, database, binding and schedule reads were refreshed on 2026-10-24.
A private read-only export was used for the release rehearsal. No remote
migration, deployment, supplier/POS call, purchase or historical stock repair
was performed. Earlier supplier evidence retains its own dates and limitations.

## Current next-step checklist

The incoming CI failure is handled by the focused C2 portability repair in
[PR #10](https://github.com/magkaniotisleonidas28-star/Pantrack/pull/10), with
verification recorded in the [sync handoff](C2_STATUS_SYNC_20261013.md). The
project order continues below.

Desktop startup is now verified locally after the separate
[October 22 watcher repair](C2_LOCAL_READINESS_20261022.md). Existing stock/history
and private configuration remain intact. The earlier CI portability repair and
hosted acceptance remain separate evidence.

1. **C2: development release deferred by owner.** The
   [October 24 packet](C2_DEV_RELEASE_PREPARATION_20261024.md) reviews the complete
   `0024`–`0034` upgrade, populated-data preservation, backup/restore and forward
   repair. The owner confirmed test data and no connected Builds repository;
   retain those answers and revalidate current state when resuming. BUG-02
   requires coordinated runtime/migration rollout with sales ingestion and
   recovery paused. See its
   [rollout limits](BUG02_SALES_OUTCOME_RECOVERY.md#compatibility-repair-and-rollback).
   Technical preparation is complete. Leave execution on hold until the owner
   requests it and authorizes that release.
2. **C2/A/B: validate the released fixes with fictional hosted data.** After an
   authorized development release, verify sign-in, inventory/history, sales
   recovery/readiness and count/planning regressions. Record results separately
   from the local and CI passes; do not bulk-repair old balances.
3. **A8: finish M7 acceptance.** Capture hosted manager/browser, end-to-end and
   concurrency/source-change evidence using the accepted B7 development inputs.
   Keep the accepted ten-minute freshness policy and purchasing disabled.
4. **C3/C4: finish supplier preparation and controlled feasibility in parallel.**
   Record permitted Baldor browser use, account/location/product mappings,
   responsible owners and budgets. The AI reader/Metadata preparation is now
   implemented. The historical full gate failed at reliability job 25; the
   bounded follow-up passed twelve normal jobs without explaining it. The
   [fresh full-gate attempt](C4_FULL_OFFLINE_GATE_20261014.md) then stopped at
   reliability job 5 and retained a separate terminal-revocation audit defect.
   The [source-only audit repair](C4_CREDENTIAL_AUDIT_REPAIR_20261015.md) now passes
   repeated cleanup without replaying jobs. The [display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md)
   passed twelve delayed fresh jobs: not reproduced with display on; cause
   unresolved. Its owned-resource cleanup passed; strict preservation found
   seventeen changed cache/QuotaManager files in older browser profiles.
   The [profile preservation preflight](C4_PROFILE_PRESERVATION_PREFLIGHT_20261015.md)
   now blocks new execution before invocation consumption while historical
   profiles are active or their evidence is unavailable. The
   [single legacy maintenance attempt](C4_LEGACY_PROFILE_CLEANUP_20261015.md)
   stopped during verification after SIGTERM to the first instance; nine
   processes are gone, with 18 processes/three live lock references remaining.
   The [source-only verification repair](C4_LEGACY_VERIFICATION_REPAIR_20261015.md)
   now records named failures and tests exits between system snapshots; its
   98-suite/full pipeline and preservation audit passed. No new cleanup ran.
   The [single remaining-profile attempt](C4_REMAINING_PROFILE_CLEANUP_20261015.md)
   passed eight focused suites and the 99-suite/full preparation pipeline, then
   stopped after SIGTERM to 30082 when captured helper 30095 changed identity;
   `observations/000006.json` retains the precise refusal. Nine processes rooted
   at 30474 and one live lock reference remain. PID 4303 is absent, the stale lock
   is unchanged, and task guards are cleared. No lock archive or idle baseline
   exists. Separately scope read-only review of the identity-change evidence and
   remaining disposition before a fresh complete gate. Both maintenance attempts
   are consumed and must not be retried; paid validation remains blocked.
   The [isolated shutdown diagnosis](C4_SHUTDOWN_OBSERVATION_DIAGNOSIS_20261015.md)
   passed five focused suites and its three-command preparation (100 test
   suites), then stopped in the first disposable case on changed executable
   text with unchanged start times and a zombie transition. All fixture
   processes are gone; historical resources and business state are preserved.
   Its matrix is blocked and invocation consumed. Repair diagnostic
   classification from retained field-level evidence before separately scoping
   a new isolated matrix; no historical verifier repair or cleanup retry follows.
   The [source-only observation repair](C4_SHUTDOWN_OBSERVATION_REPAIR_20261015.md)
   now passes retained-transition replay and independent analysis, five focused
   suites, type checking, 100 test suites and build. Observation continues through
   text/zombie changes while start/topology/membership mismatches still block;
   existing signal/disposal checks are unchanged. Historical evidence and the
   consumed real diagnostic remain untouched. A fresh disposable matrix must be
   separately scoped; no browser invocation or historical cleanup follows here.
   The [fresh disposable matrix](C4_SHUTDOWN_OBSERVATION_MATRIX_20261015.md)
   passed six focused suites, type checking, 101 test suites and build, then
   stopped at `protocol-0-2` with `fixture_baseline_unverified`. Eight cases were
   attempted, seven completed, four completed cases contain the signature and
   four cases remain unstarted. The matrix is blocked and its new invocation
   consumed. All fixture processes are gone; independent checks passed with
   historical resources/business state preserved. No rejected startup population
   was retained, so the baseline refusal's cause is unestablished. Separately
   scope read-only review and, if needed, source-only startup evidence work;
   no retry, historical cleanup, idle baseline or gate follows. C4/M8 remain open.
   The [source-only lifecycle consolidation](C4_BROWSER_LIFECYCLE_SOURCE_REVIEW_20261015.md)
   now passes 130 simulated trials, complete/partial actual-controller and
   independent-auditor integration, seven focused suites, type checking,
   102 test suites and build. Version-two startup samples are persisted before
   admission decisions, and primary failures survive cleanup/report errors.
   Historical resources/business state and all consumed attempts are preserved.
   Existing admission, deadline and signal policies remain in force. No browser,
   new allowance or real validation ran. Review the offline proof and limits
   before separately scoping any fresh real validation; C4/M8 remain open.
   The subsequent [single real lifecycle validation](C4_BROWSER_LIFECYCLE_VALIDATION_20261015.md)
   passed eight focused suites and frozen type checking, 103 suites and build.
   All twelve collected version-two Chrome cases completed; four protocol-close
   cases contain the signature: **reproduced**, with all independent audits
   passing. Historical resources, evidence, business rows, budgets and prior
   consumed attempts are preserved; seven profile changes are confined to the
   profile already active initially. This invocation is consumed. No historical
   cause is resolved, and C4/M8 remain open. Next separately scope read-only
   historical verification/disposition review; no retry, cleanup, idle baseline,
   full gate or paid run follows from this pass.
   The [read-only historical shutdown review](C4_HISTORICAL_SHUTDOWN_REVIEW_20261016.md)
   now refreshes the nine original identities, canonical executable/profile
   ownership, all 46 exact lock metadata records and PID-4303 absence. It
   independently rechecks the retained twelve-case evidence: five protocol cases
   contain the unchanged strict verifier's identity refusal, while four meet the
   diagnostic signature. Historical helper 30095 lacks the start/command evidence
   needed for a causal conclusion. Three simulated suites passed; source,
   identities, locks and business state are preserved. Six profile differences
   are confined to the profile already active initially. The next unblocked C4 task is source-only
   separation of maintenance shutdown waiting from strict signal authorization,
   followed by a separately scoped one-instance/stale-lock maintenance plan.
   No cleanup or new invocation ran; no idle baseline or C4/M8 acceptance follows.
   The [source-only maintenance observation refinement](C4_MAINTENANCE_OBSERVATION_REFINEMENT_20261016.md)
   now passes 32 simulated actual lifecycles, independent auditing, five retained
   transition replays and nine focused suites, followed by frozen type checking,
   104 suites and build. Inputs are saved before decisions; bounded waiting
   records terminal transitions while every individual signal retains fresh
   strict verification. Historical processes, all 46 locks, protected evidence,
   carts, business rows, budgets and consumed attempts are preserved; six profile
   differences are confined to the profile already active initially. No cleanup,
   new allowance, real maintenance or idle baseline followed. Next separately
   scope the review's one-instance/stale-lock maintenance plan with collected
   evidence and independent idle/stability/preservation gates. C4/M8 and
   historical causes remain open.
   The [maintenance plan](C4_SINGLE_INSTANCE_MAINTENANCE_PLAN_20261021.md) then
   found the 30474 instance already gone and preflight `idle` without any
   signal. The exit cause is unobserved. The owner retired the fixed runner
   unexecuted and excluded stale-lock archival. The next unblocked C4
   task is a source-only, signal-free observation-baseline entrypoint with
   collected idle/stability/preservation audits, followed by one separately
   authorized run. C4/M8 remain open.
   That [observation-baseline source](C4_OBSERVATION_BASELINE_SOURCE_20261021.md)
   now passes its focused offline suite, type checking, 109 suites and build,
   with zero signal calls. The [authorized baseline run](C4_OBSERVATION_BASELINE_RUN_20261021.md)
   then passed and published a fresh baseline with zero signals. The next C4
   item is to separately scope a fresh full offline acceptance gate. C4/M8 and
   historical causes remain open. That [gate scope](C4_FULL_OFFLINE_GATE_SCOPE_20261021.md)
   now defines G1, source-only rebinding with corrected preservation and a power
   guard, followed by G2, one separately authorized run. [G1](C4_FULL_GATE_REBINDING_20261021.md)
   is complete with 110 passing suites. The owner chose an external `caffeinate -di`
   for G2 instead of a power guard. [G2](C4_FULL_OFFLINE_GATE_RUN_20261021.md)
   passed steps 1–14, including 30/30 reliability, then stopped at step 15 on a
   harness cleanup regression; all final audits passed. Next is a source-only
   repair of `finishOfflineFixture`, followed by a separately authorized fresh gate.
   That repair is done. The next gate first needs rebinding, because G2's recorded
   task profiles break the exact-baseline pre-check. That [rebinding](C4_FULL_GATE_REBINDING_20261022.md)
   is done, accepting only drift recorded by audited gates. [G3](C4_FULL_OFFLINE_GATE_RUN_20261022.md)
   then passed steps 1–20 and stopped at step 21, the launcher restart check, with
   all audits passing. Its isolated reproduction found a harness restart race,
   which is now repaired. The [G4 rebinding](C4_FULL_GATE_REBINDING_20261024.md)
   accounts for the four worker locks that G3's deliberate crash scenarios left
   and keeps safe failure summaries. [G4](C4_FULL_OFFLINE_GATE_RUN_20261024.md)
   then passed steps 1–20 and stopped at step 21's final graceful stop: the check
   revoked the supervisor's credential before stopping the launcher. That order is
   repaired. [G5](C4_FULL_OFFLINE_GATE_RUN_20261025.md) then **passed all 21
   steps and every final audit**; this is local mocked-provider evidence only. The
   second-addition timeout's original cause stays unresolved. Next is an
   owner-chosen C4 outcome that does not overlap the concurrent PDF/XLSX export
   snapshot work.
   Existing consumed allowances and unresolved carts stay retained. Hosted/model tests have their
   own configuration, budget and authorization gates.
5. **C5: finish and accept M8 after M7 and the supplier gates.** Complete verified
   cart/human handoff, PDF/XLSX/history, confirmation and atomic receiving; then
   run the separately authorized supplier cart-only and manager checkout tests.
6. **Later: operations, controls, pilot and release.** Complete C6/M9 and C7/M10,
   resolve B8/M6 when approved Toast access arrives, then run the two reviewed
   M11 pilot cycles before M12 production readiness. M13/M14 stay deferred.

No existing acceptance checkbox is advanced by this status refresh. The detailed
milestone table and earlier implementation records below retain their evidence
and scope.

The initial documentation refresh ran `pnpm test:focused replenishment-proposal
replenishment-lifecycle-contract replenishment-lifecycle-d1` and passed all three
suites in this checkout. `git diff --check` and all 191 relative file/section
links across the three changed documents passed; all 29 A/B/C statuses in the
simple guide matched the roadmap. That initial pass changed documentation only.
The subsequent source/CI synchronization and combined pipeline are recorded in
[the C2 sync handoff](C2_STATUS_SYNC_20261013.md). No new migration or application
API was introduced. Changed source fingerprints require fresh acceptance-gate
evidence; this repair never grants a paid run.

## What is complete

### M0 — local development baseline

Complete and merged into `main` in commit `0a6986e`.

- The repository runs locally with Node 22.23.2 and pnpm 11.25.0.
- At M0 acceptance, a local Cloudflare-compatible D1 database applied the nine
  then-existing migrations; the current source contains 35.
- Local-only variables, database state, dependencies, and generated secrets are
  ignored by Git.
- The home page, local sign-in fixture, company creation, company isolation, and
  sign-out were exercised through a real local HTTP smoke test.
- Setup, reset, run, and verification commands are documented in
  [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).
- Supplier submission and automatic ordering are blocked on the server until the
  supplier and reviewed-pilot milestones have real evidence.

### M1 — repository quality and CI

Complete and merged into `main` in commits `141fb31` and `703e5e4`.

- GitHub Actions runs on Ubuntu and Windows for every pull request and `main`.
- CI installs the locked dependencies, type-checks, runs all tests, checks schema
  and migrations, builds the Worker, applies local D1 migrations, and exercises
  the HTTP smoke test.
- CI correctly fails for a deliberate type error, a deliberately failing test,
  schema drift, missing migration entries, and SQL/schema mismatch.
- Earlier `main` commit `7a35004` passed CI on both operating systems:
  <https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/38500454965>.
- Contributor guidance and the pull-request template are in
  [CONTRIBUTING.md](../CONTRIBUTING.md) and [the PR template](../.github/pull_request_template.md).

## Existing prototype features

These features exist in the imported code and have local or mocked tests. They
are not proof of live production integration.

- Company workspaces, product catalog, inventory counts/receipts/use/waste, and
  recipes.
- Manual sales imports, CSV preview/import, register mappings, and an authenticated
  register bridge with duplicate protection.
- Target-stock calculations, supplier-pack rounding, review proposals, vendor
  connection framework, and scheduled-check endpoint.
- Clover OAuth authorization/menu loading, a gated sales adapter with bounded
  accepted sandbox evidence, and hosted Stripe payment-method setup.

The following remain unverified for real-business use: production Clover sales
sync and excluded sandbox cases, a second POS, a real supplier adapter, live payments,
provisioned background jobs, and automatic purchases.

## M2 implementation

The approved Supabase/Cloudflare design is implemented on `main`. Seven-day single-use invitations, membership roles, protected ownership transfer, account recovery, CSRF protection and security history have automated coverage. The owner completed and accepted a development-provider walkthrough of password rules, confirmation, sign-in/out, fictional-company roles, invitation, ownership transfer, recovery, concurrent-session revocation, and security history. The membership panel still required a full page refresh after acceptance in another browser; the owner accepted that limitation. The owner reports that a replacement Cloudflare build works, accepted that build step without a run link or commit record, and explicitly directed C1/M2 to be treated as complete on 2026-09-23. The owner subsequently reported completing the additive migration and authentication review. The [C2 closeout](C2_M2_CLOSEOUT.md) records that report, a separate agent inspection, the complete local pipeline, and deployment limits; no owner-authored review findings were supplied. This is owner-accepted development evidence, not independent security verification or production approval. See [setup](M2_SETUP.md), [decision record](decisions/0001-m2-authentication.md), [local evidence](M2_LOCAL_EVIDENCE.md), and [development auth evidence](M2_DEV_AUTH_EVIDENCE.md).

## M3 development acceptance

A4's persistent exact inventory behavior is implemented and passes the complete
local pipeline. It includes exact curated/custom unit classification, atomic
stock movements and physical-count reconciliation, immutable recipe/modifier
versions, the durable A-to-B consumption port, migration guardrails, and
company/role authorization coverage. The manager UI and exact API are behind
`PANTRACK_EXACT_INVENTORY_PREVIEW=enabled`; the gate is off by default. B4's
local implementation now uses that same gate for the coordinated durable-sales
and exact-inventory cutover. See [M3 local evidence](M3_LOCAL_EVIDENCE.md) and
[B4 local evidence](M4_B4_LOCAL_EVIDENCE.md).

The owner read the [M3 evidence](M3_LOCAL_EVIDENCE.md) and
[A5 review](M3_A5_OWNER_REVIEW.md) and accepted A5/M3 for development on
2026-09-23. A separate [A5 acceptance record](M3_A5_ACCEPTANCE.md) documents
the independent AI migration review and the owner's 2026-09-24 reaffirmation
of local development acceptance; that decision did not authorize a remote
migration or deployment. Person B's compatibility review found no
inventory-specific workaround. The fictional older-data screen walkthrough
passed, and viewing it changed no stock or recipe. The complete local pipeline
passed again for A5.
This opened M3's prerequisite for B5; M4's subsequent local acceptance is
recorded below. Development D1 and the Worker now have separate
[hosted validation evidence](C2_HOSTED_DEV_EVIDENCE.md). The exact preview was
off again after that fictional walkthrough; the [W1/W2 release](C2_W2_HOSTED_RELEASE.md)
now enables it for hosted development usability review. The owner authorized
a `main` push
even if the replacement Cloudflare connection auto-deploys.

## M4 local-development acceptance

The accepted [B1 design](decisions/0003-m4-sales-ingestion.md), B2/B3 tests and
data foundations, and B4 exact-sales integration are on `main`. The B4
[local closeout](M4_B4_LOCAL_EVIDENCE.md) includes the employee-status privacy
follow-up, an isolated fictional served check, and a complete local pipeline
rerun on 2026-09-24. The owner accepted the completed B4 local artifacts on
2026-09-24. B5/M4 is accepted for local development on 2026-09-24, supported by
the [B5 evidence](M4_B5_LOCAL_EVIDENCE.md): concurrency, recovery, authorization,
privacy, compatibility, an isolated fictional gate-on served walkthrough, and
green Ubuntu and Windows CI on the B5 branch and merged `main` commit. The B5
walkthrough found and fixed a D1 batch-acknowledgment defect during held-event
replay. At that B5 assessment, native Clover authentication/signatures and sandbox
cases were not verified; the later bounded [B7 acceptance](M5_B7_ACCEPTANCE_REVIEW.md)
is recorded separately. Development D1 `0012` and a fictional hosted Worker
walkthrough have now been verified separately in
[C2 evidence](C2_HOSTED_DEV_EVIDENCE.md). The exact preview is now enabled
for the [W1/W2 hosted release](C2_W2_HOSTED_RELEASE.md); Clover sync stays off.

## Deployment health

On 2026-10-04, the [C2 UI release](C2_UI_RELEASE_20261004.md) committed the
Inventory, Waste, stock/recipe forms, catalog and balanced workspace layouts as
`65373b3` on `main` and deployed them to `pantrack-dev`. The owner authorized the
two pending main-branch development migrations, `0022` and `0023`, including
fresh sign-in. A private backup, maintenance cutover and post-migration comparison
preserved 63 existing tables; only the migration ledger and expired sessions
changed. Development D1 now has `0000`–`0023`. The complete isolated local pipeline,
GitHub CI, hosted anonymous/auth-page HTTP checks and served UI assets passed.
All nine secret bindings remain; exact preview stays enabled, while Clover sync
and purchasing stay disabled. Owner fresh sign-in and hosted UI review remain
separate from these HTTP checks. No production or integration acceptance changed.

On 2026-10-01, the [C2 W1/W2 release](C2_W2_HOSTED_RELEASE.md) deployed
Waste, recipe/stock setup and package measurements through `d84078e` to
`pantrack-dev`. Development D1 at that release had `0000`–`0021` applied, with
a private backup, verified trigger-import recovery and unchanged inventory/history.
Exact inventory is enabled for hosted usability review; Clover sales sync,
supplier submission and automatic purchasing remain disabled. The complete
local pipeline and signed-in fictional hosted form/theme checks passed.

On 2026-09-23, the new development D1 database in Cloudflare account
`46a94b92309dd488dadd02f6ae70e0ff` was migrated through `0011`. Wrangler
reported no pending migrations before this integration introduced `0012`.
Remote `migrations apply` failed on `0008` with `incomplete input`; unchanged
migrations `0008`–`0011` succeeded through Wrangler's file import path, and the
ledger and schema were verified. See the
[recovery note](M2_SETUP.md#development-d1-trigger-migration-recovery).
On 2026-09-24, `0012` applied to that development D1 database. Its ledger and
tables were verified, with no pending migration. The newly deployed development
Worker passed hosted HTTP and fictional sign-in/inventory/sale checks; see
[C2 hosted evidence](C2_HOSTED_DEV_EVIDENCE.md). No production acceptance is
claimed.

At the earlier documentation-repair commit `333dbbd`, repository CI was green
([run 35426054567](https://github.com/magkaniotisleonidas28-star/Pantrack/actions/runs/35426054567)). The separate
[Cloudflare Workers build](https://github.com/magkaniotisleonidas28-star/Pantrack/runs/105852072919)
for that commit failed. The owner removed the misconfigured deployment and
integration, reports a replacement build is working, and accepts the build step
as complete. Its run link, tested branch, and commit are not recorded here, so
this is owner attestation rather than independently checked build evidence.
That earlier build report remains owner attestation; the separate development
Worker deployment and hosted behavior are documented in the C2 evidence.
The Supabase Preview check passed, but that check does not prove that Pantrack's
email templates, callback URLs, runtime variables, or authentication walkthrough
are configured and working. Keep production data and real users out of this
environment until separately reviewed release evidence exists.

## Your setup status

| Service | Reported status | Still needed |
| --- | --- | --- |
| GitHub | New source `de970c8`/`12de73b` is preserved. Its missing-tool CI failure is repaired; Ubuntu/Windows checks pass at `456ad67`. PR #10 records the final checklist/portability follow-up. | Keep `main` as the only long-lived branch. Require passing checks on the final PR head before integration. |
| Supabase | The owner accepted the development-provider manual walkthrough using fictional accounts and reports completing the authentication and migration review. The [C2 closeout](C2_M2_CLOSEOUT.md) records that report and an agent inspection. Automated provider tests remain separate. | Hosted signup/recovery callbacks and independent security review remain release follow-ups. |
| Cloudflare | Read-only checks on 2026-10-13 show Worker release `65373b3` and development D1 through `0023`; see the [C2 UI release](C2_UI_RELEASE_20261004.md). Workers Builds configuration is inaccessible with the current credential. | Prepare and separately authorize the code/`0024`–`0034` release, then record hosted checks. Keep Clover sync and purchasing disabled. Hosted signup/recovery callbacks and independent security review remain release follow-ups. |
| Custom domain | The user reports that the domain is already in Cloudflare. No Worker route has been verified. | Decide whether to attach the domain after the development `workers.dev` validation; the current hosted evidence uses that URL. |

Never send, commit, or paste Supabase keys, Cloudflare API tokens, OAuth secrets,
supplier credentials, or payment details into chat or source control.

## Implementation history and prior handoffs

The following records describe earlier slices and their then-current handoffs.
Use the dated snapshot and current next-step checklist above for today's order.

The [C4 main integration](C4_MAIN_INTEGRATION_20261007.md) now preserves the
shipped UI and auth fixes while regenerating local-only purchasing migrations
as `0024`–`0026`. All 49 suites and the full local pipeline passed in its isolated
worktree, including a populated-main upgrade preserving 65 existing tables.
Purchasing remains disabled; hosted CI and merge status are tracked separately.

C4's [supplier engine backend](C4_SUPPLIER_ENGINE_LOCAL_EVIDENCE.md) now passes
local simulation checks: exact quote approval, company/role guards, durable
send claims, spending/source holds, duplicate prevention and uncertain-result
reconciliation. Additive migration `0024` is local only. The original 41-suite verification
predates main integration; current evidence is recorded separately. The separate
[fictional manager order-draft preview](C4_ORDER_DRAFT_LOCAL_EVIDENCE.md) now
consumes unchanged v1/v2 proposals and provides review, copy and CSV download at
`http://127.0.0.1:5180` using `pnpm dev:order-draft`. Its original 42-suite local verification passed. It has no production application route, database access
or supplier transport. Baldor's published access restrictions keep portal
automation outside that fictional slice. Supplier replies are not a prerequisite
for that demonstration.

The [2026-10-09 decision](decisions/0005-po-backed-ai-cart-preparation.md)
supersedes the 2026-10-03 email-first direction. The [rollout](PURCHASE_ORDER_ROLLOUT.md)
and [integration guide](PO_AI_CART_INTEGRATION_ROADMAP.md) retain POs as purchasing
records and plan Stagehand/Browserbase cart preparation with manager checkout.
AI never checks out. Weekly scheduling creates drafts/reminders; managers start
preparation. Cloudflare stays authoritative and a Render Node 22 worker is planned.
Sign-in/checkout are desktop-first; review/status/receiving remain responsive.
PDF/XLSX, history and delivery reconciliation remain required; supplier email
infrastructure is deferred. APIs remain optional M13 and AI checkout/unattended
purchasing is separate M14 work. Unrelated POS/release gates remain.
The new [C4 PO foundation](C4_PO_FOUNDATION_LOCAL_EVIDENCE.md) adds persistent
manual stock/non-stock and immutable proposal drafts, company/manager guards,
replay-safe creation/cancellation and history behind a default-off preview.
Migration `0025` is local only. Run `pnpm dev:purchase-orders` for an isolated
fictional workspace at `http://127.0.0.1:5179`. The
[C4 supplier registry](C4_SUPPLIER_REGISTRY_LOCAL_EVIDENCE.md) now adds versioned
company suppliers/accounts/locations, supplier-specific exact packs and immutable
registry-backed drafts. Original local evidence covers 46 suites and
Safari desktop/narrow review; migration `0026` is local only. The mapping
projection is review-only; production A proposal integration remains separate.
The [C4 draft review slice](C4_PO_REVIEW_LOCAL_EVIDENCE.md) now adds audited edits,
immutable revision history and owner/manager review, including own-draft review.
Saved edits invalidate review. Migration `0027` is local only; 50 suites, the full
local pipeline and served desktop/mobile/recovery checks passed. Review does not
approve a purchase. True approval next requires A/C quantity commitments,
duplicate-source prevention and owner spending controls. PDF/XLSX, cart execution and
A-owned confirmation/receiving remain separate outcomes. No supplier email,
purchase approval, reservation, inventory change or real order is enabled.
C4/M8 acceptance remains open and purchasing stays disabled.

The owner selected AI-assisted cart preparation as the purchasing direction,
subject to the integration guide's unchecked implementation and acceptance gates.
The [C4 cart preview](C4_CART_PREVIEW_LOCAL_EVIDENCE.md) now extends reviewed drafts
with an isolated fictional storefront, visible browser, exact cart checks,
durable recovery and manager handoff. Both layouts passed 16 offline browser
scenarios; real-AI evaluation is pending at the owner's request. Baldor remains
the intended first real supplier, with permitted access and compatibility
unverified. This bounded experiment preserves the PO audit record and all
approval/confirmation/receiving gates; it does not enable supplier purchasing.
The [bounded PO/cart contract slice](C4_PO_CART_CONTRACT_LOCAL_EVIDENCE.md) adds
immutable exact preflight inputs and authorization checks against fictional data.
It issues no durable preparation grant or reservation; production mappings, D1
cart jobs, Browserbase/Render integration and real-AI evaluation remain pending.
Model configuration, distinct hosted-service budgets, supplier permission and
café participation are external gates; no paid hosted test or account use is authorized.

The next [C4 durable authorization slice](C4_PO_CART_AUTHORIZATION_LOCAL_EVIDENCE.md)
now saves fictional manager permission, exact A/C product commitments, cap exposure,
audit and permanent actor-bound replay receipts atomically. The default-off loopback
API revalidates current sources/membership; PO changes invalidate permission, safe
preparation cancellation releases once, and started work retains unresolved exposure.
Migration `0028` is local only. All 56 suites, the full local pipeline, fresh D1 and
populated upgrade, served authorization/cart API and 16 browser regressions passed.
Fictional $500/order and $1,000 outstanding policies are explicit test fixtures;
real owner financial controls remain pending. Durable jobs/fencing were the next slice;
production mappings, hosting, real-AI/supplier/pilot evidence and C4/M8 remain open.

The [C4 durable fictional job protocol](C4_PO_CART_JOBS_LOCAL_EVIDENCE.md) now adds
one job per permission, exclusive account-cart ownership across delivery locations,
60-second fenced leases, immutable attempts/results and permanent replay receipts.
First attempt and permission start are atomic. Never-attempted expired work can
recover; uncertainty and started cancellation retain cart, quantity and budget holds.
Migration `0029` is local only. All 60 suites, full local pipeline, fresh D1/populated
upgrade, disk restart, served manager APIs and 16 browser regressions passed.
That slice used internal fake workers; the transport follow-up is recorded below. Browser/session
integration, hosting, financial controls, supplier/pilot evidence and C4/M8 remain open.

The [C4 authenticated worker transport](C4_PO_CART_WORKER_LOCAL_EVIDENCE.md) now
adds scoped expiring bearer credentials, transactional revocation guards, private
HTTP projections and a separate HTTP-only Node 22 fake worker with durable UUID/outcome
journals. Migration `0030` is local only. All 65 suites, full pipeline, fresh/populated
upgrade, competing processes/crash recovery, served D1 and 16 browser regressions
passed. Rotation preserves identity/receipts; lost attempt acknowledgements cannot
repeat provider calls. The worker transport gate is off by default. The local browser
consumer follow-up is recorded below; C4/M8, hosting and external acceptance remain open.

The [C4 local browser consumer](C4_PO_CART_BROWSER_LOCAL_EVIDENCE.md) now connects a
separate deterministic Node 22 browser worker to authenticated HTTP. Additive local
migration `0031` separates fake/browser consumers and preserves immutable baseline
and final-cart evidence. Browser line results cannot mark a job ready; the server
requires a fresh exact complete cart within the cap. Private profiles, account locks,
safe HTTP replay and conservative crash/uncertainty holds preserve existing work.
That browser slice excluded manager UI, hosting, AI evaluation and real supplier
access. Its manager integration follow-up is recorded below; C4/M8 remain unchecked.

The [C4 manager Prepare/status slice](C4_PO_CART_MANAGER_LOCAL_EVIDENCE.md) now
connects explicit preparation authorization, durable enqueue, reload/replay recovery,
line/final verification and active cancellation to the manager panel. One default-off
local command provisions a reviewed fictional draft and supervises separate HTTP
browser workers with private session/journal reuse. No migration was added in that
slice. The [supervised practice browser follow-up](C4_PO_CART_BROWSER_SESSION_LOCAL_EVIDENCE.md)
now adds manual fictional sign-in, read-only inspection and explicit Close/Resume
with durable account ownership. Local migration `0032` preserves existing records;
only never-attempted, freshly verified sign-in holds can resume. Attempted or
uncertain carts can now be resolved through the [audited reconciliation
slice](C4_PO_CART_RECONCILIATION_LOCAL_EVIDENCE.md): managers accept a freshly verified
exact cart or abandon a verified baseline-matching cart, with immutable history and
atomic exposure release. Local migration `0033` preserves prior records. The
[optional Stagehand reader](C4_PO_CART_AI_LOCAL_EVIDENCE.md) now adds structured
product discovery and independent baseline/final cart extraction to the durable
worker, behind a dedicated evaluation command. The older and new evaluators share
one persistent cumulative $5 budget, preserving earlier reservations. Offline
verification and the full local pipeline pass. The real-model retry passed all six
rows-layout cases, then stopped at compact/normal on an add-response timeout;
40 of 72 required requests completed. The held cart and all reservations remain
intact: $0.704956 reserved cumulatively, with an owner-reported $0.04 balance
decrease. The previous task's paid retry is exhausted. The subsequent bounded
offline investigation passed all 60 fresh jobs across both layouts/readers and
0/750/1,500 ms delays, but did not reproduce or explain the interruption. Private
diagnostics, evaluator readiness/full-matrix budget preflight and scoped crash-test
cleanup are now implemented. The newly authorized single paid matrix initially
remained blocked and unconsumed. The 2026-10-13 targeted follow-up also passed all 24 fresh
jobs comparing diagnostics off/passive/form, uneven Stagehand callback timing and
both sides of the 20-second heartbeat. No failure or causal lead emerged, so its
12 confirmation slots were unused and investigation stopped. The full local
pipeline passed with 80 suites; no new paid calls were made during that follow-up.
The user subsequently replaced the causal-fix prerequisite with one instrumented
real matrix after every fresh offline gate. Passive provider/browser diagnostics
and the sequential frozen-source gate passed all 20 fresh checks, including the
full local pipeline with 81 suites. The one paid invocation passed rows/normal,
then stopped at rows/malicious on `AI_INCOMPLETE_EXTRACTION` during catalog
metadata, before any addition in that case. All 14 provider requests completed;
the failed cart retained its baseline. The existing allowance is consumed, with
no paid retry. Retained cumulative reservations are now $0.921518; actual new
billing remains unverified. Credentials were revoked and task previews stopped.
The historical timeout remains unresolved and real-AI acceptance is incomplete.
The subsequent offline metadata audit documents the installed callback contract
and adds private numeric verdict categories without changing strict completion
or readiness checks. All 16 fresh synthetic browser cases passed: four exact
ready carts and twelve unchanged held carts, with no additional calls or additions
on rejected-case restart. The paid model outputs were not retained, so its
rationale cannot be reconstructed. The subsequent offline single-snapshot repair
now replaces only the SDK's Metadata system prompt with an explicit completeness
check against the original snapshot and extracted JSON. All 16 fresh synthetic
cases, 50 safety cases, 12 passive served mocked cases, four passive injected
failures and the full local pipeline passed (81 suites). Extraction instructions,
schemas and strict completion/readiness guards are unchanged. The real budget and
consumed allowance are unchanged. These checks prove request construction and
conservative local handling, not model interpretation or improved real-model
reliability. Review and a separately authorized validation plan are next; no paid
retry is authorized.
The Metadata repair acceptance preparation now adds optional private capture of exact
parsed completion/progress fields, an exclusive new single-use allowance bound to
the prior consumed allowance and frozen source/gate/pricing, and a 21-step offline
gate including the 16-case Metadata matrix. The paid matrix requires a separate
explicit authorization; the new real allowance has not been created. The fresh
gate passed all 16 Metadata cases, then stopped at reliability job 25
on a second-addition response timeout after 24 passes. The partial cart and held
exposure remain intact; no later browser gate ran. All 82 suites and the separate
full non-browser pipeline passed. Paid execution is blocked on the failed offline
gate. See the [C4 evidence](C4_PO_CART_AI_LOCAL_EVIDENCE.md).
The [bounded timeout investigation](C4_SECOND_ADDITION_DIAGNOSIS_20261014.md)
reviewed that job without replaying it, then stopped on its first fresh case:
the new runner's transport guard blocked Stagehand's local debugging port.
There were zero additions or mocked/real requests; eleven slots remain unusable.
All historical carts, data and budget/allowance fingerprints are preserved, both
new credentials are revoked, and owned processes are stopped. Runtime page-network
counters were unavailable for the failed launch. The final local pipeline passed
88 suites. The [runner repair follow-up](C4_SECOND_ADDITION_REPAIR_20261014.md)
passed the 89-suite/full local pipeline, then stopped on its first case after
Stagehand launch because its default Playwright connector lost its receiver.
No additions or inference requests occurred; its observed network counters have
incomplete page coverage. Both credentials were revoked. Preview shutdown was
not verified by the runner, while independent final inspection found no new owned
processes and free ports. Both consumed roots retain eleven unusable slots. The
[source-only connector repair](C4_CONNECTOR_SOURCE_REPAIR_20261014.md) now preserves
the default SDK receivers and separates preview child exit, group clearance and
port checks with fixed failure categories. Receiver-sensitive/mocked teardown
tests and the 91-suite/full pipeline passed; historical data and budgets are
preserved. No real browser or new allowance ran. A separately bounded browser
investigation is next; the original cause and C4/M8 stay open.
No application migration or public API was added.
Hosting, supplier access, checkout and purchases remain disabled; C4/M8 stay open.

Earlier parallel focus (2026-10-01): **W1/W2 café-item waste local review** and
**C3 Baldor supplier preparation**. The
[waste/menu analysis roadmap](WASTE_AND_MARGIN_ROADMAP.md) now has a
[working W1 local preview](W1_LOCAL_EVIDENCE.md): staff can record a quantity
and reason, use favorites and manager shortcuts, and confirm an uncertain save
without deducting stock twice. Local automated checks and fictional Safari
phone/tablet walkthroughs passed. Manual keyboard and real-worker usability
review remain open; W1 is now deployed for
[hosted usability review](C2_W2_HOSTED_RELEASE.md), with no pilot acceptance. The
[Baldor packet](C3_BALDOR_PREPARATION.md) includes an inquiry ready for owner
review and sending. The owner reports a NYC café with an existing Baldor
account for a later pilot; it has not been accessed or independently verified.
**B8 is on hold while Toast reviews the application submitted on 2026-09-30.**
Resume B8 on a request for information or an approved testing-access handoff.
[W2 café-item waste](W2_LOCAL_EVIDENCE.md) is now implemented locally: a dedicated
Waste page supports bought ready-made food counts, recipe/modifier ingredients,
already-counted sale classification, additional replacements and manager review
for missing sales. Migration `0019` was applied locally only; the full pipeline
and fictional Safari walkthroughs passed. Worker usability, full accessibility
and owner acceptance remain open. The local W2 usability refinement centers
all Waste subsections, removes repeated exact-inventory summary cards, and
moves modifier setup/copying into recipe details. Its complete local pipeline
and Safari desktop/phone/tablet checks passed on 2026-10-01; see the
[refinement evidence](W2_LOCAL_EVIDENCE.md#w2-usability-refinement--2026-10-01).
The local Inventory menu now shares four sections in both modes: Stock,
Recipes & sales, Purchasing plan, and Activity. Specialist reviews are inside
those pages; see the [navigation evidence](W2_LOCAL_EVIDENCE.md#w2-inventory-navigation--2026-10-01).
The [recipe and stock usability preview](W2_RECIPE_STOCK_USABILITY.md) now adds
compact recipes, one reviewed save for required milk choices and extras, and
Stock list/Add stock views with inline item creation. A separate normal-login
local site is available at `http://127.0.0.1:5177`; its data stays local. Migration
`0020` is local only. Missing/conflicting milk choices deduct no stock. Owner
usability and accessibility acceptance remain open. The
[package-unit improvement](W2_PACK_UNIT_USABILITY.md) now separates purchase
containers from recipe measurements, with package receiving and counts,
exact conversions and audited retries. All 39 local suites and the complete
pipeline passed; migration `0021` and Safari layout checks are local only.
Margin features remain planned. The next
unblocked step is a W1/W2 usability review, then a separate P1 cost foundation.
Supplier submission remains disabled.

1. C2's [development closeout](C2_M2_CLOSEOUT.md) now records the owner's
   reported additive M2 migration/auth review and a separate agent inspection.
   A and B may use the M2 development gate. Keep hosted signup/recovery and
   independent security review on the release follow-up list.
2. Use the [C2 hosted evidence](C2_HOSTED_DEV_EVIDENCE.md) for the completed
   development D1 `0012` and Worker walkthrough. The later
   [W1/W2 release](C2_W2_HOSTED_RELEASE.md) enables exact inventory for hosted
   review with D1 through `0021`; keep Clover sync and purchasing disabled.
   The earlier replacement build report remains owner-attested.
3. A5/M3, B5/M4, and B6's Clover adapter are accepted for local development.
   B7 hosted preparation applied development D1 `0013` and deployed B6 to
   `pantrack-dev`; see [B7 evidence](M5_B7_SANDBOX_EVIDENCE.md). The dedicated
   fictional company is now connected to its Clover sandbox merchant. Recorded
   provider cases are still required. The dedicated fictional catalog,
   opening counts, active latte recipe/modifier, and native Clover mappings
   are recorded in the B7 evidence. B7's webhook setup slice applied additive
   development D1 migrations `0014` and `0015`, verified and saved the
   development URL with an Orders-only Clover subscription, and saved the
   webhook auth-code secret name. The temporary challenge and setup gate are
   gone. Two explicitly approved fictional paid latte cases now have direct
   sandbox evidence: a base latte deducted 200 mL milk, 18 g espresso, and
   one cup; an extra-shot latte deducted 200 mL milk, 36 g espresso, and one
   cup. Each produced one applied event and one consumption application. The
   temporary sync gate was removed after each. A third paid fictional base
   latte was imported once by owner reconciliation after its first observed
   webhook returned `404`; a locally constructed authenticated repeat Orders
   notification and a subsequent owner poll created no extra event or stock
   use. A separate unmapped-modifier attempt added a fictional Clover
   modifier but stopped before any sale: three atomic-order create requests
   returned `400`, with no new order, sales event, or stock use. The temporary
   token was revoked. A fourth guarded follow-up also returned `400` before
   payment; development D1 showed no new sale or ingredient use. The owner
   reported no new $6 Clover order and revocation of the follow-up token. A
   later paid $6 fictional latte with the unmapped modifier held with zero
   stock use, then deducted 200 mL milk, 36 g espresso, and one cup exactly
   once after reviewed mapping and audited owner replay. The event was
   accidentally dismissed during UI automation; an owner-only audited
   recovery replay completed the case. The latest temporary token was
   owner-reported revoked and both Worker gates are off. A later fictional
   unpaid-cancellation attempt created and deleted one $5 latte with zero
   payments and no ingredient use. Clover retained its ID in a deleted-order
   list but returned `404` for order detail, exposing an adapter gap. A focused
   deletion-list scan then reconciled that already deleted order as one held
   cancellation. Owner review dismissed it with an audit reason and no stock
   use. A separate paid $5 fictional latte then synced once and consumed the
   expected 200 mL milk, 18 g espresso, and one cup. Clover rejected the
   single DELETE attempt on that paid order with HTTP 400. The owner later
   issued one full $5 sandbox cash refund of that same order. Clover's
   refund-expanded response confirmed its linked payment/refund; the old
   sync-shaped response still said Paid at the same modification time. A
   focused adapter fix now expands refunds and records the linked refund as
   a separate immutable revision. One guarded development reconciliation
   applied a stock-neutral refund event. D1 has **8 sales events, 5
   consumption applications, and 15 consumption movements**; the expected
   refund impact of zero additional ingredient use or restock matched actual
   balances. Both gates are off and the temporary read-only token was
   owner-reported revoked. The local zero-line paid-deletion policy change
   still has no direct sandbox proof because Clover rejected the DELETE.
   A later $5 fictional cash latte was paid while sync was off; D1 still had
   zero events for it until one **Sync now** reconciliation in the authenticated
   owner workspace. That scan applied one sale and consumed exactly 200 mL
   milk, 18 g espresso, and one cup, with no conflict. D1 now has **9 sales
   events, 6 consumption applications, and 18 consumption movements**. Both
   gates are off, and the temporary token was owner-reported revoked. A later
   owner menu read during the natural OAuth refresh window advanced both
   token expiries and kept the same sandbox merchant authorized. One later
   owner reconciliation after rotation returned zero new or held events,
   advanced the checkpoint, and left stock unchanged. Both gates are off.
   A later owner-driven disconnect removed Pantrack's stored Clover tokens;
   reauthorization restored the same fictional merchant and a menu read.
   Development D1 retained all mappings, nine sales events, six consumption
   applications, 18 movements, the sync checkpoint, and exact stock balances.
   A later fictional order was paid for one latte, synced once, then revised
   with a second paid latte on the same order. The two applied revisions each
   consumed only one latte's ingredients: 200 mL milk, 18 g espresso, and one
   cup. D1 now has 11 sales events, 8 consumption applications, and 24
   movements, with zero conflicts. Both temporary gates are off, and the
   owner reports revoking the temporary merchant token. A later controlled,
   authenticated B7 webhook received `503` for one fictional $5 paid latte;
   no Clover retry was observed in a 20-minute trace. One separate owner
   reconciliation applied its sale with exactly 200 mL milk, 18 g espresso,
   and one cup used. D1 now has 12 sales events, 9 applications, and 27
   movements. The temporary probe was removed from source and the development
   Worker, both sync gates are off, and the owner reports revoking the
   temporary B7 merchant token. Native Clover retry behavior and other
   provider cases remain unverified.
   A subsequent controlled loss of one sandbox refresh response exercised
   Clover's recovery endpoint using the preceding token. The owner menu read
   succeeded after recovery, as did a modifier read on the restored ordinary
   Worker. D1 stayed at 12 sales events, 9 applications, 27 movements, and the
   same exact balances and sync checkpoint. The one-use probe and its Worker
   secrets were removed. This closes that one lost-response case; native
   webhook retry, the rejected paid-order DELETE path, and other B7 limits
   remain unverified. See [B7 evidence](M5_B7_SANDBOX_EVIDENCE.md).
   The [B7 acceptance review](M5_B7_ACCEPTANCE_REVIEW.md) maps every M5 task
   and criterion to direct sandbox or local evidence. The owner accepted B7/M5
   on 2026-09-29 for the tested development sandbox scope, with polling as the
   required fallback for missed or failed webhooks. Native Clover retry,
   paid-order DELETE, voids, reopened orders, partial fulfillment, variations,
   multi-page provider scans, and Clover-side app revocation remain outside
   that acceptance. Pilot and production approval are separate.
   Concurrent local-only A7 migrations were moved to `0016` and `0017` in
   the merge; development D1 subsequently advanced through `0021` in the
   [W1/W2 release](C2_W2_HOSTED_RELEASE.md). A7/A8 hosted workflow
   acceptance remains a separate outcome.
4. Keep production data and real users out of this environment while these
   gates remain open. Hosted sign-in worked at the development `workers.dev`
   URL; signup and recovery callback configuration there still needs a
   separate check. Preserve the local Supabase callback configuration while
   reviewing any hosted URL change.

The [A8 migration review and repair](M7_A8_MIGRATION_REVIEW.md) found a nullable
invalidation reason that bypasses `0017`'s SQL transition guard. Forward
migration `0022` rejects both false and NULL transition expressions. Packaging
found newer remote `main` with used migrations through `0021`, so Drizzle
regenerated the unpublished repair as `0022`. On 2026-10-02, the integrated
source passed all 41 suites, typecheck, the 23-migration check, build, isolated
fresh/upgrade local D1 application, HTTP smoke, and the positive A8 served
proposal check. Existing proposal history, inventory/settings data, prior
migrations, unrelated pending work, and the owner's local D1 state were
preserved. The accepted ten-minute freshness policy is unchanged. A8/M7
acceptance remains open; preparing the separately authorized development
migration and hosted evidence packet is the next A8 item.

Other workstreams can continue local-only work under their individual
[roadmap checklists](PANTRACK_MILESTONES.md#step-by-step-checklist-for-each-person)
and the [AI development playbook](AI_DEVELOPMENT.md). M4's acceptance is limited
to local development; the hosted fictional check does not cover native-provider
behavior.

## Remaining roadmap

| Milestone | Status | Main work still required |
| --- | --- | --- |
| M2 — authentication and RBAC | C1/M2 accepted by owner and C2 evidence closed for development; replacement Cloudflare build remains owner-attested | The [C2 closeout](C2_M2_CLOSEOUT.md) records the reported review, local pipeline and read-only Worker smoke. Hosted signup/recovery callbacks and independent security verification remain release follow-ups. |
| M3 — inventory and recipes | A5/M3 owner-accepted for development on 2026-09-23 | Local pipeline, Person B's compatibility review, and A5 fictional screen walkthrough passed. Hosted fictional exact count and consumption passed; the [W1/W2 release](C2_W2_HOSTED_RELEASE.md) now enables the exact preview for usability review. |
| M4 — POS ingestion | B5/M4 accepted for local development on 2026-09-24; later recovery fixes merged in PR #9 | [B5 evidence](M4_B5_LOCAL_EVIDENCE.md) covers local concurrency, recovery, authorization, compatibility, served behavior, and green branch/main CI. A hosted fictional sale and duplicate check passed. BUG-02/03/05 now pass locally; their hosted release/validation remain open. B7's bounded Clover acceptance is separate. |
| M5 — Clover | B6 local adapter deployed to development; fictional sandbox merchant connected; webhook URL and Orders subscription saved; paid latte, modifier/replay, duplicate/polling, unpaid deletion, full refund, missed-sale polling recovery, natural token refresh, lost-response recovery, disconnect/reconnect, later paid revision, and controlled webhook-failure cases recorded; owner-accepted on 2026-09-29 for tested development sandbox scope | [B6 evidence](M5_B6_LOCAL_EVIDENCE.md) covers development behavior. [B7 evidence](M5_B7_SANDBOX_EVIDENCE.md) records nine paid latte deductions across sandbox cases, one held sale with zero partial use and an audited recovery replay, a simulated duplicate and owner poll, an unpaid deletion dismissed without stock use, one linked full $5 refund with zero additional stock use, two sales recovered by owner polling, one OAuth rotation and one controlled lost-response recovery, same-merchant reauthorization with history and stock retained, and one paid order revision that used only the added latte's ingredients. One authenticated webhook received a controlled `503`; owner polling recovered the sale once, while native retry was not observed in 20 minutes. Clover rejected a paid-order DELETE with HTTP 400. See the [bounded acceptance decision](M5_B7_ACCEPTANCE_REVIEW.md) for all excluded provider cases. Sync remains off; pilot and production approval are separate. |
| M6 — second POS | B8 on hold at owner's request awaiting Toast approval/testing access; adapter foundation preserved; M6 not accepted | Toast received the owner's application on 2026-09-30. The [local foundation](M6_B8_ADAPTER_FOUNDATION.md) is implemented locally; native Toast remains unimplemented. Resume on Toast's request for information or an approved [access handoff](M6_TOAST_ACCESS.md), then validate a read-only sandbox connection before sales cases. |
| M7 — replenishment proposals | A6/A7 local core and lifecycle, C4's fake consumer, and A8 local sale, sales-health reader, v2 handoff, durable source safety, gated preview, and manager save/edit/cancel flow passed locally; owner reports the local browser walkthrough works and accepted the ten-minute development freshness policy; M7 not accepted | The [served local HTTP check and owner browser report](M7_A8_SERVED_LOCAL_EVIDENCE.md) record the positive proposal flow, false D1 change-count fixes, and expected `review_required`/`inventory_changed` stock invalidation. [Decision 0004](decisions/0004-m7-development-sales-freshness.md) records the accepted development policy. The manager flow uses server-derived Clover health and fictional supplier details, with supplier submission disabled. A8 still needs hosted browser, end-to-end, and concurrency evidence. The local walkthrough used fixture sign-in and synthetic health; it does not verify provider signup or sync. Development D1 applied A7 `0016`/`0017` with the [W1/W2 release](C2_W2_HOSTED_RELEASE.md); the guard repair `0022` and auth fence `0023` were applied during the [C2 UI release](C2_UI_RELEASE_20261004.md). See [manager flow evidence](M7_A8_MANAGER_FLOW_EVIDENCE.md), [preview evidence](M7_A8_PREVIEW_API_UI_EVIDENCE.md), and [durable safety evidence](M7_A8_DURABLE_CLOVER_SAFETY_EVIDENCE.md). |
| M8 — PO-backed cart and delivery reconciliation | Local PO/cart/session/reconciliation components and the evaluation-only AI reader/Metadata preparation are implemented; M8 not accepted | [AI evidence](C4_PO_CART_AI_LOCAL_EVIDENCE.md) records incomplete real-model matrices and the timeout at offline reliability job 25. The [fresh complete-gate attempt](C4_FULL_OFFLINE_GATE_20261014.md) stopped at reliability job 5; its separate terminal-revocation audit defect now has a [source repair](C4_CREDENTIAL_AUDIT_REPAIR_20261015.md). The [display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md) passed twelve delayed jobs/sixty mocked requests: not reproduced with display on; cause unresolved. A fresh complete gate is still required before separately authorized paid validation. Hosted-fictional privacy/safety, permitted supplier mappings/access, manager checkout, PDF/XLSX/history, confirmation and atomic receiving remain open under the [integration guide](PO_AI_CART_INTEGRATION_ROADMAP.md). M7 acceptance is still a gate. |
| M9 — operations | Prototype endpoint only; new schedule/worker not provisioned | Cloudflare Cron every 15 minutes for weekly company-timezone drafts/reminders, authenticated Render worker and operational alerts; managers start carts, schedules never launch AI/browser preparation. |
| M10 — financial controls | Partial prototype | Existing supplier terms first; preparation authorization/reservations, unresolved checkout exposure, owner limits/reauthentication and final-price reconciliation. Pantrack cannot enforce external checkout spending. |
| M11 — reviewed PO pilot | Not started | Written permission, one POS/supplier/location, two supervised browser-assisted count-to-delivery cycles including a discrepancy, alerts, pause and manager sign-off on accuracy, usability, recovery and time saved. APIs/AI checkout are not prerequisites. |
| M12 — production readiness | Not started; requires M11 | Onboarding, backups/restores, export/deletion, rate limits, security review, browser privacy, connection removal, worker recovery/health, monitoring, support and tenant-isolation release testing. |
| M13 — optional supplier APIs | Deferred until M12 and active production users | Prioritize user supplier demand; approved access and sandbox/real-test evidence; share the PO workflow. |
| M14 — controlled purchasing automation | Separate post-launch project | AI checkout or purchasing without per-order human control needs separately approved scope, chosen-channel pilot, eligibility/limits, reauthentication, alerts, pause and bounded observation; API automation additionally requires M13. |

## Important dependencies

```text
M2 → M3 → M4 → M5 → M6 / M7 → M8 → M9
                   M2 + M8 → M10
M0 through M10 → M11 reviewed POs → M12
M12 + active production users → M13 optional supplier APIs
M12 + approved chosen-channel pilot → M14 automation (also M13 for API automation)
```

M11 cannot be skipped. It provides the real-world sale-to-delivery evidence that
must exist before Pantrack can safely onboard multiple companies or enable any
limited automation. M13/M14 do not block the first reviewed-mode launch; the
pending M6 POS gate has not been removed.

## Evidence and detailed documents

- [M0 local evidence](M0_LOCAL_EVIDENCE.md)
- [M1 CI evidence](M1_CI_EVIDENCE.md)
- [M4 B2 fake-backed local evidence](M4_B2_LOCAL_EVIDENCE.md)
- [M4 B3 local D1 evidence](M4_B3_LOCAL_EVIDENCE.md)
- [M4 B4 local exact-sales evidence](M4_B4_LOCAL_EVIDENCE.md)
- [M4 B5 local acceptance evidence](M4_B5_LOCAL_EVIDENCE.md)
- [C2 hosted development validation](C2_HOSTED_DEV_EVIDENCE.md)
- [M5 B6 local Clover evidence](M5_B6_LOCAL_EVIDENCE.md)
- [M5 B7 sandbox acceptance in progress](M5_B7_SANDBOX_EVIDENCE.md)
- [M6 B8 local adapter foundation](M6_B8_ADAPTER_FOUNDATION.md)
- [M6 Toast access handoff](M6_TOAST_ACCESS.md)
- [C3 Baldor supplier preparation](C3_BALDOR_PREPARATION.md)
- [Purchase-order-first rollout](PURCHASE_ORDER_ROLLOUT.md)
- [C4 persistent PO draft foundation](C4_PO_FOUNDATION_LOCAL_EVIDENCE.md)
- [Quick waste recording and menu analysis roadmap](WASTE_AND_MARGIN_ROADMAP.md)
- [W1 quick ingredient-waste local evidence](W1_LOCAL_EVIDENCE.md)
- [W2 café-item waste local evidence](W2_LOCAL_EVIDENCE.md)
- [September 19 readiness snapshot and approved M2 permissions](MILESTONE_READINESS.md)
- [Full milestone roadmap](PANTRACK_MILESTONES.md)
- [Branch consolidation record](BRANCH_CONSOLIDATION.md)
