# C4 Amazon Business cart preparation — local fake evidence

Recorded: 2026-11-13. Branch: `workstream-c/c4-amazon-business-fake-cart`,
stacked on the [decision 0007](decisions/0007-amazon-business-first-supplier.md)
branch. This is build step 1 (fakes) of the
[Amazon Business preparation](C3_AMAZON_BUSINESS_PREPARATION.md#build-sequence).
It is **local evidence only**: no Amazon sandbox, account or network was used,
and nobody at Amazon was contacted. C3, C4 and M8 remain open.

## Delivered behavior

- **[Cart preparation](../src/lib/amazon-business-cart.ts)** takes the existing
  authorized fictional preflight
  ([`preparationPreflight`](../src/lib/po-cart-preparation-contract.ts)) and
  fills one Amazon Business cart through an injected transport. It reuses the
  browser worker's baseline/final check, exact-entry comparison and spending cap
  ([`checkBrowserCart`](../src/lib/po-cart-browser-contract.ts)) and returns the
  worker's hold reasons, so the shared PO engine's states still apply.
- **The flow** follows Amazon's documented Cart path: list carts, choose exactly
  one cart of the configured type (`DEFAULT` or `AMAZON_WEBSITE_CART`), read its
  items as the baseline, read each line's offers, add all items in one request,
  then read the cart back.
- **Mapping:** each PO line's supplier SKU must be a 10-character ASIN. Exactly
  one new-condition offer must match the reviewed unit price and allow the
  reviewed quantity; none or several hold for review. Amazon carts carry no pack
  label, so the reviewed line's label is attached locally to its ASIN.
- **Before any write:** a requested ASIN already in the cart, a missing or
  ambiguous offer, the complete cart (existing items included) exceeding the cap,
  expired access or an unreadable response all hold with no write. Every offer is
  chosen before writing, so a later line cannot leave a partial cart.
- **The write:** the exact planned items go to the caller's `beforeWrite` first;
  if recording fails, nothing is sent. The add-items request is sent once and
  never retried. Rejected items, throttling and price or availability changes
  hold for review. A lost, failed (5xx) or unreadable reply is read back once and
  accepted only if the cart verifies exactly; otherwise it holds as
  `uncertain_write`.
- **Allowlist:** only list-carts, read-items, add-items and read-offers requests
  can be sent. Ordering, modify, delete and cost estimation are unreachable, so
  this code cannot place an order. Authentication and the user-email header
  belong to a later transport; no identity or credential enters a request here.
- **Fake only:** the [fake](../src/lib/fake-amazon-business.ts) mirrors the
  published static-sandbox shapes (Cart `2025-04-30`, Product Search
  `2020-08-26`) and both documented field spellings
  (`asin`/`offerId` and `productIdentifier`/`buyingOptionIdentifier`). A private
  registry accepts only transports it created, so a look-alike or live transport
  is refused before any call (`real_disabled`), as is any non-fictional preflight.
- **Prices** convert to integer cents only from exact USD dollars-and-cents
  values; floating-point leftovers, over-large, negative or non-USD amounts are
  unreadable and hold.

No schema, route, worker, job state or UI changed. Wiring this into the durable
cart job and worker identities is a later slice.

## Verification

[`tests/amazon-business-cart.mjs`](../tests/amazon-business-cart.mjs) builds a
real reviewed draft in local SQLite, derives its preflight, and replaces global
`fetch` with a counter that fails on use. It covers the normal cart with an
existing unrelated item, both field spellings, cart-type choice, every
pre-write hold, every post-write hold, lost-response recovery, timeout without a
write, a failed attempt record, a look-alike transport, mapping guards and price
conversion. It asserts the write count for each case, that every request is on
the allowlist and that no network call happened.

Twelve deliberate code mutations (removing recovery, the pre-write cap, the fake
guard, `beforeWrite`, the condition and quantity filters, final verification,
the availability and rejection checks, the single-cart rule, recovery of
definite refusals and an allowlist entry) each made the test fail; the restored
file was byte-identical.

The complete local pipeline passed in this worktree on 2026-11-13 with the new
files staged on base `cc14ef8`: `pnpm typecheck`, `pnpm test` (175 suites,
including this one), `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local` and
`pnpm test:local`. ESLint and Prettier pass for the three new files; the
repository-wide lint and `format:check` commands fail identically on `main`
before this change (pre-existing script findings and a required `--section`
argument), so they are not claimed.

## Not proved here

- Amazon's real or sandbox behavior, field names, limits, pagination and errors.
  The static sandbox is the next step; its results will be sandbox evidence.
- Whether a cart filled through the API is visible to a manager on the Amazon
  Business website. Who places the order stays open; Ordering and supplier
  submission stay disabled.
- Whether `externalId` deduplicates repeated adds. This code never resends, so it
  does not rely on it.

## Rollback

Revert the commit. The new modules are not imported by the app, so nothing else
changes.
