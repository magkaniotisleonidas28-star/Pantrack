# Clover pilot connection — roadmap

Owner request, 2026-11-22: connect Clover at the pilot café. The owner's
choices are in [decision 0012](decisions/0012-clover-pilot-connection.md):
- the pilot runs on `pilot.pantrack.app`;
- the Clover developer account is registered as an individual;
- items Pantrack doesn't track can be marked **Not tracked**;
- Pantrack checks Clover on its own every 10 minutes.

Each step is one reviewable outcome, with tests and an evidence record. Steps
P1 to P4 are local only. Nothing here contacts the café's Clover account,
changes a hosted site or turns on sales sync without the owner's go-ahead for
that exact action. Supplier submission and automatic purchasing stay off.

## Steps

Progress: P1 built locally on 2026-11-25
([evidence](CLOVER_P1_UNREADABLE_ORDERS_LOCAL_EVIDENCE_20261125.md)); no
migration was needed.
P2 built locally on 2026-11-25
([evidence](CLOVER_P2_NOT_TRACKED_LOCAL_EVIDENCE_20261125.md)) with migration
0055.
P3 built locally on 2026-11-25
([evidence](CLOVER_P3_SCHEDULED_SYNC_LOCAL_EVIDENCE_20261125.md)); no
migration.
P4 built locally on 2026-11-25
([evidence](CLOVER_P4_ACCESS_REMOVED_LOCAL_EVIDENCE_20261125.md)) with
migration 0056. That completes the local steps P1 to P4.
P5 sandbox session held on 2026-11-25/26 on the development site
([record](CLOVER_P5_SANDBOX_SESSION_20261126.md)). Its three code findings
were fixed locally in PRs #89 to #91. Still to do: release them to the
development site and repeat the busy-period test, with the owner's go-ahead.

| Step | Outcome | Schema? | Done when |
| --- | --- | --- | --- |
| P0 | Decision 0012 and this plan | No | Owner reviewed and merged |
| P1 | **One unusual order can't stop syncing.** An order Pantrack can't read safely is paused on its own with a plain reason, such as a custom amount, an item sold by weight, a very large order or refund details that don't add up. Syncing moves on to later orders | Checked during the step | Tests where an unreadable order sits between good ones: the good ones are applied once, the unusual one is paused with nothing taken from stock, and the checkpoint advances. A later fix or review applies it once |
| P2 | **Not tracked.** In Sales, owners and managers mark a Clover item or option **Not tracked**, or undo it. Those lines take nothing; the rest of the sale still comes off stock. New, unmarked items still pause the sale | Yes (not-tracked marks) | Mixed sales (tracked latte plus untracked gift card, plus a "to go" option) take exactly the latte's ingredients; unmarked items still pause; paused sales can be replayed once after marking; who and when are recorded; anonymous, wrong-company and role tests |
| P3 | **Automatic check every 10 minutes.** A scheduled trigger syncs each connected café where sales sync is on. The health panel shows the last automatic check | No (Worker trigger configuration) | Tests: overlapping triggers and a webhook at the same moment apply each sale once; a café that is disconnected or not set up is skipped; one café's error doesn't stop the others; catching up after more than 24 hours takes several runs, not several days |
| P4 | **Clover access removed.** Pantrack takes Clover's app notices; on uninstall, or when Clover refuses access, syncing stops and the owner sees **Clover access was removed — reconnect**. History and links are kept | Checked during the step | Tests for the uninstall notice (authenticated, right app, right merchant), refused refresh, reconnecting to the same merchant, and that a wrong merchant can't be used |
| P5 | **Real-café cases on the Clover test café.** On the development site's sandbox merchant, with the owner's go-ahead, try: a voided item, a voided payment, a one-line refund, an exchange, an item with sizes, two of the same item, a custom amount, an item sold by weight, a tip, a reopened order and a day with more than one page of orders. Record what Clover sends and what Pantrack did | No | An evidence record with each case's expected and actual stock use; anything that fails becomes its own fix before go-live |
| P6 | **Pilot setup checklist.** A plain step-by-step guide for the owner: Clover developer account, the live private app, Pantrack's pilot settings, connecting, linking, Not tracked, opening counts, the first-day check, daily checks, and how to pause or disconnect | No | Owner has walked through it once on the test café |
| P7 | **Go live at the pilot café.** Each outside step is done only with the owner's go-ahead: live app, pilot-site secrets, turning on sync, and connecting the café | Hosted only, with authorization | First two weeks: every Clover sale is either applied once or paused with a reason; no duplicates; paused sales reviewed. Feeds M11/B9 and the R1f stock-level trial |

Steps can overlap: P1 to P4 are independent, and P5 can run once they are
merged and released to the development site. The owner's Clover applications
(below) can start now.

## What the owner does in Clover

These are done by the owner, in Clover's developer dashboard for North
America. Nobody pastes personal details or secrets into chat or the
repository.

1. **Ask the café for written permission** for Pantrack to read its Clover
   sales during the pilot.
2. **Apply for a production developer account as an individual.** Clover
   asks for:
   - name, date of birth, home address and contact details;
   - an identity and sanctions check.

   Clover doesn't say how long approval takes.
3. **Create the live app** once the account is approved, set up like the
   sandbox app:
   - the site URL is the pilot site;
   - it only reads Inventory, Merchant, Orders and Payments;
   - its webhook is the pilot site's `/api/clover/webhook`, with **Orders** and
     **Apps** notices.
4. **Submit the app for approval as a private app.** Clover asks for:
   - a short description of what the app does;
   - a video, which can be recorded on the test café after P1 to P4;
   - the submission checklist (app settings, listing and releases).

   Clover discusses pricing during review.
5. **After approval,** send the café owner the app's install link. They sign
   in to Clover and approve it, starting from Pantrack's **Sales → Connect
   Clover**.

## What Pantrack's pilot site needs

These are done with the owner's go-ahead at the time.
- **Read-only check first.** Confirm which version and database migrations
  `pilot.pantrack.app` runs. It is not yet recorded in this repository.
- **Settings:**
  - `CLOVER_ENVIRONMENT=production`;
  - the live app's ID, secret and webhook code, entered as secrets by the
    owner;
  - an encryption key generated directly into the site's secrets.
- **Turn on sales sync** (`PANTRACK_CLOVER_SYNC_ENABLED`) only after the
  webhook is verified and the café's recipes and opening counts are ready.
- **Pause at any time:**
  - turn sales sync off, which stops reading and keeps everything;
  - or use **Disconnect** in Pantrack, which removes the stored tokens;
  - the café can also remove the app in Clover.

## Not covered

- Clover outside North America, more than one location per café, and Clover
  menu changes made in Pantrack (Pantrack only reads).
- Putting stock back for refunds or voids after an item was made; the rule in
  decision 0003 is unchanged.
- Toast or other POS systems (M6).
