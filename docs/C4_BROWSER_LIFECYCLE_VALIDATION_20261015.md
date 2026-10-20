# C4 hardened lifecycle real-Chrome validation — 2026-10-15

This bounded C4 task validates the [consolidated lifecycle diagnostics](C4_BROWSER_LIFECYCLE_SOURCE_REVIEW_20261015.md)
once with disposable local Chrome profiles. The existing nine historical processes
under leader 30474, all worker locks, retained failures and consumed attempts are
protected. **C4/M8 remain open; historical causes remain unresolved.**

The [fixed entrypoint](../scripts/po-cart-browser-lifecycle-validation-check.mjs)
accepts no arguments, filters, overrides or resume. Its private root is
`.sites-runtime/po-cart-workers/browser-lifecycle-validation-task-20261015/` and
its policy is `isolated-browser-lifecycle-validation-20261015`. Exclusive,
synchronized report and invocation creation permanently refuse concurrency and
reuse without changing existing evidence. The [shared controller](../scripts/po-cart-worker/shutdown-matrix-controller.mjs)
retains the original matrix entrypoint's binding and consumption policy.

The [independent fixed-root adapter](../scripts/po-cart-worker/browser-lifecycle-validation-audit.py)
checks invocation policy, source and ordered cases, independently recomputes the
frozen source, verifies successful preparation logs, and requires collected
version-two lifecycle evidence. Simulated artifacts cannot satisfy this gate.
Binding failures cannot bypass the shared independent final audits.

The twelve sequential cases use SIGTERM and protocol close, each with 0, 10 and
50 ms first-observation delays, repeated twice. Each case owns a fresh profile
and uses the pinned executable, inline pages, minimal environment and deny-all
proxy. Existing admission, stabilization, deadlines, signal verification and
bounded disposal remain unchanged. Stop at the first incomplete case; no settling
policy, retry, replacement, restart or second invocation is allowed.

Preparation captures inherited source and before-images, protected evidence,
carts, every database row, budgets, consumed records, worker-lock bytes/metadata,
historical process identities and complete profile fingerprints. Preparation
filenames are separate from invocation-time exclusive audit outputs. Historical
activity is allowed only for this isolated diagnostic; inactive-profile drift
fails preservation and no idle baseline is established.

Eight focused suites cover both fixed bindings and the seven existing lifecycle,
observation, matrix, profile and verification suites. Only a successful frozen
`pnpm typecheck`, `pnpm test` and `pnpm build` preparation permits consumption.
Database migrations and application HTTP smoke are outside this diagnostic.

Only twelve completed cases with passing independent audits qualify as
**reproduced** (at least two matching cases), **observed once** (one), or
**not reproduced within this matrix** (zero). An incomplete case or failed audit
means **blocked**. Primary diagnostic failures retain exact case/evidence
references separately from audit failures.

The single invocation **passed**, classified **reproduced**: twelve attempted,
twelve completed, zero unstarted, four signature cases and zero audit failures.
It ran on October 15 at 23:43:03–23:45:13 America/New_York
(`2026-10-16T03:43:03Z`–`03:45:13Z`). No retry, replacement or second invocation
followed. The invocation is permanently consumed.

| Shutdown method | First-observation delay | Completed repetitions | Signature cases |
| --- | --- | --- | --- |
| SIGTERM | 0 ms | 2/2 | 0 |
| SIGTERM | 10 ms | 2/2 | 0 |
| SIGTERM | 50 ms | 2/2 | 0 |
| Protocol close | 0 ms | 2/2 | 2 |
| Protocol close | 10 ms | 2/2 | 2 |
| Protocol close | 50 ms | 2/2 | 0 |

Each signature is retained in `cases/<case-id>/observation-0002.json` under the
fixed root: `protocol-0-1`, `protocol-0-2`, `protocol-10-1` and `protocol-10-2`.
The corresponding signature PIDs are respectively 79005/79006/79007/79029,
79299/79300/79301, 79597/79598/79599 and 79894. The bracketed observations retain
unchanged start times, changed command text and missing profile references,
followed by absence from metadata and the final process read. Zombie/executable
text transitions are retained separately as findings. This reproduces the
defined diagnostic signature in this matrix; it establishes no PID reuse or
historical failure cause. The zero-signature cases do not establish absence of
other shutdown transitions.

