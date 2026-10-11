# C4 manager authorization, Prepare and durable status — local evidence

This bounded C4 outcome connects the purchase-order manager panel to the durable
fictional browser worker. It does not complete C4 or M8. No deployment, hosted
service, model evaluation, real supplier access, checkout or purchase is included.

## Behavior and contracts

The dedicated profile presents **Authorize preparation**, with an explicit cap and
incoming-quantity reservation acknowledgment, then **Prepare fictional cart**.
Draft review remains separate from authorization. Managers see queued/preparing,
verified lines, baseline and complete-cart verification, review holds and cancellation.
Every line can be verified while the job still awaits final verification; the panel
cannot call that cart ready. Invalidated source/permission status also prevents a
ready presentation. On-hand stock is unchanged.

`GET /api/po-cart-jobs?view=manager&companyId=…&orderId=…` retrieves the current
permission and its associated job through current company/owner/manager checks.
Its explicit projection omits private observations, browser sessions, profiles,
credentials and worker identity. Existing job-ID lookup and mutation contracts
remain compatible. The panel opts into receipt-only mutation acknowledgments with
`?view=manager`, then reloads the bounded projection. Responses are private and not
cached. No migration was added;
all 32 existing migrations, including local `0031`, are preserved.

The client saves bounded, non-secret mutation intent and its UUID in browser
session storage, scoped to authenticated actor/company/order, before sending.
After an uncertain response or reload, **Retry saved request** resends that exact
intent. New actions remain blocked until its outcome is resolved. Definitive
validation/conflict responses reload authoritative state. Layout/scenario selection
is frozen while enqueue is pending. Polling runs every two seconds for active jobs;
stopped jobs offer an explicit refresh.

Cancellation works while preparation is active. A never-attempted cancellation
releases reservations; started preparation retains spending/incoming exposure and
existing cart contents. The UI explains that cancellation cannot undo an addition.
Practice sign-in, resume and browser inspection controls are intentionally absent
from the durable panel. Expired sign-in and unknown outcomes stop for review.

## Local commands and process ownership

```sh
pnpm dev:cart-manager
```

One command starts the isolated loopback application/storefront, provisions a
reviewed fictional draft and local policy/connection prerequisites, privately issues
browser credentials, and supervises separate Node 22 workers. Select **Durable cart
practice café → Purchase-order drafts**, open the draft, authorize, then prepare.
The launcher does not authorize or queue work on the manager's behalf.

The supervisor discovers candidates through authenticated worker HTTP. It writes a
private fixture session before starting a separate worker process. Worker application
access remains HTTP-only; local SQL is limited to fixture prerequisites and credential
administration. Existing carts, fixture tokens and journals survive restart, including
a crash between storefront provisioning and session-manifest publication. Rotation
preserves worker identity and receipts. Account/profile locking and conservative
browser recovery remain those proved in the [browser worker slice](C4_PO_CART_BROWSER_LOCAL_EVIDENCE.md).
Credentials expire after one hour; restart rotates them without replacing jobs.

Private manifests, journals, profiles and responsive screenshots live under ignored
`.sites-runtime/po-cart-workers/`. Tokens/cookies never enter command arguments,
manager responses or logs. Startup fails if another preview owns the required ports.
Shutdown ends child workers before ending the application; retained evidence is not
removed. Hard-killed browser profiles still require review/cleanup before reuse.

The original `pnpm dev:cart` file-backed preview and its 16 scenarios remain intact.
`pnpm dev:cart-browser-worker` remains available for operator-driven worker checks.
Both profiles remain off in ordinary development/build configuration.

## Verification

Run the served manager acceptance while the dedicated profile is running:

```sh
pnpm cart:manager:check
```

Eight served-D1 browser cases cover both layouts with normal and malicious content,
expired sign-in, interrupted/lost-response addition, cancellation before claim and
cancellation while a worker owns an attempted line. Acceptance also checks two
competing manager tabs, two independent HTTP browser workers, unchanged stock,
preserved unrelated cart items and reservations, reload recovery, source invalidation,
and lost authorization/enqueue/cancellation responses with identical replay UUIDs.
A paused finalization proves all verified lines alone cannot display readiness.
Desktop/mobile screenshots were inspected; no horizontal mobile overflow was found.
The mechanical design detector reported no findings.

With other previews stopped, run:

```sh
pnpm cart:manager:check:launcher
```

This starts the actual one-command launcher, prepares through the UI using its
supervised worker, then stops and restarts it. The company, order, exact cart, fixture
token, worker identity and addition journal persist; credentials rotate and no
addition repeats. Private fixture unit acceptance separately proves interrupted
provisioning recovery and scope/configuration mismatch rejection.

Verification commands for this slice:

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
pnpm cart:manager:check
pnpm cart:manager:check:launcher
pnpm cart:browser-worker:check
pnpm cart:browser-worker:check:http
pnpm cart:check
pnpm cart:check:http
pnpm cart:worker:check:http
node scripts/po-cart-jobs-http-check.mjs
node scripts/po-cart-authorization-http-check.mjs
pnpm exec openspec validate --all --strict
git diff --check
```

The full unit suite has 70 suites, including manager API/privacy, client recovery
and private supervisor provisioning coverage. Browser-worker regressions cover 36
local process cases and seven served-D1 cases. Original preview regressions cover
16 layout/scenario combinations. Local evidence establishes no external acceptance.

## Rollback and handoff

Stop the launcher and use the ordinary local profile to disable durable browser
execution/transport. Retain jobs, reservations, holds, receipts and private evidence.
No schema rollback is required. Existing workspace changes were preserved.

The next C4 outcome is supervised practice sign-in and browser review, including
explicit browser ownership and a safe recovery protocol. Held attempted work must
never resume by repeating an addition. Hosting, supplier permission, financial policy,
confirmation, documents, receiving and M8 acceptance remain later gates.

The subsequent [supervised practice browser slice](C4_PO_CART_BROWSER_SESSION_LOCAL_EVIDENCE.md)
implements that local sign-in/inspection handoff. This document retains the earlier
slice's original verification scope and counts.
