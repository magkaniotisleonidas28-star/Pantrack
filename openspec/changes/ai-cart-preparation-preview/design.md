# Design

## Context

See proposal.md. Existing reviewed drafts already carry frozen lines and exact revisions. The app runs in a Cloudflare development environment; browsers need a separate Node process. Existing fictional previews isolate D1 and authentication.

## Goals / Non-Goals

Goals: one C4 local reviewed-draft-to-cart outcome, durable local recovery, visible manager handoff and bounded real inference. Non-goals: supplier support, production sessions, spending approval, migrations, scheduling, checkout or deployment.

## Decisions

- Add a local-only Vite middleware bridge and a small gated application authorization endpoint. The endpoint reads the current draft and identity through existing server authorization; no browser session or model secret reaches application clients. The bridge is absent from builds.
- Add a dedicated preview launcher and persistence directory. Reuse the incumbent draft UI, tokens and authorization conventions; extend it with one compact cart section. The separate fictional storefront uses plain catalog/cart rows and explicit practice-account labels.
- Persist immutable job inputs, receipts, baseline cart and attempted writes atomically in local files. One process owns each local store. After process restart, preparing jobs become needs-review until explicitly resumed; the browser profile retains its fixture session. A single cart lock prevents competing jobs, including after handoff until explicit cancellation/release.
- Use Stagehand to launch local Chromium and Playwright over CDP for deterministic form operations. Browser verification found navigation/RPC races in Stagehand 4.1's page driver, so the stable form driver handles clicks and waits. AI selects product candidates from fictional visible observations; trusted code verifies DOM values and derives selectors. Never run an unrestricted agent. Offline mode has no inference; real-AI mode must be separately selected and labeled.
- Restrict browser network to one loopback storefront origin. The model transport is separate and receives fictional storefront content only. Expose no fixture oracle to the browser; tests inspect server state independently.
- Reserve a conservative per-call ceiling from a durable cumulative evaluation ledger before inference; do not refund uncertain calls. Explicit model pricing/token limits are mandatory. Missing credentials leaves evaluation pending, while offline implementation continues.

## Risks / Trade-offs

- Local demo cannot prove supplier compatibility → keep Baldor access as a C3 gate.
- Browser state may be lost after restart → stop for review rather than guessing or duplicating.
- Price or cart drift → verify before each mutation and again before readiness; invalidate readiness on later source changes.
- AI proposes an unsafe candidate → constrain its output to a product index, validate it against exact DOM values and block checkout/network requests independently.

## Migration Plan

No D1 migration or hosted release. Disable by stopping the isolated preview; local evidence and state remain ignored. Retain all purchasing gates and existing PO behavior.
