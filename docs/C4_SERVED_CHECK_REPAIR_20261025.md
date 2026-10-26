# C4 served check repair — anonymous requests in local previews (2026-10-25)

Status: local fix verified. It changes no milestone checkbox. C4/M8 remain open.

## In plain terms

Two older local check scripts, the cart authorization check and the cart jobs check,
had been failing. Both include a step where **nobody is signed in** and expect
Pantrack to answer "please sign in" (401). Instead, the local cart preview answered
"sign-in is temporarily unavailable" (503).

This came from the October 20 sign-in reliability fix. That fix correctly reports
"unavailable" when Pantrack cannot check a session, for example during an outage.
In the local preview, however, it also fired for visitors who had **no session at
all**. The preview runs on a local address that Pantrack's address check doesn't
accept, so the check failed before Pantrack even looked for a session.

The fix: a request that carries no session cookie is simply "not signed in". There
is nothing to check, so it can never be an outage. Requests that do carry a session
behave exactly as before, so a session that can't be checked is still refused safely.

## Change

[`auth.ts`](../src/lib/auth.ts): `sessionFromHeaders` returns `null` when neither
the `__Host-pantrack` cookie nor the `pantrack_local` cookie is present. It does
this before reading the origin configuration. A duplicated cookie name already
resolved to "no session" and still does. Everything else is unchanged, including
the outage handling from `f0ed8e9`.

The check scripts are unchanged.

## Correction to earlier evidence

[Part 1 of the owner spending limits](C7_OWNER_SPENDING_LIMITS_LOCAL_EVIDENCE.md)
recorded both scripts as failing on unchanged `main`. Only the anonymous 503 was a
real `main` failure, and it affected both scripts: the authorization check at its
first anonymous request, and the jobs check at line 30.

The jobs check's Wrangler fixture failure seen in that clone was an artifact. The
clone's preview database had already been migrated to `0035` by the branch runs, and
`main`'s positional `po_cart_budget_policies` insert no longer matched it.

## Verification

| Check | Result |
| --- | --- |
| [`m2-security`](../tests/m2-security.mjs) | New cases cover an unusable origin (the cart preview's `127.0.0.1:5181`) and a missing origin. With no cookie, the companies, members and waste families all return 401. With the owner's session present, the request still returns 503. With a valid origin, anonymous returns 401 and the owner returns 200. The earlier F8 outage cases still pass. |
| Planted defect | Removing the new early return makes `m2-security` fail |
| `node scripts/po-cart-authorization-http-check.mjs` against `pnpm dev:cart`, in an isolated clean clone | **Passed 2/2**, unmodified |
| `node scripts/po-cart-jobs-http-check.mjs` against `pnpm dev:cart`, same clone | **Passed 3/3**, unmodified |
| `pnpm cart:worker:check:http` and `pnpm cart:spending-limits:check`, same clone | Passed |
| `pnpm typecheck`, `pnpm test` (**124 suites**), `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` | Passed |

These checks ran in the isolated clone, so real `.sites-runtime` profiles, locks and
evidence stayed unchanged.

**Rollback:** revert the commit. There is no schema or data change.
