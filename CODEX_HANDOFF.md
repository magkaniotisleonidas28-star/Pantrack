# Pantrack: handoff to Codex in VS Code

This is the committed source of the Pantrack Sites app (cc1a537411d6bef9541b0522887067ea64885616). It is not a database backup or a turnkey independent deployment.

## First local task
Inspect package.json, scripts/, app/chatgpt-auth.ts, db/raw.ts, migrations in drizzle/, and hosting configuration before running or changing the app. Preserve the existing code and company isolation. Prepare and document a local development environment without altering the live site.

Runtime declared in package.json: Node >=22.13.0, pnpm 11.25.0. Keep pnpm-lock.yaml. The exported project defaults to its portable execution profile. Typical commands after prerequisites and local environment configuration are pnpm install --frozen-lockfile and pnpm dev. These commands were not tested on the user's computer. The dev script uses port 5173 in portable mode.

## Architecture and portability
React/TypeScript using Vinext, Vite and Cloudflare Workers. D1 binding DB stores company data. Existing migrations define the schema. A local database must be initialized using the project's supported configuration. Production records are not included. Do not point experiments at production.

Authentication currently trusts identity headers supplied by the Sites hosting layer. Those headers are NOT independently secure authentication on another host. For independent hosting, implement verified sessions/authentication and preserve membership/owner checks. Do not solve local login by exposing a production auth bypass or trusting arbitrary client-supplied identity headers.

.env.example lists required integration variables, but contains no live secrets. Runtime secrets, OAuth tokens, encryption keys and customer data are not exported. Preserve the deployed encryption key if migrating existing encrypted records; a new key will not decrypt them. Existing Clover and Stripe return URLs reference the Sites domain and need deliberate configuration if the host changes.

## Implemented
Company workspaces and access checks; product catalog; prepared orders and removal; payment interface (activation pending); inventory opening counts, receipts, usage/waste, incoming stock; recipes and manual sales imports; explicit target-stock replenishment with pack rounding; vendor connection framework and purchasing controls; company POS settings; register-to-recipe mappings; CSV previews; authenticated sales bridge with company-scoped tokens and duplicate protection; Clover OAuth authorization and menu loading (credentials/activation pending).

## Not yet complete
Clover order synchronization/modifiers/refund reconciliation; other native POS integrations; actual supplier-specific adapters and real end-to-end purchase validation; provisioned purchasing scheduler; live payment configuration; production operational monitoring and comprehensive security review. Provider dropdown entries are not working native integrations. The common ingestion endpoint needs an external adapter which translates authorized register sales.

Integration guides are in public/clover-setup-guide.md and public/register-integration-guide.md. Tests under tests/ use mocked external services and local SQLite. They are not evidence of a tested live merchant or vendor.

## Source control and deployment
The zip has no Git history or stored Git credentials. Initialize a local Git repository and optionally publish to a private GitHub repository under the user's account. Local changes do not automatically deploy to the existing Sites URL. Keep the live app unchanged until a deliberate deployment/migration decision is made.
