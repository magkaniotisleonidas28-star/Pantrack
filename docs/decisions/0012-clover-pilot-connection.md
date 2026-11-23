# Decision: connecting Clover at the pilot café

- Status: accepted by the owner (direction); implementation in steps
- Date: 2026-11-22
- Roadmap: [Clover pilot connection](../CLOVER_PILOT_CONNECTION_ROADMAP.md)
- Builds on: M5's accepted sandbox scope ([B7 decision](../M5_B7_ACCEPTANCE_REVIEW.md)),
  sales ingestion ([decision 0003](0003-m4-sales-ingestion.md)) and the
  ten-minute freshness policy ([decision 0004](0004-m7-development-sales-freshness.md))

## Context

Pantrack already connects to Clover's **sandbox**, with a fictional café.
That covered paid sales, modifiers, duplicate notices, unpaid deletions, a
full refund, token refresh, disconnect and reconnect, and recovery of missed
sales with **Sync now**. A real café uses Clover's **live** system, which
needs a separate approved app and new settings, and real cafés do things the
sandbox test did not cover.

A review of the current code on 2026-11-22 found these gaps for real use:

1. **One unusual order stops all syncing.** A custom-amount line (no menu
   item), an item sold by weight, an order of 100 or more lines, or refund
   details that don't add up make the whole sync fail. The checkpoint does not
   move, so every later sync fails on the same order until someone steps in.
2. **Anything not linked to a recipe pauses the whole sale.** That includes a
   gift card, a bottled drink that isn't tracked, or a "to go" option. In a
   real café that would pause many everyday sales.
3. **No automatic checking.** Pantrack reads Clover only when Clover sends a
   notice or someone presses **Sync now**. Clover's documentation does not
   promise to resend a notice that failed. Each sync also covers at most 24
   hours, so catching up after a long gap needs several.
4. **Removing the app in Clover is not noticed.** Pantrack only finds out
   when a later request is refused. It doesn't tell the owner clearly.
5. **Untested real-café cases.** These were outside the accepted sandbox
   scope:
   - voided items and voided payments;
   - refunds of a single line, and exchanges;
   - items with sizes or other variants;
   - reopened orders;
   - busy days that need several pages of orders.

   Clover's documentation does not say exactly how voids appear.

Clover's live system needs, per its developer documentation (read
2026-11-22):
- an **approved production developer account**;
- then an **approved app**, after functional, legal and privacy, and listing
  review.

A **private app** is not listed on the Clover App Market and is shared with
the café by a direct link. Clover discusses pricing during review. Review time
is not stated.

## Decisions

1. **Pilot home.** The pilot runs on the owner's pilot site,
   `pilot.pantrack.app`. The owner reports it is already set up online. This
   repository has no record of it yet, so before connecting Clover, what it
   runs is checked read-only, with the owner's authorization. Development
   (`pantrack-dev`) stays the test site with the Clover sandbox.
2. **Clover developer account.** It is registered **as an individual**. The
   owner applies in Clover's developer dashboard and enters their own details
   there. Nobody pastes them into chat or the repository.
3. **Items Pantrack doesn't track.** Owners and managers can mark a Clover
   item or option **Not tracked**:
   - a sale still takes the rest of its items from stock;
   - a marked line takes nothing;
   - an item or option that is new and unmarked still pauses the sale, so
     nothing is skipped silently;
   - the mark can be undone and is recorded with who and when.
4. **Automatic checking every 10 minutes.** It matches decision 0004:
   - Pantrack checks each connected café on its own, as well as on Clover's
     notices and **Sync now**;
   - the existing single-sync lock keeps checks from overlapping;
   - the existing duplicate protection keeps a sale from being counted twice.
5. **An unusual order never blocks the others.** An order Pantrack can't read
   safely is paused on its own, with a plain reason. Syncing moves on. Nothing
   from that order is taken from stock until a person reviews it.
6. **Removing the app in Clover stops syncing visibly.** Pantrack subscribes
   to Clover's app notices as well as orders. When the app is removed, or
   Clover refuses its access, Pantrack:
   - stops syncing;
   - keeps all history;
   - shows the owner **Clover access was removed — reconnect**.
7. **Refunds and voids keep the existing rule (decision 0003).** After an item
   is made, a refund or void never puts stock back automatically. An item
   voided before payment is simply not in the paid order, so nothing is taken.
8. **Least access.** The live app asks only to **read** Inventory, Merchant,
   Orders and Payments. Its notices are Orders and Apps.
9. **Every outside step needs the owner's go-ahead,** each time:
   - creating the live app;
   - adding secrets to the pilot site;
   - turning on sales sync there;
   - each sandbox test session;
   - connecting the café's Clover account.

   Secrets are typed straight into Cloudflare by the owner and never pasted
   into chat.

## Alternatives considered

- **Use the development site for the pilot.** It is faster, but real café data
  would sit next to test cafés and get changes before they are settled.
- **Keep pausing every sale with anything unknown.** This is safest, but too
  noisy at a real café.
- **Skip unknown items automatically.** This is the least work, but a
  forgotten recipe link would quietly stop stock coming off.
- **Webhooks only.** Clover does not promise to resend a failed notice.

## Consequences

- Steps P1 to P4 are local code changes, each with tests and evidence. P2 adds
  a migration. P3 adds a scheduled trigger to the Worker configuration.
- Step P5 needs an authorized sandbox session on the development site.
- The live app review can start while P1 to P5 are built. Clover asks for a
  functional description and video, which can be recorded on the test café.
- Pilot acceptance is still M11/B9 and is separate from this setup.
  Supplier submission and automatic purchasing stay off.
