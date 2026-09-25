# C4 fake consumer to A7 proposal handoff

This is one C4 contract slice. `C4FakeSupplierConsumer` consumes A7's
`pantrack.replenishment-handoff.v1` object. It validates the company, proposal
revision, exact published fields, supplier fixture, stock unit and quantity,
money fields, source versions, review warnings, and safety limits. It keeps an
immutable in-memory copy and returns a held result. It has no supplier client,
fetch call, submission method, or schedule. Every A7 handoff stays review-only,
including one carrying an `approved` status for a future lifecycle test.

The cross-workstream test calls A's actual `buildReviewProposal` and
`buildProposalHandoff` functions, then passes their output to C's consumer.
It covers whole-pack quantity and total preservation, a reasoned edit,
inventory invalidation, company isolation, exact replay, stale/conflicting
revisions, changed immutable origin fields, extra or malformed fields,
immutable copies, and zero supplier calls. No API route or real provider is
involved. This proves the A → C local contract required for A7; it does not
prove M8 ordering or C4's remaining supplier/job/alert/budget work.

Local checks in the C4/A7 worktree passed: TypeScript, all 29 test suites,
the 18-migration schema check, application build, a fresh local Wrangler D1
apply of all 18 migrations, and the local HTTP smoke test. The smoke test
checks existing routes; there is no new A7/C4 API route. Remote D1 migration,
Cloudflare deployment, supplier submission, and scheduling were not run.

A7's local checklist can close with this C4 handoff evidence. M7 acceptance
still belongs to A8 after reliable M5 inputs and end-to-end proposal tests.
