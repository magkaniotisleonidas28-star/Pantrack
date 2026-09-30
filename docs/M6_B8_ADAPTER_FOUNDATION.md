# B8 — Local POS adapter foundation

Date: 2026-09-30. Outcome: shared foundation complete locally; B8/M6 remain
incomplete. Branch: `workstream-b/b8-toast-foundation`, based on `b2f4be6`.
Toast is selected, and the owner reports no API access yet.

## Task contract

Extract one shared POS boundary from the accepted Clover implementation,
preserve Clover's existing API behavior, and expose truthful register status.
Prove the normalized-event boundary using Clover and a deliberately fictional
second provider. Native Toast functionality requires the separate
[Toast access handoff](M6_TOAST_ACCESS.md).

This outcome uses local fixtures only. It adds no migration, changes no
inventory calculation or M4 schema, and enables no provider/supplier gate. It
does not deploy, contact Toast, apply remote migrations, or create POS orders.

## Implementation and contracts

| File | Responsibility |
| --- | --- |
| [pos-adapter.ts](../src/lib/pos-adapter.ts) | Shared adapter interface, implemented capabilities, explicit supported/unsupported results, native receipt helper |
| [clover-pos-adapter.ts](../src/lib/clover-pos-adapter.ts) | Existing Clover authorization status, bound location, catalog, sync, webhook, health, source binding, and order projections |
| [clover-webhook.ts](../src/lib/clover-webhook.ts) | Existing authenticated webhook implementation extracted from its route |
| [pos-provider-status.ts](../src/lib/pos-provider-status.ts) | Read-only sanitized company/provider capability and connection summary |
| [register route](../src/app/api/register/route.ts) | Additive `availability` response alongside unchanged settings/bridge fields |
| [status component](../src/components/workspace/pos-connection-status.tsx) | Separate native, CSV, and bridge labels; displayed by the register card |
| [adapter contract suite](../tests/pos-adapter-contract.mjs) | Common M4 scenarios for Clover and a fictional provider |
| [register status suite](../tests/pos-register-status.mjs) | Local SQLite authorization, privacy, statuses, fallback, and no-network checks |

The Clover routes delegate catalog, sync, health, and webhook operations through
the wrapper. Their wire shapes remain compatible, including catalog
`merchantId`, pagination, and webhook response codes. Clover OAuth connect,
callback, disconnect, encrypted tokens, refresh/recovery leases, mappings,
cutoff, scan overlap, checkpoints, and revision normalization stay in the
existing provider modules. The native receipt helper uses the same M4 service
and machine actor identity that Clover used before.

Capabilities describe implemented operations. Clover supports a bound location,
not location discovery. Toast and other unimplemented providers return explicit
unsupported results for every operation and never manufacture a connection.
The interface is an internal server contract; callers must authorize the company
or authenticate/bind the webhook before invoking provider operations.

`GET /api/register` retains existing membership read permission, owner-only
mutation permission, and private/no-store caching. Its new summary exposes no
native merchant ID, encrypted token, token expiry, private provider error, or
secret. Status reads perform no decrypt, provider call, or database write.
Unknown/missing health reports degraded/unavailable rather than ready. Stored
Clover authorization is local connection evidence, not a fresh provider token
validity check. “Ready for manual sync” does not claim a scheduler is provisioned.

Provider selection is only a saved preference. A bridge token indicates
configuration; recorded accepted requests indicate history, not proof of
continuous or current-token delivery. CSV remains available. “Clover sandbox
validation recorded” refers to the prior bounded B7 evidence, not new acceptance
of the current company's connection. UI reads and preference changes do not
discard another provider's stored connection or history.
The register card has a read-only status refresh control. Clover actions refresh
the summary after success or failure, including disconnect and sync, so it does
not retain an earlier authorization/health label after an owner action.

## Verification

- PASS — `pnpm typecheck`.
- PASS — `pnpm test`: 34 suites, including existing Clover/bridge regressions
  and the two new suites.
- PASS — `pnpm db:check`: unchanged 18-migration schema/journal/snapshot and
  fresh SQLite application.
- PASS — `pnpm build`: Worker/client build completed.
- PASS — `pnpm db:migrate:local`: no pending local migrations.
- PASS — `VINEXT_NO_DEV_LOCK=1 pnpm test:local`: served anonymous/forged-header
  rejection, fixture sign-in, company creation, catalog, isolation, CSRF, and
  sign-out. The environment override permits the script's separate ephemeral
  port while preserving the owner's existing preview server on port 5173.
