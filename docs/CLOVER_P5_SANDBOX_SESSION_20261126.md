# Clover P5: real-café cases on the sandbox test café — session record

Recorded: 2026-11-27, from the session log kept during the session. This is
step P5 of the [Clover pilot roadmap](CLOVER_PILOT_CONNECTION_ROADMAP.md),
following [decision 0012](decisions/0012-clover-pilot-connection.md).

This is **sandbox evidence**:

- the site was the development site, `pantrack-dev`;
- the Clover account was a sandbox test merchant;
- the café was the fictional B7 test company;
- the sales were made up, and no real customer or payment was involved.

It is not pilot or production evidence.

## Authorization and setup

The owner approved two things for this session:

- releasing `c428b32` (P1 to P4) to the development site;
- turning Clover sales sync on there during the session, and off afterwards.

| Time (UTC)             | What happened                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-25 20:39–20:40 | Released `c428b32` as Worker version `74d8de3f` and applied migrations 0053–0056, following the [hosted release procedure](C2_W2_HOSTED_RELEASE.md).                                                                                                                                                                                                                                          |
| 20:40:51               | Sales sync turned on (version `5382dd3d`).                                                                                                                                                                                                                                                                                                                                                    |
| 21:37–21:52            | The owner no longer had the authenticator for the earlier sandbox developer account, so they made a new sandbox app, **Pantrack Sandbox Test**. It is a REST client with read access to merchant, inventory, orders and payments. The owner put its client ID, secret and webhook code into Cloudflare directly. The temporary webhook-setup secret was deleted once the webhook was checked. |
| 21:46:54               | The owner disconnected the old merchant and connected the new sandbox test merchant (`Y43X…P01`), and its sync started fresh.                                                                                                                                                                                                                                                                 |
| 21:51                  | Webhook `/api/clover/webhook` was verified, with **App** and **Orders** notices.                                                                                                                                                                                                                                                                                                              |

Clover's sandbox web dashboard can only take card-terminal sales with no menu
items. Item sales were therefore made through Clover's sandbox REST API:

- with a merchant API token the owner saved to a local file, never shown;
- by a script that only calls `apisandbox.dev.clover.com`.

The test menu:

- Latte $5, with an **Extras** group of Oat milk +$0.70 and To go;
- Muffin $3;
- Gift Card $10;
- Coffee beans. The sandbox offered no per-weight price.

## Cases

"Expected" is what the café should see; "Actual" is what Pantrack did. Stock
amounts are from the B7 latte recipe: 200 mL milk, 18 g espresso and 1 cup.

