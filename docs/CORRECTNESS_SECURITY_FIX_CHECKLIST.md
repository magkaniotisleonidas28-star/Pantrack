# Correctness and security fix checklist

Recorded: 2026-10-04. Session type: documentation handoff from the read-only
C9 security review; this does not complete M12 or change milestone acceptance.

Review baseline: `main`, commit
`50a3a29a4e86f44a586f11b38a04e502717dee52`. The review inspected committed
implementations, callers, database constraints and tests. Existing work was
modified `docs/README.md` and untracked `docs/APPLICATION_DATA_FLOW.md`; both
were preserved. Line numbers below refer to this baseline and will move as fixes
land. Recheck the current code rather than patching by line number alone.

There are six confirmed local defects. Each entry contains its own completion
checkbox and a prompt for one independent fixing agent. None is fixed by this
document. The observed evidence records successful inline review experiments or
confirmed source/caller traces. The deterministic reproduction procedures below
guide durable regression tests and were not all independently executed with those
exact barriers. The inline experiments are not committed tests; each fixing agent
must add deterministic, durable regression coverage.

## Assignment and merge order

| Entry | Severity | Workstream/checklist context | Dependency and shared files |
| --- | --- | --- | --- |
| [BUG-01](#bug-01--password-recovery-misses-concurrent-session-creation) | High | C2 / M2 authentication follow-up | Independent; any schema change uses the single migration queue. |
| [BUG-02](#bug-02--newer-sales-revision-deducts-committed-inventory-again) | High | B5 / M4 recovery, B7 / M5 consumer; A2 contract boundary | Produce safe outcome/recovery handoff before BUG-05 runtime wiring. |
| [BUG-03](#bug-03--duplicate-polling-hides-unapplied-sales-from-readiness) | High | B7 / M5 health, A8 / M7 readiness consumer | Can harden readiness independently; coordinate `clover-sync.ts` with BUG-02/05. |
| [BUG-04](#bug-04--measurement-changes-reinterpret-planning-quantities) | Medium | A5 / M3 compatibility, purchasing suggestions | Shares `d1-inventory-management.ts` and tests with BUG-06. |
| [BUG-05](#bug-05--expired-processing-events-have-no-runtime-recovery-path) | Medium | B5 / M4 recovery entrypoint, B7 / M5 polling | Runtime recovery depends on BUG-02's safe reconciliation/fencing behavior. |
| [BUG-06](#bug-06--conflicting-concurrent-physical-counts-both-report-success) | Medium | A5 / M3 physical-count idempotency | Shares `d1-inventory-management.ts` and tests with BUG-04. |

Use a separate worktree and short-lived branch for each fixing agent, following
the [roadmap ownership rules](PANTRACK_MILESTONES.md#file-and-merge-ownership)
and [concurrent AI workflow](AI_DEVELOPMENT.md#6-concurrent-ai-work). Independent
agents do not imply independent edits to the same checkout. Serialize overlapping
merges, rebase the second branch and rerun affected tests. BUG-04 and BUG-06 can
be developed separately but must not overwrite each other's changes.

BUG-02, BUG-03 and BUG-05 may be diagnosed in parallel. Record the company-scoped,
tested recovery/outcome contract from BUG-02 before BUG-05 uses it. Do not simply
wire the current recovery method into production callers: it can expose the
double-deduction failure. Coordinate any A-owned consumption contract changes
with its consumers rather than copying inventory logic into B.

Make this new document available to each worktree through a documentation-only
commit or by copying this file alone. An untracked file is not included when a
new worktree is created from `HEAD`. Do not stash, discard or copy unrelated dirty
work to accomplish that. Each agent should update only its own entry in its branch;
the merge owner combines checkbox/evidence changes in this shared document.

## Shared execution and completion rules

Read [AGENTS.md](../AGENTS.md), [current status](CURRENT_STATUS.md), the
[AI development playbook](AI_DEVELOPMENT.md), and the relevant checklist/milestone
section of the [roadmap](PANTRACK_MILESTONES.md). Fix one bug and produce one
reviewable outcome. Record the current commit, branch and working-tree state;
inspect current source and tests; restate the objective, constraints and observable
completion criteria before editing.

All six fixes can be developed with fictional fixtures and mocked providers.
No credentials or live-provider actions are required. Do not deploy, push to a
deployment-triggering branch, contact live integrations, alter remote data,
place orders, provision schedules, or enable purchasing or hosted Clover sync.
Test-only gates in mocked environments do not authorize runtime configuration
changes. Preserve company isolation, server authorization, exact quantities,
immutable history and auditable idempotency.

Use deferred promises or explicit test hooks for race tests, not sleeps. Prefer
the real D1-backed domain services over a fake consumption port for cross-system
regressions. Apply the journaled migrations to an isolated in-memory SQLite
fixture with foreign keys enabled. A mocked-provider/SQLite pass is local evidence,
not native provider, hosted D1, pilot or production evidence.

During iteration, run the entry's focused tests. Before completion, follow the
playbook's risk-based checks and the normal local pipeline:

```sh
pnpm typecheck
pnpm test
pnpm db:check
pnpm build
pnpm db:migrate:local
pnpm test:local
```

Run database and HTTP checks against the fixing worktree's isolated local state,
following [local development](LOCAL_DEVELOPMENT.md); preserve the owner's existing
local database. Do not reset that database. If a required check cannot run, state
the command and reason and leave the affected completion evidence open. Tests
that share generated module names must run sequentially within one worktree.

Schema changes require new migrations. Never rewrite used migrations or reserve
a migration number across branches. Serialize schema-bearing integration, rebase
first, then generate and inspect SQL, snapshot and journal. Test fresh and populated
upgrade behavior, and document compatibility and rollback/forward repair. A security
fix's rollback must not silently reopen the vulnerability.

Only check an entry off when its reproduction fails before the fix and passes
afterward, its acceptance criteria are met locally, required checks pass, and the
full diff has been reviewed. Replace its pending closure record with the fixing
commit, changed files/contracts/migrations, exact commands/results, compatibility
or repair limits, rollback/forward-repair plan and downstream handoff. Leave
external verification explicitly separate; do not mark a whole milestone complete.

## BUG-01 — Password recovery misses concurrent session creation

- [x] **BUG-01 fixed locally** — concurrent authentication cannot create a usable
  pre-recovery session after successful password reset.

**Severity and confidence:** High. Confirmed local revocation race. Live exploit
applicability depends on provider acceptance of a pre-reset access token and was
not independently verified against Supabase.

**Objective:** Make Pantrack's durable session revocation cover authentication
attempts already in flight when recovery occurs. Context: C2 / M2 follow-up.

**Relevant files and contract:**

- [Authentication route](../src/app/api/auth/route.ts), lines 38–41: delete all
  sessions, update provider password, then best-effort global logout. Lines 46–54:
  reauthentication/sign-in/email-link exchanges and session creation.
- [Session library](../src/lib/auth.ts), lines 53–61: verify the token and insert a
  session unconditionally; lines 68–72: validate a stored session.
- [Schema](../src/db/schema.ts), `authUsers` and `authSessions`; original structures
  in [0008](../drizzle/0008_m2_auth_memberships.sql). Inspect later migrations too.
- [M2 decision](decisions/0001-m2-authentication.md) and [M2 setup](M2_SETUP.md): D1
  owns Pantrack revocation; recovery sessions cannot access company APIs. Provider
  tokens may outlive logout according to the repository's stated threat model.
- [Security tests](../tests/m2-security.mjs), fake provider near lines 19–39 and
  sequential recovery assertions near lines 371–378; [local auth tests](../tests/local-auth.mjs).

**Failure and impact:** A sign-in obtains a provider token with the old password,
then pauses before the Pantrack session insert. Recovery deletes existing sessions
and completes. The pending sign-in resumes and inserts a usable normal session.
Someone using the compromised password may keep company access for the session's
remaining lifetime, capped at one hour.

**Observed evidence:** Recovery returned HTTP 200 with zero D1 sessions. Resuming
the delayed sign-in returned HTTP 200 and left a session accepted by
`sessionFromHeaders`. No durable revocation generation or insertion fence exists.

**Deterministic reproduction:**

1. Extend the real route/fake-provider harness in `m2-security.mjs`; create an owner
   recovery session through the fake `/verify` response.
2. Start owner sign-in. Record its token when fake `/token` issues it. Pause that
   token's subsequent **GET** `/user` response using deferred promises. Exclude
   recovery requests and **PUT** `/user` from the pause.
3. Complete password recovery, preserving the fake provider's already-issued
   access tokens through password PUT/global logout. Assert old sessions are gone.
4. Release the sign-in. Current code inserts an authenticatable session. The fixed
   code must leave no usable session from that stale authentication attempt.
5. Repeat for reauthentication, which verifies twice, and for a schedule paused
   immediately before insertion after verification has already finished. Keep
   request headers explicit: the current harness has shared `m2headers` state.

**Implementation cautions:** Reading a generation only inside `createSession`
after provider verification can still accept the stale proof under a new generation.
Fence the authentication attempt before its external exchange and check the fence
atomically at insertion, including flows where the trusted user ID becomes known
later. Cover sign-in, reauthentication and email-token exchange. A missing/deleted
`oldHash` must not bypass protection. Another deletion, an in-process mutex, or
best-effort provider logout alone does not establish a cross-Worker guarantee.
Define fail-closed behavior for failed/timed-out recovery and simultaneous resets
without leaving a permanent recovery lock.

**Acceptance criteria:**

- Delayed pre-reset authentication cannot authenticate any company request after
  recovery; reauthentication cannot resurrect a revoked predecessor session.
- A fresh new-password sign-in after reset works. Concurrent resets and recovery
  failures have documented, tested behavior and accurate audit outcomes.
- Cookie security, encryption, expiry, provider-rejection behavior, recovery
  isolation, company roles and owner reauthentication remain covered.
- Any new schema fence preserves memberships/company data and has a tested
  existing-session compatibility policy and secure forward-repair plan.

**Focused check:** `pnpm test:focused m2-security local-auth`.

**Closure record (2026-10-04): Complete locally — C2 / M2, BUG-01 only.**

- **Checkout and commits:** Started from `main` at
  `50a3a29a4e86f44a586f11b38a04e502717dee52`. The original checkout still has
  modified `docs/README.md` and untracked `docs/APPLICATION_DATA_FLOW.md` and
  this checklist; those files and the owner's local databases were preserved.
  Work is isolated in `/private/tmp/pantrack-bug01-20261004`, branch
  `workstream-c/bug-01-recovery-session-fence`. Regression commit `67b4dce`
  precedes fixing commit `6d2e48b66a0b9d12ce3c513cdeef645f5f911249`.
  The branch was rebased on current local `main` before the sole schema change;
  `main` remained at the recorded baseline. No merge, push or deployment occurred.
- **Reproduction:** `pnpm test:focused m2-security local-auth` initially passed
  the existing two suites. With the durable regressions added and authentication
  still unfixed, the same command failed all 13 barrier schedules: password
  sign-in, reauthentication and signup/recovery email exchanges paused at token
  response, GET `/user`, or immediately before session insertion. Reauthentication
  also paused at its second token verification. Every delayed attempt returned
  HTTP 200 and an authenticatable session after recovery had left zero sessions.
  Fake provider tokens survive password PUT and global logout; no sleeps are used.
- **Changed behavior and files:** [The auth route](../src/app/api/auth/route.ts)
  captures a database sequence before any provider exchange or existing-session
  verification. [The fence module](../src/lib/auth-session-fence.ts) maintains
  each user's revocation cutoff and claims recovery atomically with session
  revocation and `password.recovery_attempt`. [Session creation and validation](../src/lib/auth.ts)
  require the captured fence, enforce it in the insertion transaction, require a
  surviving predecessor for rotation, bind reauthentication to the same verified
  identity, and recheck revocation after provider GET. Rejected insertion creates
  no session-success audit. Provider logout remains best effort; there is no
  second session deletion on recovery completion.
- **Failure/concurrency contract:** One validated recovery cookie wins the
  database claim; an overlapping loser makes no password PUT and records no
  recovery-success audit. Session creation is blocked during the 30-second lease.
  Explicit provider rejection records `password.recovery_failed`; 5xx, redirects,
  timeout and lost responses record `password.recovery_unknown`. Every terminal
  outcome advances the cutoff before releasing its own lease. A missing completion
  leaves the lease until a new authentication attempt atomically advances the
  cutoff, records `password.recovery_unknown` with `lease_expired`, and unlocks.
  Proofs begun during that lease remain rejected. Late completion advances the
  cutoff without releasing a newer recovery's lease. Unknown outcomes do not claim
  password success; fresh provider-approved credentials or a fresh recovery link
  are required. A rolled-back completion audit leaves no false success and follows
  the same bounded expiry path.
- **Schema and compatibility:** [Schema](../src/db/schema.ts), new migration
  [0023](../drizzle/0023_auth_recovery_fence.sql), its
  [snapshot](../drizzle/meta/0023_snapshot.json), and the
  [journal](../drizzle/meta/_journal.json) add the sequence, per-user cutoff/lease,
  and session epoch. All used migrations are unchanged. Existing sessions lack a
  pre-exchange fence and are intentionally cleared once; users must sign in again.
  The populated-upgrade test preserves all other tables and identity fields,
  including company memberships and security history. Snapshot ancestry and
  semantic changes were reviewed: only `auth_fence`, `auth_users`, and
  `auth_sessions` differ. No identity mapping or environment-variable change is
  introduced; cookie attributes, AES-GCM scope, expiry cap and no-refresh-token
  policy are preserved.
- **Local acceptance evidence:** [M2 security tests](../tests/m2-security.mjs)
  pass all 13 stale-proof schedules, fresh new-password sign-in/old-password denial,
  both same-cookie and different-cookie simultaneous resets, all four provider
  failure modes, provider logout failure, delayed company authentication, deleted
  reauthentication predecessor, abandoned/late recovery, lease expiry, completion
  rollback and populated upgrade. Company roles, stock and immutable history remain
  unchanged. Existing anonymous/wrong-company/forbidden-role, owner reauthentication,
  CSRF, recovery isolation, encryption/tampering, cookie, provider-rejection and
  expiry coverage passes; 30-second and capped two-hour provider lifetimes are
  additionally checked.

Final verification used Node **22.23.2**, pnpm **11.25.0**, fictional data and this
worktree's isolated `.wrangler/state`. Each command below passed. The final log is
ignored local state at `.sites-runtime/bug01-verification.log`.

| Command | Result |
| --- | --- |
| `pnpm test:focused m2-security local-auth` | PASS — both suites, including all BUG-01 regressions. |
| `pnpm typecheck` | PASS. |
| `pnpm test` | PASS — all 41 suites. |
| `pnpm db:check` | PASS — 24 ordered migrations, schema/snapshot/journal agreement and fresh SQLite application. |
| `pnpm build` | PASS — Worker build; no deployment. |
| `pnpm db:migrate:local` | PASS — initial isolated fresh D1 applied all 24 migrations; pinned-runtime repeat reported no pending migrations. |
| `pnpm test:local` | PASS — fictional loopback HTTP smoke, auth pages, fixture sign-in/out, company creation, isolation and CSRF. |
| `git diff --check` | PASS — source/migration diff reviewed for scope, authorization, secrets and external effects. |

The initial local migration check hit sandbox `listen EPERM`; it passed with
loopback permission. An offline frozen dependency install could not find policy
cache metadata, so the already-installed dependency tree was copied into the
worktree; the lockfile and dependencies were not changed. The final pipeline
explicitly selected the installed Node 22.23.2 runtime.

**External limits:** Pre-reset Supabase access-token acceptance and actual provider
revocation remain **externally unverified**. The race proof uses the real auth route
with fake provider barriers and transactional SQLite; the HTTP smoke uses the local
identity fixture. Neither proves hosted multi-Worker D1 concurrency, hosted email
callbacks, pilot or production acceptance. No live integration or remote-data action
was authorized or performed, and purchasing gates remain unchanged.

**Rollback/forward repair and handoff:** Retain migration `0023`, its sequence and
all revocation cutoffs. Do not restore old sessions, lower epochs, remove the fence
or roll back to authentication code that omits it. If repair is needed, suspend
authentication/company traffic and forward-fix the fenced implementation; invalidate
affected sessions with an audited, atomic cutoff advance before resuming. The release
owner must coordinate schema/code cutover without serving mixed unfenced auth code;
remote migration, deployment and provider acceptance require a separate authorized
task. A/B consumers retain their company/role contracts. The next independent local
checklist item is BUG-02, whose safe outcome handoff must precede BUG-05; none of its
work is included here. No local BUG-01 blocker remains.

### BUG-01 agent prompt

```text
Implement BUG-01 only from docs/CORRECTNESS_SECURITY_FIX_CHECKLIST.md.
Workstream/checklist context: C2 / M2 authentication follow-up.
Read AGENTS.md, docs/CURRENT_STATUS.md, docs/AI_DEVELOPMENT.md, the relevant
roadmap sections, and this document's shared execution rules and BUG-01 packet.

Record HEAD/branch/status and preserve existing work. Use a separate worktree
and branch if agents are active concurrently. Restate the task contract.
Reproduce the delayed sign-in/session-insertion race with the real auth route
and deterministic fake-provider barriers before fixing it. Fence every session
creation path across password recovery, including reauthentication and email
exchange; do not rely on a second deletion or provider logout. Preserve company
permissions, recovery isolation, cookie/encryption/expiry and audit behavior.
Use only a new migration if needed, coordinated through the migration queue.

Run the focused checks and required isolated local pipeline, inspect the full
diff, and update only BUG-01's checkbox and closure evidence when its acceptance
criteria are proved. Report provider-token applicability as externally unverified.
Do not fix other entries, deploy, push, contact live services, alter remote data
or enable purchasing. Finish with the required evidence/rollback/handoff record.
```

## BUG-02 — Newer sales revision deducts committed inventory again

- [ ] **BUG-02 fixed locally** — a lost inventory outcome cannot cause a newer
  revision or recovered attempt to consume previously applied items again.

**Severity and confidence:** High. Confirmed through real D1-backed services with
all migrations and mocked Clover. Native Clover sync is gated; the review did not
enable it in any hosted environment. Context: B5 / M4, B7 / M5, A2 boundary.

**Objective:** Resolve durable inventory outcomes before superseding an uncertain
predecessor and preserve the correct consumption baseline for later revisions.

**Relevant files and contract:**

- [Inventory port](../src/lib/d1-inventory-consumption.ts), lines 563–565: inventory
  batch commits, followed by a fallible read of its durable application result.
- [Sales ingestion](../src/lib/sales-ingestion.ts), line 898: use the previous
  applied snapshot; lines 946–949: thrown consumption becomes `failed`; lines
  964–968: inventory application and terminal sales completion are separate.
- [D1 sales store](../src/lib/d1-sales-event-store.ts), lines 240–244: supersede
  failed predecessors; lines 458–467: previous consumption requires sales state
  and attempt outcome `applied`; lines 477 onward: interrupted lease recovery.
- [0010 receipt trigger](../drizzle/0010_aromatic_the_initiative.sql), around lines
  178–184: inserting a newer receipt can also supersede failed predecessors.
  Fixing only `claim()` misses this path.
- [Consumption contract](../src/lib/inventory-consumption-contract.ts),
  [sales decision](decisions/0003-m4-sales-ingestion.md),
  [quantity/recipe decision](decisions/0002-m3-quantity-and-recipe-model.md), and
  [A2/A4/B4 integration review](A2_A4_B4_INTEGRATION_REVIEW.md).
- [Clover local harness](../tests/clover-b6-local.mjs),
  [D1 consumption tests](../tests/inventory-consumption-d1.mjs),
  [sales ingestion tests](../tests/sales-ingestion-contract.mjs), and
  [store contract tests](../tests/sales-event-store-contract.mjs).

**Failure and impact:** A one-item sale deducts stock, but its result read fails
after commit. Sales marks it failed. A later revision adds another item, supersedes
the failed predecessor and consumes both items because its applied-sales lookup
ignores the first durable inventory application. Inventory is understated, and
audit rows can look internally consistent despite duplicate consumption.

**Observed evidence:** `syncClover` with the real store/port produced cup stock
**10 → 9 → 7**, where **8** was correct. The first event became `failed`, then
`superseded`; the new event became `applied`. Durable inventory applications
contained one and two consumed lines. Foreign-key validation passed. No recovery
invocation was needed. A crash-after-commit/explicit-lease-recovery variant also
reproduced the defect.

**Deterministic reproduction:**

1. Start a fresh fixture from `clover-b6-local.mjs`: raw cup balance `10`, active
   immutable recipe consuming one cup, item mapping, fictional encrypted Clover
   connection and sync state. Use its fake Orders responses and sandbox/test gates.
2. For one paid one-line order, instrument the D1 statement wrapper to throw once
   on the **post-commit** `SELECT request_fingerprint,result_json FROM
   inventory_consumption_applications`. The same lookup happens before consumption;
   match the target application and allow the initial lookup. In the review's
   fresh fixture, the second matching lookup was the post-commit read.
3. First sync fails, but the cup balance is `9` and its application row exists;
   sales state is `failed` with `inventory_unavailable`.
4. Remove the injected fault. Return the same order with a later `modifiedTime`
   (the review used +1,000 ms), keeping its original line and adding a new stable
   line ID. Keep both revisions inside the scanned time range.
5. Run sync again. Current code saves a two-line application and balance `7`;
   assert the fixed behavior consumes only the additional cup and leaves `8`.

**Implementation cautions and handoff:** Use the authoritative original company
and application key. Preserve original mapping/selected recipe versions and validate
durable result identity; do not invent another key or replay against arbitrary
current mappings. Keep inventory writes behind A's port. If extending its read or
fencing contract, add producer/consumer tests and document the handoff for BUG-05.

A missing application row at one read is not proof an expired worker can never
commit. The current inventory batch is not fenced by B's processing lease. Test
an old worker paused before inventory commit, lease expiry/recovery, arrival of a
new revision, then resumption of the old worker. Use a durable safe fence or hold
the uncertain outcome until it can be resolved. Do not trade double consumption
for silently skipping unconsumed items. If a SQL trigger changes, use a new
migration rather than editing 0010.

**Acceptance criteria:**

- The lost-result/newer-revision case ends at `8`, with one physical deduction per
  sold item; repeated scans/retries do not add deductions or duplicate movements.
- Crash after commit, same-key retry, no-commit failure, late old-worker completion,
  and successive positive revisions have deterministic outcome tests.
- Genuine corrections, refunds, cancellations, mapping holds, count cutoffs,
  company/provider lineage isolation and immutable history remain correct.
- Publish the safe reconciliation/recovery contract and failure policy required
  by BUG-05; preserve the supplier and native-sync runtime gates.

**Focused check:** `pnpm test:focused sales-ingestion-contract
sales-event-store-contract inventory-consumption-d1 clover-b6-local b4-sales-inventory`.

**Closure record:** Pending — fixing commit, fault-injection regressions,
contracts/migrations, verification, repair limits, rollback and BUG-05 handoff.

### BUG-02 agent prompt

```text
Implement BUG-02 only from docs/CORRECTNESS_SECURITY_FIX_CHECKLIST.md.
Workstream/checklist context: B5 / M4 outcome recovery, B7 / M5, A2 boundary.
Read AGENTS.md, current status, the AI playbook, relevant roadmap/contracts,
and this document's shared rules and BUG-02 packet. Record HEAD/branch/status,
preserve existing work and use an isolated worktree/branch for concurrent work.

First add the real D1 store/inventory plus mocked-Clover regression: fail the
postcommit inventory result read, then ingest a newer revision. Fix the 10→9→7
double deduction so only the additional line is consumed and final stock is 8.
Trace both receipt triggers and claim-time supersession. Reconcile authoritative
durable outcomes under the original company/application identity, preserve
historical mappings/versions, and keep inventory writes behind the A2 boundary.
Cover an expired old worker resuming after recovery/new-revision arrival; a
missing inventory application row alone is not proof the old worker cannot commit.

Publish a tested safe recovery/fencing handoff for BUG-05, coordinate shared
files/contracts, and use additive migrations only. Do not implement BUG-05's
runtime endpoint/poll wiring or silently repair historical stock in this task.
Run focused and required isolated local checks, inspect the complete diff, and
update only BUG-02's checkbox/closure evidence once acceptance is proved.
No deployment, push, live integration, remote-data change or purchasing enablement.
```

## BUG-03 — Duplicate polling hides unapplied sales from readiness

- [ ] **BUG-03 fixed locally** — unresolved applications cannot be presented as
  current sales health or pass the durable replenishment source guard.

**Severity and confidence:** High. Confirmed failed-event path using real D1
services and mocked Clover; no native provider behavior was verified. Context:
B7 / M5 health with its A8 / M7 consumer.

**Relevant files and contract:**

- [Clover sync](../src/lib/clover-sync.ts), lines 40–45: process only newly created
  receipts; lines 26 and 81: clear errors and record checkpoint/success.
- [Readiness reader](../src/lib/d1-replenishment-sales-readiness.ts), lines 61–65:
  count only `held` events.
- [Durable Clover guard](../src/lib/d1-replenishment-clover-source.ts), lines
  33–36: block only `held` events. Review its consumers in
  [proposal origins](../src/lib/d1-replenishment-proposal-origins.ts) and
  [proposal lifecycle](../src/lib/d1-replenishment-lifecycle.ts).
- [Review snapshot validation](../src/lib/replenishment-proposal.ts),
  [fake supplier consumer](../src/lib/c4-fake-supplier-consumer.ts), and
  [Clover review UI](../src/components/workspace/a8-review-preview.tsx).
- [A8 readiness evidence](M7_A8_SALES_READINESS_EVIDENCE.md),
  [durable safety contract](M7_A8_DURABLE_CLOVER_SAFETY_EVIDENCE.md), and
  [freshness policy](decisions/0004-m7-development-sales-freshness.md).
- [Clover harness](../tests/clover-b6-local.mjs),
  [readiness tests](../tests/a8-sales-readiness-d1.mjs), and
  [durable contract tests](../tests/a8-clover-review-contract.mjs).

**Failure and impact:** A transient inventory error prevents a paid sale's
application. The next successful duplicate scan does not retry or inspect the
failed receipt. It clears the prior error and advances freshness. Readiness then
reports current stock inputs while that deduction is missing, allowing a durable
review proposal from inaccurate inventory. Supplier submission is still disabled.

**Observed evidence:** First scan left `failed/inventory_unavailable` and cup stock
`10`, expected `9`. Second scan returned `created=0`, `duplicates=1`, `held=0` and
advanced the checkpoint. The event stayed failed. `D1ReplenishmentSalesReadiness`
returned `status='current'`, `heldEventCount=0`, `reasons=[]`;
`cloverSourceGuard` evaluated to `1`.

**Deterministic reproduction:**

1. Use a fresh real D1-backed fixture and fake Orders responses as in BUG-02.
2. Throw once during the inventory port's initial durable-application lookup,
   **before any inventory commit**. Allow sales completion/error bookkeeping to
   succeed. First sync must leave a failed receipt and unchanged stock `10`.
3. Remove the fault and poll the identical paid order/revision. Current code counts
   a duplicate, skips processing and records a successful fresh checkpoint.
4. Read readiness using the correct server-derived actor, company, enabled test
   sync policy and ten-minute freshness limit. Evaluate the actual durable SQL guard.
   The health clock must be at or after scan completion; an earlier fixture clock
   can report `invalid_sync_state` and mask this failure.
5. Assert the fixed reader reports an unresolved application and the guard rejects
   saving/editing from that source. If the chosen policy safely resolves it, prove
   the application first, stock `9`, and only then permit current health.

**Implementation cautions:** Fix both descriptive health and the atomic predicate
used at proposal creation/edit; UI wording or a reader-only fix is insufficient.
Assess `received`, `processing` and unresolved identity conflicts too: their
omission is visible in code but was not separately reproduced in the review.
Define which terminal/dismissed/superseded outcomes are intentionally resolved.
Preserve company/provider binding and avoid leaking references to employees.
Do not auto-retry ambiguous failures without BUG-02's safe outcome guarantees.

If expanding readiness fields/reasons, update producers, snapshot validators,
handoff validators, UI and their consumer tests together. Preserve decoding of
existing immutable v1/v2 proposal snapshots; use compatible additions or explicit
versioning. Keep the accepted ten-minute development freshness policy unchanged.

**Acceptance criteria:**

- The demonstrated failed receipt remains visible after a duplicate scan and
  cannot pass the source guard merely because polling succeeded.
- Relevant unresolved states are covered; another company's events cannot block
  or leak into this company's readiness. Genuine applied duplicates stay healthy.
- Test a failure/state change between readiness reading and proposal insertion/edit
  to prove the write-time guard, including appropriate proposal invalidation.
- Existing proposal history/contracts, privacy, freshness and purchasing gates remain
  compatible. Any automatic recovery relies on the tested BUG-02 handoff.

**Focused check:** `pnpm test:focused clover-b6-local a8-sales-readiness-d1
a8-clover-review-contract a8-sale-to-proposal-d1 c4-a7-supplier-handoff m2-security`.

**Closure record:** Pending — fixing commit, unresolved-state policy, contract
compatibility, regressions, verification, rollback and producer/consumer handoff.

### BUG-03 agent prompt

```text
Implement BUG-03 only from docs/CORRECTNESS_SECURITY_FIX_CHECKLIST.md.
Workstream/checklist context: B7 / M5 sales health with A8 / M7 consumer safety.
Read AGENTS.md, current status, the AI playbook, relevant roadmap/contracts,
and this document's shared rules and BUG-03 packet. Record HEAD/branch/status,
preserve work, and use an isolated worktree/branch for concurrent edits.

Reproduce a precommit inventory failure followed by a successful duplicate poll
using real D1 services and mocked Clover. Prevent unapplied receipts from
appearing current or passing durable proposal insert/edit guards. Define and test
the unresolved-state policy, including write-time races, company isolation and
genuine applied duplicates. Preserve existing immutable proposal v1/v2 decoding,
privacy and the accepted ten-minute freshness policy. Update producer/consumer
validators together if the health contract changes.

Coordinate clover-sync.ts with BUG-02/05. Do not implement unrelated recovery,
blind retries or a scheduler; use BUG-02's tested handoff if recovery is necessary.
Run focused and required isolated local checks, self-review the diff, and update
only BUG-03's checkbox/closure evidence after acceptance. No deployment, push,
live provider calls, remote-data changes or runtime purchasing/sync enablement.
```

## BUG-04 — Measurement changes reinterpret planning quantities

- [ ] **BUG-04 fixed locally** — a measurement or custom-factor change preserves
  planning quantities' physical meaning or holds suggestions for explicit review.

**Severity and confidence:** Medium. Confirmed saved-record and recommendation
defect. Exact stock is correct; supplier submission remains blocked. Context:
A5 / M3 compatibility and purchasing suggestions.

**Relevant files and contract:**

- [Inventory management](../src/lib/d1-inventory-management.ts), lines 291–295:
  overwrite the compatibility unit and convert stock/pack fields, leaving other
  dimensional settings untouched. Inspect `configureInternal`, `legacyNumber`
  and persisted previous unit/configuration versions.
- [Recommendation](../src/lib/inventory.ts), lines 12–18: interpret the unchanged
  target/usage/safety/capacity numbers in the new measurement.
- [Exact inventory page](../src/components/workspace/exact-inventory-panel.tsx),
  lines 48 and 67: calculate compatibility plans and stage suggested quantities.
  Also inspect [stock entry](../src/components/workspace/stock-entry.tsx) and
  [purchasing checks](../src/lib/purchasing-engine.ts), which use the same records.
- [Exact quantity helpers](../src/lib/inventory-quantities.ts),
  [package helpers](../src/lib/stock-pack-quantities.ts), and
  [durable M7 reader](../src/lib/d1-replenishment-review.ts).
- [M3 model](decisions/0002-m3-quantity-and-recipe-model.md),
  [M3 evidence](M3_LOCAL_EVIDENCE.md), [package contract](W2_PACK_UNIT_USABILITY.md),
  [management tests](../tests/inventory-management-contract.mjs) and
  [package tests](../tests/stock-pack-units.mjs).

**Failure and impact:** Changing mL to L correctly turns 900 mL stock into 0.9 L
and a 1,000 mL pack into 1 L, but retains `targetStock=2000`, `dailyUse=100`,
`safety=200`, `capacity=5000`. The UI now labels those numbers in L and can stage
materially wrong prepared-order quantities. Durable M7 rejects stale
configuration-bound settings separately; that does not protect this caller.

**Observed evidence and reproduction:**

1. Use the real management/all-migrations harness with a fixed clock. Configure
   milk in mL with opening stock 900 and purchase amount 1,000 through the service.
   Then populate the isolated compatibility fixture's `InventoryRecord.settings`
   with target 2,000, daily use 100, safety 200, capacity 5,000 and no shelf-life cap.
   Keep the JSON record version equal to `inventory.version` and the count fresh.
   These planning fields are fixture data, not `configureExact` request fields;
   the strict configuration API does not accept them.
2. Read the actual saved compatibility record. `recommendation()` suggests two packs.
3. Reconfigure only the measurement to L, retaining the same physical purchase pack
   (`purchaseAmount='1'` in L) and no additional opening count.
4. Read the saved record and call the real recommendation again. Current code
   preserves the planning numbers and produces `wantedPacks=2000`, `packs=999`.
   The canonical balance is unchanged.
5. The fixed code must retain two physical packs, or explicitly hold the plan for
   review with no staged quantity. Validate the actual UI/staging consumer too.

**Implementation cautions:** Convert all dimensional planning fields using the
previous persisted unit version and exact factors, not its label or today's latest
custom definition. A changed custom factor can alter meaning with the same unit ID
and label. Package-size-only changes must not rescale targets or usage. Preserve
null/absent targets, null capacity and explicit zero values. Unknown legacy
classification has no safe inferred conversion; hold it for review instead.

Respect supported precision/bounds and do not round unsafe values into valid
recommendations. Preserve canonical stock, incoming, estimated usage, count cutoffs,
immutable history and receipt replay. Define how already-affected records are
identified/held or repaired from trustworthy history; do not silently guess their
original planning intent or rewrite historical events. Coordinate this shared
module/test merge with BUG-06.

**Acceptance criteria:**

- mL↔L, g↔kg and changed custom-factor cases retain physical planning meaning or
  clearly block/stage no suggestion pending review.
- Target, daily use, safety, capacity, null/zero values, unknown classification
  and package-only edits are covered.
- Exact/compatibility projections remain coherent, configuration retries do not
  rescale twice, and M7's separate configuration-staleness behavior is preserved.
- Existing-record handling and rollback/forward repair are documented, with no
  automatic correction of unverifiable quantities.

**Focused check:** `pnpm test:focused inventory-management-contract inventory-sales
inventory-quantities stock-pack-units stock-entry purchasing-safety replenishment-review-d1`.

**Closure record:** Pending — fixing commit, conversion/review policy, regression
results, existing-record handling, contracts/migrations, verification and rollback.

### BUG-04 agent prompt

```text
Implement BUG-04 only from docs/CORRECTNESS_SECURITY_FIX_CHECKLIST.md.
Workstream/checklist context: A5 / M3 compatibility and purchasing suggestions.
Read AGENTS.md, current status, the AI playbook, the M3 unit decision/relevant
roadmap, and this document's shared rules and BUG-04 packet. Record HEAD/status,
preserve work and use a separate worktree/branch. Coordinate the shared inventory
management module/tests with BUG-06 and serialize their merges.

Reproduce the mL→L 2-to-999-pack defect using the actual saved compatibility
record and real recommendation function with a fixed clock. Preserve physical
meaning across known same-dimension/custom-factor changes, or clearly block
unsafe suggestions until review. Cover target, usage, safety, capacity, null/zero
values, unknown classification, package-only changes and historical custom units.
Prove the exact UI cannot stage an unsafe recommendation. Preserve canonical
balances/history, receipt replay and M7 config-staleness controls. Document safe
handling of already-affected records without guessing or changing real data.

Run focused and required isolated local checks, inspect the full diff, and update
only BUG-04's checkbox/closure evidence once acceptance is proved. Do not fix
other entries, rewrite used migrations, deploy, push, contact live integrations,
alter remote data or enable purchasing.
```

## BUG-05 — Expired processing events have no runtime recovery path

- [ ] **BUG-05 fixed locally** — expired processing is recoverable through a
  bounded, authorized, audited runtime path using BUG-02's safe outcome handling.

**Severity and confidence:** Medium. Confirmed missing runtime caller and
state-machine blockage. Context: B5 / M4 recovery entrypoint, B7 / M5 polling.

**Dependency:** Consume and test BUG-02's safe durable-outcome/recovery handoff
before enabling recovery at runtime. Diagnosis/tests can start earlier.

**Relevant files and contract:**

- [Service recovery method](../src/lib/sales-ingestion.ts), lines 987–989;
  retry near line 995 requires `failed`, not `processing`.
- [D1 store](../src/lib/d1-sales-event-store.ts), lines 247–251: any processing
  predecessor blocks a new claim without checking expiry; recovery near line 477.
- [Review API](../src/app/api/sales/events/route.ts), mutation union and lines
  51–54: retry/replay actions do not recover processing.
- [Review UI](../src/components/workspace/sales-exceptions.tsx), line 28: controls
  exist for failed/held states, not expired processing.
- [Runtime factory/local ingress](../src/lib/d1-sales-runtime.ts),
  [Clover polling](../src/lib/clover-sync.ts) and
  [Clover webhook](../src/app/api/clover/webhook/route.ts).
- [M4 decision](decisions/0003-m4-sales-ingestion.md),
  [B5 evidence](M4_B5_LOCAL_EVIDENCE.md),
  [service tests](../tests/sales-ingestion-contract.mjs) and
  [store tests](../tests/sales-event-store-contract.mjs).

**Failure and impact:** A Worker stops after claiming an event. Its durable state
remains `processing` after lease expiry. Duplicate delivery is skipped. Newer
revisions in the same order lineage cannot be claimed, and the manager cannot
retry it through existing actions. A newer revision can also stall polling progress.

**Evidence and reproduction:**

1. Search `src` and `scripts` for `recoverExpiredLeases(` and `recoverExpired(`.
   At the review baseline there are definitions, but no runtime caller; existing
   tests invoke recovery directly.
2. In an isolated real-store fixture, claim an event and simulate Worker termination
   before terminal completion, leaving its processing attempt persisted.
3. Move the fixture clock beyond the stored lease expiry. Through the selected
   actual runtime entrypoint, redeliver the original receipt and a newer revision.
   Current code does not recover the original and blocks the new claim.
4. Demonstrate that current retry/replay actions cannot recover this state. Then
   test the chosen fix through its API/polling entrypoint rather than invoking a
   library-only helper and declaring runtime recovery complete.

**Implementation cautions:** Add a bounded recovery integration or authorized
owner/manager action; do not provision a scheduler, introduce uncontrolled retries,
or unlock pending outcomes without reconciliation. Preserve authorization before
recovery reads/writes and company/provider scope. Use the agreed role policy and
test anonymous, wrong-company and forbidden-role cases for a new route action.
Lease fencing must handle the old worker resuming; do not assume expiry terminates
it. Audit recovery once, expose actionable status, and keep ambiguous results held
until safe resolution. Do not introduce recovery writes into GET health reads,
which promise read-only behavior, or perform an unbounded sweep inside a webhook.
Coordinate `clover-sync.ts`/sales-store changes with BUG-02/03.

**Acceptance criteria:**

- A served local API or actual polling-entrypoint regression recovers an expired
  processing event safely; an unexpired active attempt is not stolen.
- Before-commit and after-commit interruptions, late old-worker resumption,
  duplicate recovery and concurrent recovery are safe under BUG-02's contract.
- The new path is bounded, auditable, isolated and permitted only to the intended
  actor; managers can understand the remaining held/failed/recovered status.
- Newer revisions can proceed when safe, with correct inventory and no duplicate
  application. Existing runtime gates remain unchanged; no real schedule is added.

**Focused check:** `pnpm test:focused sales-ingestion-contract
sales-event-store-contract b4-sales-inventory clover-b6-local m2-security` plus
the new runtime/served regression.

**Closure record:** Pending — fixing commit, BUG-02 handoff consumed, runtime
entrypoint/role policy, bounded recovery tests, verification, rollback and limits.

### BUG-05 agent prompt

```text
Implement BUG-05 only from docs/CORRECTNESS_SECURITY_FIX_CHECKLIST.md.
Workstream/checklist context: B5 / M4 runtime recovery, B7 / M5 consumer.
Read AGENTS.md, current status, the AI playbook, relevant roadmap/contracts,
and this document's shared rules and BUG-05 packet. Record HEAD/branch/status,
preserve work, and use an isolated worktree/branch for concurrent work.

First reproduce an expired processing event through an actual runtime caller.
Use BUG-02's merged/tested safe reconciliation and fencing handoff before wiring
runtime recovery. If that handoff is not available, continue diagnosis and write
an integration/test plan, but leave dependent implementation and the checkbox
open; do not recreate inventory logic or simply call unsafe current recovery.
Add a bounded, authorized and audited recovery path without provisioning a
scheduler. Cover unexpired leases, before/after-commit interruptions, late old
workers, duplicates, concurrent recovery, role/company denial and newer revisions.
Prove the runtime API/polling path works; a direct helper-only test is insufficient.

Coordinate shared B files with BUG-02/03. Run focused and required isolated local
checks, self-review the full diff, and update only BUG-05's checkbox/closure record
when acceptance is proved. No deployment, push, live integration calls, remote
data changes or runtime sync/purchasing enablement. Report the consumed handoff.
```

## BUG-06 — Conflicting concurrent physical counts both report success

- [ ] **BUG-06 fixed locally** — a conflicting reuse of a count identity is
  rejected after a race, while identical replay confirms the original count once.

**Severity and confidence:** Medium. Confirmed real management-service race in
in-memory SQLite. No double deduction occurs, but a count that was never saved can
be acknowledged as successful. Context: A5 / M3 physical-count idempotency.

**Relevant files and contract:**

- [Count implementation](../src/lib/d1-inventory-management.ts), lines 403–409:
  compare an existing receipt before the batch; line 427: after losing the insert,
  check only that a receipt exists. Movement receipt validation nearby is a useful
  comparison, not a reason for unrelated refactoring.
- [Count contract](../src/lib/inventory-management-contract.ts),
  [inventory API](../src/app/api/inventory/route.ts), `countExact` branch,
  [stock entry](../src/components/workspace/stock-entry.tsx), and
  [package-count adapter](../src/lib/d1-stock-pack.ts).
- [M3 physical-count/compatibility decision](decisions/0002-m3-quantity-and-recipe-model.md),
  [M3 evidence](M3_LOCAL_EVIDENCE.md), [package receipt contract](W2_PACK_UNIT_USABILITY.md).
- [Management harness](../tests/inventory-management-contract.mjs),
  [package tests](../tests/stock-pack-units.mjs), and
  [stock entry tests](../tests/stock-entry.mjs).

**Failure and impact:** Two requests have the same operation ID, product, expected
version, occurrence time, actor and note, but request 900 mL and 800 mL. Both see no
receipt before either commits. The first count wins. The second's conditional
insert writes nothing, but accepts the first receipt's existence and reports success
for its own unsaved quantity. The stock/audit contains the first quantity.

**Observed evidence:** Both promises fulfilled; only the 900 mL count was persisted.

**Deterministic reproduction:**

1. Extend the in-memory management harness. Configure milk with a known opening
   count and choose a later valid occurrence for both requests.
2. Add test-only deferred gates around the target count's `Database.batch()`,
   **before `BEGIN IMMEDIATE`**, after each service call has constructed its count
   statements and completed its initial receipt/balance/chronology reads.
3. Start request A (900 mL); await its gate. Start B (800 mL), with all other identity
   fields equal; await B's gate. Both have now observed no receipt.
4. Release A and await completion. Release B. Current code fulfills both.
5. Require B to reject with `operation_conflict` (HTTP 409 through the API), while
   one reconciliation, one count event and one balance/version change remain.

**Implementation cautions:** Validate the actual committed receipt after every
batch independently of `meta.changes`. Test accurate, zero and misleading D1
acknowledgments; do not treat change counts as identity proof. Cover altered amount,
unit, time, actor, note and product. Inspect expected-version identity against the
count event's `balance_version_before` rather than silently weakening it.

Preserve uncertain-save replay after later movements/configuration changes and
historical custom-unit versions. Do not reinterpret a saved receipt using today's
custom conversion. The package path has its own immutable
`inventory_setup_operations` fingerprint and canonical-input mode; preserve that
earlier receipt check. Maintain normalized timestamps, entered-value semantics,
chronology, exact/legacy atomicity, cutoff and authorization. Coordinate the shared
module/tests with BUG-04, then rebase and reverify the second merge.

**Acceptance criteria:**

- The deterministic conflicting same-ID loser returns `operation_conflict` and
  changes no balance, cutoff, usage, projection or count receipt.
- Concurrent identical payloads both confirm the same saved result without another
  stock write; different operation IDs sharing an expected version still conflict.
- Lost-response confirmation, later-history replay, package count fingerprints,
  custom units and misleading acknowledgment metadata remain safe.
- The API returns the correct conflict and preserves anonymous/wrong-company/
  forbidden-role denial. Historical reconciliations remain immutable.

**Focused check:** `pnpm test:focused inventory-management-contract
stock-pack-units stock-entry waste-recording m2-security`.

**Closure record:** Pending — fixing commit, deterministic race/metadata regressions,
receipt compatibility, API outcome, verification, rollback and BUG-04 integration.

### BUG-06 agent prompt

```text
Implement BUG-06 only from docs/CORRECTNESS_SECURITY_FIX_CHECKLIST.md.
Workstream/checklist context: A5 / M3 count idempotency.
Read AGENTS.md, current status, the AI playbook, M3 physical-count contract and
relevant roadmap, and this document's shared rules and BUG-06 packet. Record
HEAD/branch/status, preserve existing work, and use a separate worktree/branch.
Coordinate inventory-management module/tests with BUG-04 and serialize merges.

Add a deterministic two-request regression gated before count transactions:
same operation identity, 900 mL wins, 800 mL must return operation_conflict.
Validate the committed receipt independently of D1 change-count metadata.
Preserve identical concurrent replay, lost-response confirmation after later
history/configuration changes, historical custom units, package fingerprints,
count chronology, exact/legacy atomicity and server authorization. Verify the
HTTP conflict and no-write loser. Do not add sleeps, rewrite past counts or
expand into unrelated movement refactoring.

Run focused and required isolated local checks, inspect the full diff, and update
only BUG-06's checkbox/closure evidence after its acceptance criteria are proved.
No deployment, push, live integrations, remote-data changes or purchasing enablement.
```

## Review evidence and remaining limits

At the recorded review baseline, these checks passed:

- `pnpm test` — all 41 existing suites.
- `pnpm typecheck --incremental false`.
- `pnpm db:check` — 23 ordered migrations matched schema metadata and applied to
  fresh in-memory SQLite; focused migration tests also exercised populated upgrades.
- `git diff --check`; final HEAD and the original working-tree state were unchanged.
- Focused auth, inventory/waste, sales/Clover and replenishment/purchasing suites,
  plus the isolated reproductions described above.

These passes did not contain the new regression cases and do not close any entry.
Build, served/hosted checks, actual provider token revocation, real D1 concurrency,
native Clover pagination/redelivery/revocation and excluded order cases, Stripe,
supplier services and provisioned scheduling were not independently reproduced.
The status document says the 0022 guard repair is local only; this review did not
verify the hosted migration ledger. Supplier submission was unconditionally
blocked in the inspected engine and local tests; saved automatic mode was reduced
to review mode. Preserve those controls while fixing the six defects.

The following are additional coverage gaps or hypotheses, **not confirmed bug
entries and not part of any fixing agent's scope**: connector private-network/SSRF
reachability, response-memory exhaustion (the connector's size check follows full
body reading), post-commit audit failure behavior, dependency advisories, abuse/rate
limits and wider operational recovery. Investigate separately rather than marking
them fixed on the basis of these six patches.
