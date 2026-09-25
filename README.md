# Pantrack

Pantrack is a café inventory and purchasing prototype built with React,
TypeScript, Vinext, and Cloudflare D1. It estimates ingredient stock from sales
and physical counts, then prepares replenishment proposals for review.

## Current state

The repository has company-scoped workspaces, development authentication and
roles, manual and CSV sales import, a register bridge, inventory and recipe
management, and review-only purchasing proposals. Exact inventory and durable
sales ingestion have local implementations behind a preview switch that is off
by default. Clover authorization/menu loading and Stripe-hosted payment-method
setup are prototypes. Live POS sales sync, supplier submission, automatic
ordering, and production acceptance remain unverified or gated.

[Current status](docs/CURRENT_STATUS.md) is the maintained progress summary. It
distinguishes local tests, owner-reported development evidence, and external
acceptance.

## Develop locally

Follow the [local development guide](docs/LOCAL_DEVELOPMENT.md) for the pinned
tools, fictional fixtures, local D1, and verification commands. The normal
checks are `pnpm typecheck`, `pnpm test`, `pnpm db:check`, and `pnpm build`.
Local database migration and HTTP smoke commands are in that guide. No
production credentials are needed for local development.

For scope and acceptance gates, use the [milestone roadmap](docs/PANTRACK_MILESTONES.md).
AI-assisted changes follow [AGENTS.md](AGENTS.md) and the
[development playbook](docs/AI_DEVELOPMENT.md). The [documentation index](docs/README.md)
links to setup, decisions, integration contracts, and historical evidence.