| Case                                                    | Clover order     | Expected                                                                                  | Actual                                                                                                                                                                                          | Result                      |
| ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Custom amount ($4 card, virtual terminal)               | `V5KEY91QRXAAY`  | Paused, nothing taken                                                                     | Received about 2 s after payment; paused "Custom amount with no menu item", no lines                                                                                                            | Pass (P1)                   |
| Plain latte, item not yet linked                        | `3ZYQ37YJA06KP`  | Paused until linked, then one latte once                                                  | Paused `unknown_item`; after the owner linked Latte and replayed: −200 mL, −18 g, −1 cup, once                                                                                                  | Pass                        |
| Two lattes in one order                                 | `J98A90J8ZNAC8`  | Two lattes once                                                                           | −400 mL, −36 g, −2 cups, once                                                                                                                                                                   | Pass                        |
| Latte + Oat milk                                        | `0EKYBTFTRJ5BR`  | Paused until the option is sorted, then one latte                                         | Paused `unknown_modifier`; after Oat milk was marked Not tracked and replayed: one latte, oat milk took nothing                                                                                 | Pass (P2)                   |
| Latte + To go + Gift card                               | `FF9EBXH9HXHC2`  | Latte only                                                                                | Paused for both; after marking To go and Gift Card Not tracked: one latte only                                                                                                                  | Pass (P2)                   |
| Muffin sold before its recipe existed                   | `MV822RQ0D9P7W`  | Not applied backwards                                                                     | Paused `recipe_version_not_found` after replay: the recipe was made 7 minutes after the sale                                                                                                    | Pass, by design (finding 4) |
| Muffin after the recipe                                 | `D6ZVYGFEGPBVR`  | One muffin                                                                                | Muffins 23 → 22 at once                                                                                                                                                                         | Pass                        |
| Tip ($5 latte + $1 tip, cash)                           | `4H2AW0KE5DR9G`  | One latte; tip ignored                                                                    | One latte                                                                                                                                                                                       | Pass                        |
| Item voided before payment                              | `ZKP73ZG9DV6J4`  | Latte only                                                                                | Clover sent one line; one latte, no muffin                                                                                                                                                      | Pass                        |
| Reopened order (latte paid, then muffin added and paid) | `2M1CZN7K1HBWA`  | Latte once, then the muffin only                                                          | Two revisions: latte, then only the added muffin                                                                                                                                                | Pass                        |
| One-line refund of the tipped latte                     | `4H2AW0KE5DR9G`  | Refund recorded, nothing put back ([decision 0003](decisions/0003-m4-sales-ingestion.md)) | Paused "Refund details don't add up": Clover's refund of 600 includes the 100 tip, against a 500 total. Nothing taken or put back                                                               | Fail, fixed (finding 2)     |
| Voided payment                                          | `V5KEY91QRXAAY`  | —                                                                                         | The web dashboard has no Void. The owner refunded the $4 custom sale instead: a new revision, still paused as a custom amount                                                                   | Safe; void not testable     |
| App removed in Clover                                   | —                | Sync stops, owner told, links kept                                                        | Clover sent an Apps notice with `A:` and `DELETE`, as P4 assumed. Pantrack recorded `app_removed`, deleted the café's tokens and audit-logged it. The 3 links and 3 Not tracked marks were kept | Pass (P4)                   |
| Reconnect to the same merchant                          | —                | Notice clears, links and checkpoint kept                                                  | Removal cleared; sync state and checkpoint kept. The first **Reconnect** reinstalled the app in Clover but didn't come back to Pantrack; a second press connected                               | Pass (finding 5)            |
| Busy period: 105 orders in 2 minutes                    | gift-card orders | All received, each once                                                                   | 46 received; then every sync and the 10-minute check failed with Cloudflare's "Too many subrequests by single Worker invocation", and the checkpoint stopped moving                             | Fail, fixed (finding 1)     |
| Exchange; item with sizes; item sold by weight          | —                | —                                                                                         | Not testable: the sandbox web dashboard has no exchange, and the test menu had no sizes or per-weight price                                                                                     | Not tested                  |

Every Clover notice arrived 2–3 seconds after payment. No sale was counted
twice.

## Findings

1. **Critical: a busy period stopped the sync.** Each sync re-read the last
   hour and fetched every order's details, and Cloudflare's free plan allows
   50 such requests per run. Fixed in PR #89
   ([evidence](CLOVER_SYNC_BUDGET_LOCAL_EVIDENCE_20261126.md)), which gives
   each run a budget and carries on where it stopped.
2. **Refunds that include a tip were paused.** Fixed in PR #90
   ([evidence](CLOVER_REFUND_TIP_LOCAL_EVIDENCE_20261126.md)). The refund
   paused here (`4H2AW0KE5DR9G`) stays paused on the development site and
   can be dismissed.
3. **A name lookup at the same moment as the 10-minute check showed codes.**
   At 22:20:34 **Sort them out** showed item codes, because the check was
   reading Clover. Fixed in PR #91
   ([evidence](CLOVER_NAME_LOOKUP_WAIT_LOCAL_EVIDENCE_20261127.md)).
4. **Recipes don't apply to sales from before they existed.** This is by
   design. For the setup guide (P6): set up recipes and links before the
   café's first day.
5. **After reinstalling the app, Reconnect may need a second press.** For the
   setup guide (P6).
6. **Oat milk isn't in the latte recipe.** The latte recipe only had "extra
   shot", so Oat milk was marked Not tracked for the test. For the setup guide
   (P6): add oat milk before go-live.
7. **Not testable in the sandbox web dashboard:** voiding a payment, an
   exchange, sizes and items sold by weight. They are covered by local tests
   (P1 pauses weighed items) and remain to watch in the pilot's first weeks
   (P7).

## End of session

At 2026-11-26 21:11:47 UTC, sales sync was turned off on the development site
with a new version, `580a20e6`:

- it runs the same code, `c428b32`, with `PANTRACK_CLOVER_SYNC_ENABLED=disabled`;
- it keeps the current secrets. The older version `74d8de3f` has secrets from
  before the new sandbox app, so it must not be redeployed.

Home returned 200, and an unauthenticated webhook returned 404, as expected
with sync off.

## Still to do for P5

- **Release #89 to #91 to the development site and repeat the busy-period
  test** with sync on. This needs the owner's go-ahead for both the release
  and turning sync on.
- Findings 4 to 6 go into the P6 setup guide.
