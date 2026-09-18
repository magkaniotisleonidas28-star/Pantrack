## Scope

Milestone and issue/decision reference:

Describe the problem and the resulting behavior. Include a short before/after example when useful.

## Schema and data

- [ ] No schema change, or additive migrations and updated snapshots/journal are included.
- [ ] Existing migrations have not been rewritten.
- [ ] Company isolation and historical audit records are preserved.

Describe migration and data compatibility considerations:

## Security and integrations

Describe authentication/role checks, company scoping, new environment variables, and external service effects. State whether sandbox credentials or console actions are still required. Do not include secrets, customer records, or access tokens.

## Validation

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm db:check`
- [ ] `pnpm build`
- [ ] `node scripts/local-smoke.mjs` after local database setup
- [ ] Relevant authorization, duplicate, retry, and failure cases are covered.

Record results, known limitations, and screenshots for visual changes:

## Rollback and review

Describe how to revert the code safely, whether a forward data repair is required, and any release/pilot gates. List milestone criteria still blocked, with the evidence or decision needed to unblock them.
