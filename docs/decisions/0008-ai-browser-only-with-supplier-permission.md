# Decision: AI browser carts only with a supplier's written permission

- Status: accepted by the owner
- Date: 2026-11-14
- Milestone: C3 (external decisions), with C4/C5 supplier context
- Scope: which suppliers the AI browser cart preparation of
  [decision 0005](0005-po-backed-ai-cart-preparation.md) may run against

## Context

Every supplier website checked so far prohibits automated access in its terms:
Baldor ([decision 0007](0007-amazon-business-first-supplier.md)), Amazon
(same) and WebstaurantStore, whose
[Terms of Use](https://www.webstaurantstore.com/policies.html) (last updated
2024-12-19, read 2026-11-14) prohibit, in section 11 "Prohibited uses", using
"any robot, spider, or other automatic device, process, or means to access the
Services". Its public partner page lists no ordering integration. A robots.txt
rule addresses crawlers and does not override those terms.

The owner reviewed the options on 2026-11-14: Amazon through its official API
only; the AI browser only where suppliers give permission; both; or the AI
browser without permission. The owner declined testing on Amazon's website
with a separate account.

## Decisions

1. **Amazon Business stays on its official API** (decision 0007). No AI browser
   runs on Amazon's website.
2. **The AI browser runs only on a supplier that gives written permission** for
   the described use, or whose current published terms clearly allow it. An
   official ordering connection, when offered, is preferred to the browser.
3. **The owner sends permission requests** using the
   [supplier permission request](../C3_SUPPLIER_PERMISSION_REQUEST.md) draft and
   keeps the replies. The agent drafts and records sanitized outcomes only; it
   does not contact suppliers.
4. **A permission does not authorize a session.** The first real session on a
   permitting supplier still needs the café's account permission and explicit
   authorization for that exact test, per AGENTS.md.
5. **No supplier is automated without permission**, including through separate
   or test accounts.

This supersedes decision 0006's withdrawal of the Baldor inquiry: Baldor may be
asked under this decision.

## Consequences

- **The AI browser worker** remains tested local work, waiting on a permitting
  supplier. Its gates are unchanged.
- **Each supplier's permission** is recorded in the permission request document:
  supplier, date, scope and conditions, with no personal or account details.
- **No supplier was contacted** by this decision.