All twelve cases have collected version-two evidence, nine admitted baseline
members, independently verified ordered startup decisions and stabilization,
strict baseline verification and complete shutdown absence. All child exits
were observed, all proxies closed and all fixture processes are independently
absent. The six SIGTERM signals targeted only individually verified owned
leaders; protocol cases used CDP close. Bounded disposal required no additional
signals or escalation. Proxy evidence retains 179 denied background requests.
Profiles and case evidence remain retained privately.

The unchanged-source preparation completed once:

| Command | Result |
| --- | --- |
| `pnpm test po-cart-browser-lifecycle-validation po-cart-browser-lifecycle po-cart-shutdown-matrix po-cart-shutdown-observation po-cart-legacy-verification po-cart-remaining-profile-cleanup po-cart-legacy-profile-cleanup po-cart-profile-preflight` | Passed, 8 focused suites |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, 103 suites |
| `pnpm build` | Passed |
| `node scripts/po-cart-browser-lifecycle-validation-check.mjs` | Passed, exit 0; one real invocation |

The inherited 573-file snapshot matched
`8b01ad3749f921bdf5c687818dede72297adc174c821bbe5f8747a7977c23f8c`.
The frozen implementation has **577 source files**, SHA-256
`8191b4c7d1dc1540d5db85d2dc65c70222fc51c1f8554fd675ede1da601c7894`.
Successful log hashes and source-before/source-after hashes are bound in
`pipeline.json`; the independent adapter recomputed the source and checked the
logs. Before-image comparison verifies unchanged trial, admission, deadlines,
signal/disposal primitives and legacy consumption; controller extraction changes
only binding parameters and the additional collected-evidence gate.

Independent preservation passed for **20,249 protected evidence files**, **494
carts**, **37,368 business rows** across six databases, all prior consumed
records and all **46 worker locks**, including lock bytes and metadata. Every
database delta is empty: zero additions, business changes, bookkeeping changes
or ordinary smoke rows. Budgets are unchanged; reserved exposure remains
**$0.921518**. The nine historical identities under 30474 and the existing live
lock reference are unchanged; PID 4303 is absent and was never targeted. Seven
historical profile fingerprint differences were confined to the profile already
active at the initial snapshot; no inactive profile changed. No strict historical
profile stability or idle baseline is claimed.

Exact run references under the fixed private root are `report.json`,
`diagnosis.json`, `verification-summary.json`, `matrix-binding-audit.json`,
`preservation.json`, `concurrent-active-profile-drift.json`, `case-findings.json`
and `execution.log`. There is no new primary failure and `auditFailures` is
empty. Earlier failure reports remain unchanged, including the consumed
shutdown-observation diagnosis/matrix reports, both maintenance reports, and the
remaining-profile refusal at
`.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015/observations/000006.json`
(SHA-256 `5d0f4586905663ec15f5437a8c8c286212fc6fd555ba53888382141797fe8f9e`).
The original seventeen-file display-on preservation failure remains failed.

`pnpm db:check`, `pnpm db:migrate:local` and `pnpm test:local` were not run:
there is no schema/API/application-workflow change and they were excluded from
this diagnostic. No complete six-command local pipeline is claimed. Diff,
relative-link and checkbox-preservation checks passed. Offline fault scenarios
prove only their simulated behavior; the separate twelve-case result above is
the collected real-Chrome evidence.

There are no public API, schema, migration or downstream domain-contract changes.
Historical cleanup, lock archival, an idle baseline, the full acceptance gate,
paid inference, supplier access, purchases, deployment and power-setting changes
are excluded. Rollback restores only this task's source/documentation from its
before-images; it must retain consumption records, profiles and failure evidence.
The next unblocked C4 slice is separately scoped read-only review of historical
verification/disposition using this evidence. Historical resources still block
the later idle gate; this pass authorizes no cleanup, acceptance gate or paid run.
