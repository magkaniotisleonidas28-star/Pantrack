# AI-driven development playbook

This playbook turns the milestone roadmap into small, verifiable tasks for
Codex or another coding agent. It supplements, rather than replaces,
[the milestone roadmap](PANTRACK_MILESTONES.md),
[current status](CURRENT_STATUS.md), and
[contributor requirements](../CONTRIBUTING.md).

The workflow follows the official
[OpenAI Codex best-practices guidance](https://developers.openai.com/es-419/guides/best-practices):
give the agent a clear objective, relevant context, constraints, and observable
completion conditions; store durable repository rules in `AGENTS.md`; require
tests and diff review; use one coherent unit of work per chat; and isolate
concurrent edits in worktrees.

## 1. Sources of truth and context order

Do not paste the whole repository or the entire roadmap into every chat. Give an
agent the smallest authoritative context set that resolves the task:

1. Root [`AGENTS.md`](../AGENTS.md) for durable execution and safety rules.
2. [`CURRENT_STATUS.md`](CURRENT_STATUS.md) for what is actually complete and
   what is externally blocked.
3. Roadmap sections 3 and 5.1, the assigned A/B/C checklist item, and the exact
   milestone's tasks and acceptance criteria.
4. The relevant decision record or setup/integration contract. For example, M2
   uses `M2_SETUP.md` and `decisions/0001-m2-authentication.md`; Clover and
   supplier work uses only the matching guide under `public/`.
5. The implementation files and focused tests discovered by inspecting imports,
   routes, schemas, and existing test names.

Historical evidence files are evidence, not current instructions. Mocked tests
are not proof of sandbox or pilot acceptance. When documents conflict, stop and
identify the exact conflict; do not silently choose the more convenient rule.

## 2. One task packet per AI session

Create a task packet before implementation. A packet should normally fit in one
reviewable commit and take one agent from inspection through verification.

```text
Workstream/checklist step: [A2, B4, C1, ...]
Milestone: [M# and name]

Objective:
[One observable behavior or artifact to produce.]

Relevant context:
- [Exact roadmap/decision sections]
- [Likely source and test files]
- [Existing contract or behavior that must remain compatible]

Constraints:
- [Security, tenant isolation, file ownership, migration, external-effect rules]
- [Explicit non-goals]

Done when:
- [Behavioral acceptance test]
- [Required commands and expected result]
- [Documentation/evidence/handoff update]

Dependencies and external actions:
- [Decision, credential, sandbox, reviewer, or prior contract]
- [What can still be completed locally if that dependency is unavailable]
```

Good packets produce one contract, migration slice, service behavior, UI state,
test family, or acceptance report. Split a packet when it spans two workstreams,
mixes schema and unrelated UI cleanup, requires unrelated external accounts, or
cannot be reviewed without several independent rollback plans.

## 3. Choose the session type

Name the session type in the prompt so the agent does not infer broader authority.

| Session | Allowed outcome | Not authorized |
|---|---|---|
| **Explore/design** | Read code, trace behavior, write a decision or contract proposal, identify tests and migrations | Implement the proposal, modify external services, or mark acceptance complete |
| **Implement** | Change one bounded local behavior and its tests/docs | Deploy, use live data, perform external acceptance, or broaden the milestone |
| **Review** | Inspect a diff/commit for correctness, security, isolation, regressions, and missing evidence | Quietly fix findings unless the task explicitly includes fixes |
| **Integrate** | Rebase a known contract consumer, resolve scoped conflicts, and run the integration checks | Redesign either workstream contract during conflict resolution |
| **Sandbox acceptance** | Exercise an explicitly approved development/sandbox account and record sanitized evidence | Production credentials, customer data, pilot actions, purchases, or deployment |
| **Pilot operation** | Perform only the named, approved M11 runbook action with manager authorization | Expanding products, limits, accounts, automation, or observation scope |

Use a new chat for a new task packet. Continue the same chat for fixes or review
feedback on that packet. Fork only when the work genuinely splits into separate
outcomes. After long pauses or context compaction, re-check the branch, status,
diff, current status document, and assigned checklist item before editing.

## 4. AI implementation loop

Every implementation task uses this sequence:

1. **Orient:** Read the task packet and sources of truth; inspect `git status`,
   the relevant code path, schema, and focused tests.
2. **Baseline:** Run the cheapest existing focused test that covers the area. If
   it already fails, record that separately instead of attributing it to the new
   change.
3. **Specify:** Add or refine the contract and an acceptance-oriented failing
   test. For defects, reproduce the defect first when practical.
4. **Implement:** Make the smallest coherent change. Preserve provider-neutral
   boundaries and keep incomplete external paths disabled/review-only.
5. **Verify narrowly:** Run focused tests after each meaningful change.
6. **Verify broadly:** Run the risk-based checks below and any milestone-specific
   acceptance tests.
7. **Self-review:** Inspect the entire diff for scope, secrets, tenant leaks,
   client-trusted authorization, duplicate side effects, unsafe retries, float or
   money errors, missing failure states, and unsupported completion claims.
8. **Handoff:** Write the structured result in section 7 and update evidence only
   to the level actually proved.

An agent may make a documented low-risk assumption when it does not expand scope
or external impact. It must stop for a product choice, destructive data action,
production change, real purchase, unavailable secret/account, disputed shared
contract, or ambiguous company/security boundary.

## 5. Risk-based verification matrix

| Change type | Minimum iteration checks | Required before merge |
|---|---|---|
| Documentation only | `git diff --check`; inspect rendered structure and changed links | Re-read changed instructions for conflicts and false status claims |
| Pure calculation or parser | Focused unit/contract test | `pnpm typecheck`, focused tests, full `pnpm test`, diff review |
| API/authorization | Focused API test including anonymous/wrong-company/role cases | Typecheck, full tests, build, security/tenant review |
| UI behavior | Focused component/API tests and typecheck | Full tests, build, loading/empty/success/failure/held states, visual walkthrough or explicit QA blocker |
| Schema/migration | Focused compatibility test and `pnpm db:check` | SQL/snapshot/journal review, fresh apply, existing-data behavior, full tests/build, forward-repair plan |
| External adapter | Contract tests with deterministic fake responses | Full local pipeline plus sanitized sandbox evidence for acceptance; timeout/unknown/replay/reconciliation cases |
| Scheduler or purchasing | Duplicate/concurrency/lease/budget/failure tests | Full local pipeline, operations visibility, alert/recovery proof, and the roadmap's explicit external authorization |

The full local pipeline is documented in `AGENTS.md` and
[`LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md). If a required check cannot run,
report it as **not run** with the reason and leave the corresponding criterion
blocked. Never substitute “the code looks correct” for execution evidence.

## 6. Concurrent AI work

One human owns each A/B/C workstream even when that person uses several AI
sessions. The person doing the work is responsible for scope, self-review,
verification, credentials, external actions, and the final handoff. The merge
owner coordinates shared files and the final merge without serving as a second
development reviewer.

- Use one worktree and short-lived branch per task packet. Never run two agents
  that can edit the same files in the same worktree.
- Start contract producers before consumers. A consumer uses the committed fake
  or fixture until the real contract lands; it does not duplicate the producer's
  logic.
- Treat `src/db/schema.ts`, generated migration metadata, shared workspace shells,
  package/CI configuration, and status/roadmap documents as merge-owner files.
- Serialize schema-bearing merges. Generate the final migration only after
  rebasing on current `main`; never reserve numbers or hand-merge snapshots.
- Rebase immediately after a depended-on contract lands, then rerun contract
  tests before resolving unrelated conflicts.
- Do not ask an AI agent to resolve a semantic contract disagreement. Record
  the agreed interface in the shared contract and tests before integration.
- The implementer self-reviews the full diff and records the required risk-based
  checks. A fresh AI review session may help find defects but is not a required
  second sign-off. External actions still need their explicit authorizations.

Suggested task-branch names include `workstream-a/a2-consumption-contract`,
`workstream-b/b3-event-storage`, and `workstream-c/c4-supplier-fakes`.

## 7. Required AI handoff

End every implementation or integration session with this compact record:

```text
Task: [workstream step and title]
Outcome: complete locally | partially complete | blocked

Changed:
- [Behavior and important files]

Contracts/migrations:
- [New or changed contract, migration, compatibility and rollback notes]

Verification:
- PASS — [exact command/test and relevant result]
- FAIL — [exact command/test and failure]
- NOT RUN — [required check and reason]

Acceptance evidence:
- Proved locally: [criteria]
- Still external/blocked: [criteria and exact unblocker]

Review notes:
- [Security, tenant isolation, external effects, risks, assumptions]

Next unblocked task:
- [Checklist ID and required handoff]
```

Do not use “done,” “working,” “connected,” or “production ready” without naming
the evidence level: local fake, local D1, hosted CI, sandbox, pilot, or production.

## 8. Review prompts

The implementer may use a fresh session for additional risk review after
completing the required self-review.

```text
Read AGENTS.md, docs/CURRENT_STATUS.md, docs/AI_DEVELOPMENT.md, and the relevant
milestone/checklist item. Review the current diff against [base commit/branch].
Do not edit files.

Prioritize concrete defects: company isolation, authorization, secrets, data
compatibility, decimal/money correctness, idempotency, concurrent duplicates,
unknown external outcomes, unsafe retries, missing audit history, and false
acceptance claims. For each finding, cite the file/line, describe the failure
scenario, and name the missing test or evidence. If no findings remain, list
residual risks and checks not independently reproduced.
```

For schema changes, explicitly ask the reviewer to trace migration order,
existing-record compatibility, constraints/triggers, rollback/forward repair,
and schema/snapshot/journal agreement. For external adapters, explicitly trace
credentials, company/provider binding, idempotency identity, timeout ambiguity,
status reconciliation, redaction, and disconnect behavior.

## 9. Improve the AI workflow deliberately

- Keep `AGENTS.md` short and durable. Put examples, templates, and explanations
  here instead of expanding the automatically loaded context.
- After the same agent failure occurs twice, record a brief retrospective:
  failure, root cause, detection, and the smallest preventive instruction or
  test. Add only the durable prevention rule to `AGENTS.md`.
- Convert a workflow into a shared skill only after it is repeated, stable, and
  has clear inputs/outputs. Keep architecture and product decisions in repository
  documents, not hidden inside a personal skill or chat history.
- Automate a recurring AI task only after the manual task is reliable. Good
  future candidates are CI-failure triage, milestone evidence checks, migration
  review, and release-note drafting; production changes and purchase actions are
  not unattended AI tasks.
- Treat chat summaries as navigation aids, not sources of truth. Decisions,
  contracts, status, and evidence must be committed to the repository.