- PASS — served local API preference save/read for a new fictional B8 company;
  Toast remained setup required, with CSV available and bridge disabled.
- PASS — Safari visual review at `127.0.0.1:5173` in a separate tab, using
  **B8 Toast local QA (fictional)**. After loading its saved Toast preference,
  Setup & register displayed the unsupported-native explanation and separate
  CSV/bridge labels legibly in the existing dark theme, without a Clover
  connection card. The original company settings were preserved. The local
  fixture remains for review; no token, mapping, sale, or inventory entry was
  created. Clicking **Refresh register status** returned the same truthful
  Toast summary. Other status variants have deterministic markup/API coverage rather
  than new sandbox/browser evidence.
- PASS — `git diff --check` and added-relative-link validation: 20 links resolve.
- PASS — full self-review: changes stay within B8's foundation; company/role
  authorization and server bindings remain intact, and no credentials, schema
  edits, enabled gates, or external writes were added. The extracted Clover
  webhook matches its previous implementation exactly except the export name.

The shared contract covers a sale, duplicate delivery, added paid line, refund
without ingredient restoration, unpaid cancellation without use, whole-event
unknown item/modifier holds, mapped modifier use, initial history cutoff, and
company/provider event-key isolation. Both fixtures reach the same M4 receipt
and inventory-consumption contracts without second-provider inventory logic.
The second fixture is intentionally fictional; it is not a Toast payload
parser, transport test, or sandbox acceptance.

The register suite proves anonymous and wrong-company rejection; preserved
manager/employee sanitized reads and forbidden mutations; no status writes;
setup-required, disconnected, authorized, paused, degraded, unavailable-health,
and environment-mismatch states; bridge configuration/history/revocation;
connection/history preservation; and zero external calls/events/stock changes.

Existing Clover tests use mocked provider responses. The accepted direct Clover
development-sandbox evidence remains separately recorded in the
[B7 acceptance review](M5_B7_ACCEPTANCE_REVIEW.md). There is no new external
provider evidence from this task.

## Adding a future native adapter

1. Obtain approved provider access, environment/host, read scopes, and a bound
   fictional location. Record these non-secret decisions before implementation.
2. Implement `PosAdapter` in a provider-specific server module. Keep credential
   lifecycle, transport validation, bounded pagination, parsing, and webhook
   authentication there. Return `unsupported` for unavailable operations and
   expose only capabilities actually implemented. Existing Clover authorization
   lifecycle routes remain provider-specific; the common status operation is
   not a generic credential-writing endpoint.
3. Persist company/provider/environment/location bindings and any credentials
   through reviewed additive migrations and encrypted storage. Never accept
   client-supplied bindings as authorization. Toast's credential flow differs
   from Clover's; see the [access handoff](M6_TOAST_ACCESS.md).
4. Project stable external identities and revisions into `SalesEventDraftV1`
   and server-created `SalesSourceBinding`. Use the M4 service through
   `receivePosEvent`; implement company/provider mappings through the existing
   mapping port. Do not put provider payload handling in inventory modules.
5. Reuse this contract suite with the real normalizer. Add deterministic tests
   for transport, permissions, cutoff, checkpoint/page bounds, retry/timeouts,
   disconnect, and ambiguous outcomes. Add anonymous/company/role tests to new
   APIs and keep status read-only and private.
6. Register the adapter in `posAdapter` only when its implementation is ready.
   Verify capability/status UI states. Collect separate approved sandbox
   evidence before marking the real provider accepted. CSV and bridge remain
   usable throughout.

## Review, rollback, and handoffs

No schema or stored credential format changed, so this local slice can be
reverted as a code-only change. Revert the wrapper, its route delegation and
receipt helper, and additive status UI/API together; preserve existing Clover
tables and history. No remote rollback is needed because this task is local.

B owns the native Toast adapter after access. The owner/C3 supply access and
approval/cost decisions. A continues using the unchanged M4 inventory contract;
C receives no new purchasing permission. The next unblocked B8 action is the
owner's access checklist; the next code slice is a read-only Toast connection
after the approved sandbox handoff.
