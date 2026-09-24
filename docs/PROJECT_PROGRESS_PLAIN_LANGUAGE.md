# Pantrack progress, in plain language

Updated: 2026-09-24. This guide summarizes the roadmap and recorded owner
decisions. Refresh it when workstream branches merge or new evidence is accepted.

## The short version

Pantrack has a working local foundation: accounts and company roles, a product
catalog, inventory and recipes, and several ways to enter sales. The owner has
accepted the **M2 account-and-permissions and M3 inventory milestones for
development**. The sales-to-inventory connection (M4) is accepted for local
development and passed a fictional hosted check. Real Clover
sales, supplier orders, automatic purchasing, and a real café pilot have not
been completed.

The next dependency is:

```text
Person A's M3 acceptance (A5) is recorded
    → Person B's local M4 acceptance (B5) is recorded
    → Person B can complete and test Clover (B6–B7)
    → later replenishment, supplier, pilot, and release work can proceed
```

Person C can work in parallel on the remaining M2 evidence record, outside
service decisions, and safe tests using fake services. None of that means a
live supplier order or an automatic purchase is permitted.

## How to read the status words

- **Done on `main`:** the checked roadmap step is in the shared branch.
- **Built locally, acceptance open:** code or a screen exists and local checks
  passed, but the required review or real-world evidence is not complete.
- **Branch awaiting integration:** work is saved separately and is not yet part
  of `main`.
- **Open:** the roadmap step has not been accepted. Some groundwork may still
  exist; “open” does not necessarily mean “no code.”

A *milestone* is a larger goal (such as M3 inventory). A numbered *step* is one
person's smaller piece of it (such as A5). A local test uses fictional data on
this computer; it does not prove that a hosted service or real provider works.

## What is already done

| Area | Current position |
| --- | --- |
| Local setup and automated checks (M0–M1) | Done on `main`. The app can run locally, and GitHub Actions checks the project on Ubuntu and Windows. |
| Accounts and company permissions (C1/M2) | Owner-accepted for development. The owner tested confirmation, sign-in, invitations, roles, ownership transfer, recovery, and sign-out with fictional accounts. A separate independent security review is **not** claimed. A development Worker was deployed and passed hosted sign-in; hosted signup and recovery callbacks remain unchecked. |
| Exact inventory and recipes (A4–A5/M3) | Owner-accepted for development after the full local pipeline, Person B's contract review, and the fictional older-data walkthrough. Development database migration `0012` and a fictional hosted inventory check passed. The hidden switch is off again. |
| Permanent sales events and exceptions (B1–B5/M4) | B1–B5 are checked on `main` for local development. Manual sales, CSV paths, and the authenticated register bridge can use the exact-inventory flow while the hidden switch is on. A fictional hosted sale applied once and its duplicate left stock unchanged. Clover remains future work. |
| Clover, suppliers, and payments | Some setup/prototype screens exist. They do **not** represent completed live sales syncing, supplier ordering, or production payment readiness. |

The B4 closeout began on `workstream-b/b4-closeout-20260923` at `3aa521f`.
Its evidence and the later [B5 local acceptance](M4_B5_LOCAL_EVIDENCE.md) are
recorded on `main`. The [hosted development check](C2_HOSTED_DEV_EVIDENCE.md)
is separate from those local results.

## Person A — inventory and replenishment

Person A makes stock quantities trustworthy and later builds suggestions for
what to reorder. “Replenishment” means calculating what may need restocking;
it does not place an order.

| Step | Plain-language job | Status |
| --- | --- | --- |
| A1 | Agree on units, recipe history, opening counts, and how old records are handled. | Done on `main`; the design decision is accepted. |
| A2 | Publish the safe “subtract ingredients for this sale” agreement used by B. | Done on `main`; Person B's compatibility review is recorded. |
| A3 | Add database structures for exact quantities and recipe/count history without erasing old records. | Done on `main`; additive migrations and legacy compatibility tests passed locally. |
| A4 | Build exact inventory, recipe versions, counts, manager screens, and permission tests. | Done on `main`; checked. Hidden switch remains off by default. |
| A5 | Review all M3 evidence and formally hand the inventory contract to B. | Done on `main`; owner-accepted for development on 2026-09-23. Hosted checks remain separate. |
| A6 | Build the safe calculation engine for suggested replenishment. | Later; open. Suggestions stay review-only. |
| A7 | Add the suggestion review/history process and hand its contract to C. | Later; open. |
| A8 | Accept the replenishment milestone after the needed sales inputs are accepted. | Later; open. |
| A9 | Measure inventory and suggestion accuracy during an approved café pilot. | Later; open; requires written pilot permission. |
| A10 | Help validate onboarding, data export/deletion, and backup/restore before release. | Later; open; requires pilot acceptance. |

