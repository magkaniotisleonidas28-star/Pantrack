# Decision: PO-backed AI cart preparation with manager checkout

- Status: accepted product direction; implementation and external acceptance pending
- Date: 2026-10-09
- Milestones: C3–C9, M8–M14
- Supersedes: email-first channel adopted in [the rollout](../PURCHASE_ORDER_ROLLOUT.md) on 2026-10-03

## Context

Pantrack already has local PO foundations, versioned supplier mappings, audited
draft review and a fictional cart preview. The preview's 16 offline browser
scenarios are local evidence only; real-AI evaluation remains pending. None of
these records establishes purchasing approval, Baldor permission or compatibility.

## Decision

Keep the PO as the purchasing record. Use Stagehand-assisted cart preparation in
Browserbase, followed by manager-controlled checkout in the same hosted browser.
AI never submits checkout. Weekly scheduling creates drafts and reminders; a
manager explicitly starts preparation. Supplier sign-in and checkout are
desktop-first; PO review, status and receiving remain responsive.

Cloudflare remains authoritative for identity, company authorization, D1 records,
jobs and transitions. A Node 22 Render background worker claims work through
authenticated internal endpoints without database credentials. Baldor is the
first candidate, conditional on permitted access, café/account authorization,
compatibility and separately approved testing budgets.

Keep PDF/native Excel exports, history, manual supplier confirmation and A-owned
atomic incoming/receiving contracts. Defer supplier email dispatch, its outbox,
sender-domain and email-specific provider/webhook infrastructure. Notification
email remains in scope. Never switch channels automatically after uncertainty.

## Alternatives considered

- Email-first POs: earlier accepted direction, now superseded; its historical
  preparation and test evidence remain valid at their original local scope.
- Supplier APIs: optional M13, subject to approved access and actual user demand.
- AI checkout or unattended purchases: separate M14 automation project, requiring
  explicit permission and evidence beyond this manager-controlled workflow.

## Consequences

Draft review, preparation authorization, supplier confirmation and receiving are
separate decisions. Cart, purchase and delivery states must persist independently.
Unknown checkout retains quantity commitments and budget exposure. Pantrack
cannot technically cap a manager's spending at an external supplier checkout.

Browser contexts and Live View links require private handling, verified recording
and logging controls, revocation and cleanup. The first pilot uses existing
supplier payment arrangements. Planning authorizes no deployment, paid hosted
test, supplier contact, account access or purchase. The detailed sequence and
unchecked gates are in [the integration guide](../PO_AI_CART_INTEGRATION_ROADMAP.md).
