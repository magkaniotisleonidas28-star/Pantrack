# Decision: Amazon Business as the first real supplier, through its official API

- Status: accepted by the owner
- Date: 2026-11-13
- Milestone: C3 (external decisions), with C4/C5 supplier context
- Scope: which supplier the first real connection targets, and by which route

## Context

The local real-model matrix passed after G17
([seventh paid matrix](../C4_DUPLICATE_INDEX_20261110.md#seventh-paid-matrix)), so
the owner started the real-supplier decisions. Baldor's
[Terms of Use](https://www.baldorfood.com/terms-of-use) (last updated
2024-11-25, rechecked 2026-11-13) still prohibit, in "Prohibited Uses" (c) and
(e), automated retrieval and access through an interface Baldor does not provide.
That restriction blocks the AI browser cart preparation of
[decision 0005](0005-po-backed-ai-cart-preparation.md) on Baldor's website.

The owner proposed Amazon. Amazon's Conditions of Use also prohibit "robots, or
similar data gathering and extraction tools". Supervision does not change that:
the restriction concerns how the website is accessed, and a manager placing the
order does not supply permission. Amazon sued Perplexity in November 2025 over
its AI browser shopping on amazon.com. A March 2026 preliminary injunction was
reversed on appeal around August 2026 on federal computer-access grounds; the
underlying case continues. Account suspension under the terms is a separate risk
the appeal does not address.

Amazon Business publishes an official
[API program](https://docs.business.amazon.com/docs) for business software.
Checked on 2026-11-13, the public documentation describes:

- **Product Search, Cart and Ordering APIs.** The
  [Cart API](https://docs.business.amazon.com/docs/cart-api-overview) creates and
  modifies carts "entirely in external systems", only with items from Product
  Search, and needs the Order Placement and Business Product Catalog roles.
- **Ordering [trial mode](https://docs.business.amazon.com/docs/validating-an-order-with-trial-mode):**
  Amazon processes every step of an order but places none.
- **A [static sandbox](https://docs.business.amazon.com/docs/amazon-business-api-sandbox)**
  for Cart, Product Search, Reconciliation and other APIs (not Ordering). It is
  usable once a Solution Provider Portal account exists, before profile approval.
- **[Onboarding](https://docs.business.amazon.com/docs/register-as-a-developer):**
  an Amazon Business account, an invited developer email with the Tech role,
  Solution Provider Portal registration, identity verification with a video
  call, and a developer profile requesting roles, which Amazon approves or
  denies.

## Decisions

1. **Amazon Business is the first real supplier target**, through its official
   API. No AI browser runs on amazon.com.
2. **The owner creates the Amazon Business account** and performs every
   registration and identity step. Credentials, identity documents and account
   details never enter the repository or the conversation.
3. **Development starts against fakes, then the static sandbox.** A sandbox
   result is sandbox evidence only, kept separate from local and pilot evidence.
4. **Baldor is deferred.** It stays a later or manual supplier. Its withdrawn
   inquiry remains available.
5. **Fallback is a new decision, not a default.** If approval takes too long, the
   owner may revisit the AI browser route. That needs a new recorded decision
   after reviewing the terms risk, and each real session still needs its own
   explicit authorization.

## Open questions

- **Who places the order.** The Cart API's documented path ends with an Ordering
  API call, not a website checkout. Whether API carts appear on the Amazon
  Business website for a manager is unverified. Pantrack placing an order after
  manager approval would be supplier submission, which stays disabled until its
  own gate records evidence. Trial mode can exercise that path without an order.
- **Eligibility.** Registration needs business information and a person
  authorized to sign for the company. Whether the owner's setup qualifies is
  unconfirmed.
- **Approval time and roles.** The documentation states no timeframe. The roles
  to request are Business Product Catalog and Order Placement, with
  Reconciliation later for invoices.
- **Catalog fit.** Which of the café's products Amazon Business carries, at
  which packs and prices, is unverified.
- **Café account.** Using a café's own account later needs its explicit
  permission, as decision 0005 and the C3 checklist require.

## Consequences

- **The [Amazon Business preparation](../C3_AMAZON_BUSINESS_PREPARATION.md)**
  records the owner's checklist and the C3 items for this supplier.
- **The AI browser worker stays** the tested local route and a candidate for
  suppliers whose terms permit it. No change to its gates.
- **No supplier was contacted** and no account was created or used by this
  decision.