## Person B — sales and point-of-sale connections

Person B makes every sale traceable, prevents duplicate stock deductions, and
later connects real register providers. A *held sale* is saved for a manager to
review instead of silently changing stock.

| Step | Plain-language job | Status |
| --- | --- | --- |
| B1 | Formally approve the common sales-event rules, including duplicates, held sales, refunds, and privacy. | Done on `main`; the M4 design record is accepted. |
| B2 | Prove the sales process against a fake inventory service, including retries and failures. | Done on `main`; checked. |
| B3 | Add permanent sales-event, review, and audit database records. | Done on `main`; checked. |
| B4 | Connect sales to exact inventory and provide review, replay, dismissal, and correction screens. | Done locally on `main`; closeout and employee-status privacy evidence are recorded. |
| B5 | Review the complete M4 evidence after A5/M3 acceptance. | Done on `main`; M4 accepted for local development on 2026-09-24. |
| B6 | Finish the Clover connection locally, including mapping, missed sales, and connection health. | Next B step; open. Current Clover setup is only a prototype. |
| B7 | Test the completed Clover connection in its approved sandbox. | Later; open. Sandbox access and evidence are required. |
| B8 | Choose and test a second real register provider using the same approach. | Later; open; needs the owner's provider choice. |
| B9 | Measure missed, delayed, duplicate, and held sales in an approved café pilot. | Later; open. |
| B10 | Finish integration onboarding, abuse protection, and company-isolation release checks. | Later; open; requires pilot acceptance. |

## Person C — accounts, suppliers, and operations

Person C handles the platform, external-service decisions, and the safeguards
around purchasing. An automated test using a fake supplier never authorizes a
real order.

| Step | Plain-language job | Status |
| --- | --- | --- |
| C1 | Accept accounts and company permissions with a development Supabase account and owner walkthrough. | Owner-accepted for development on 2026-09-23; checked. Cloudflare build success is owner-reported, not independently verified here. |
| C2 | Record the full M2 evidence and remaining deployment limits for the team. | Open in roadmap. The owner accepted C1 and later reported completing the authentication/migration review; its separate written record remains unavailable. Development D1 and Worker validation are [recorded](C2_HOSTED_DEV_EVIDENCE.md). |
| C3 | Obtain decisions about Clover sandbox, second register provider, first supplier, job runner, alerts, payment responsibility, and limits. | Can proceed in parallel; open. Do not guess missing business decisions. |
| C4 | Build and test safe supplier, background-job, alert, and spending-limit components using fake services. | Can proceed in parallel within its gates; open. No real submissions or schedules. |
| C5 | Connect the chosen supplier only after A's replenishment milestone is accepted. | Later; open. One real test order would need separate explicit approval. |
| C6 | Connect scheduled jobs and alerts after the preceding sales/supplier milestones. | Later; open. |
| C7 | Finish financial controls after supplier and payment decisions. | Later; open. Automatic purchasing stays disabled. |
| C8 | Coordinate the approved café pilot and collect the A/B/C evidence. | Later; open; requires written sign-offs. |
| C9 | Coordinate security, support, recovery, and the final release evidence. | Later; open; requires pilot acceptance. |

## The next practical moves

1. **A:** begin A6's review-only replenishment calculation work. Keep versioned
   proposals and automatic purchasing behind their later gates.
2. **B:** start B6's Clover adapter work under the accepted sales and inventory
   contracts. B7 still needs explicitly approved sandbox access.
3. **C:** finish the C2 evidence/limitations record and start collecting C3
   business decisions. C4 may use fake services only while other work proceeds.
4. **Project owner:** choose and approve outside services when the relevant step
   reaches that gate. Do not supply secrets in chat or use real customer data for
   these development checks.

The development D1 migration and Worker deployment described above are complete.
No live point-of-sale call, supplier order, automatic purchasing, or production
deployment is implied by this document.

For the authoritative checkboxes and detailed acceptance rules, use the
[full A/B/C roadmap](PANTRACK_MILESTONES.md#step-by-step-checklist-for-each-person).
For the milestone-level summary, use [current status](CURRENT_STATUS.md).
The B4 local test details are in [B4 evidence](M4_B4_LOCAL_EVIDENCE.md).
