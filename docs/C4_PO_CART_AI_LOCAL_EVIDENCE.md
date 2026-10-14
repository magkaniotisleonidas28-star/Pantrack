# C4 local real-AI fictional supplier evidence

Initial evidence: 2026-10-11 (paid evaluation timestamps below are UTC on
2026-10-12). Latest offline follow-up: 2026-10-13.
Original workstream **C4** outcome: complete the 12-case real-model evaluation against
the local fictional supplier using the existing durable browser protocol.
**Acceptance is incomplete: the previous task's paid retry passed six cases and
stopped at compact/normal after an add-response timeout (40/72 requests). The
follow-up investigations passed 60 initial and 24 targeted fresh offline jobs
without reproducing or explaining that interruption. The subsequently authorized
instrumented matrix stopped at catalog Metadata after 14 completed requests; its
allowance is consumed. A subsequent offline audit added verdict diagnostics.
The latest slice replaces only Metadata system instructions and verifies request
construction and conservative behavior offline; it authorizes no paid requests.**
C4/M8 remain unchecked. Hosting, real suppliers, checkout, purchases, deployment
and inventory writes remain disabled.

## Behavior and contracts

The ordinary browser worker remains deterministic. Only the dedicated evaluation
command supplies the internal `CartReader`; the normal worker rejects `--ai`.
There are no public API, application schema, manager UI or A/B contract changes.

Stagehand 4.1.0 extracts visible catalog text and cart table rows with strict
structured schemas and screenshots disabled. It never receives trusted data
attributes or the expected cart. Product extraction includes every matching SKU,
including conflicting variants and unavailable products. Pantrack independently
requires one available product with the exact SKU, pack and price before using
its numeric catalog index. Ambiguity, substitution, missing/invalid output and
disagreement hold the job. Model output never supplies an executable selector.

AI reads the baseline and final cart independently. Pantrack rereads the trusted
cart after inference and requires complete agreement, including unrelated rows,
duplicates, quantities and prices. A cart change during product inference is
checked before beginning an attempt. Existing server final verification remains
mandatory; successful line results alone cannot publish readiness.

Discovery completes before `beginAttempt`. After acknowledgment, fresh ownership
and deterministic product checks precede at most one browser addition. No model
call occurs between the grant and browser write. Fenced leases, heartbeats,
account/profile locks, fsynced journals, permanent HTTP UUIDs, cancellation and
reconciliation remain authoritative. Stop/heartbeat failure aborts inference;
revocation, source changes, cancellation and lease loss prevent subsequent browser
additions and commits. Restart may safely continue never-attempted work; attempted
work cannot reuse a grant and remains subject to existing reconciliation.

## Model, privacy and cumulative budget

The reviewed default is `gpt-5.4-mini-2026-03-17`, `reasoning.effort=none`, strict
structured output and `store=false`. On 2026-10-11, the
[official model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
confirmed the snapshot, structured output, reasoning `none`, and standard rates
of $0.75/M input and $4.50/M output tokens. Recheck those rates before executing
real evaluation; a changed model/rate requires a reviewed budget-bound update.

The [Stagehand model callback](https://docs.stagehand.dev/v4/configuration/models)
runs in Node. Pantrack controls every provider request using bounded native fetch,
without provider retries. Installed 4.1.0 makes two distinct callbacks per read:
`Extraction`, then completion `Metadata`. Each has its own reservation; unexpected
or duplicate callbacks are rejected, and incomplete metadata holds the job.
No retries, remote result cache, screenshots or SDK logging are enabled.

The first paid run stopped on `AI_INCOMPLETE_EXTRACTION`. Inspection of the
installed SDK showed that its Metadata prompt contains the instruction and
extracted JSON but omits the visible DOM used for Extraction. The focused fix
supplies that same original visible source to Metadata as untrusted data, without
a new page read, trusted attributes, expected values or another model call.
Incomplete Metadata still holds the job. Offline assertions verify both source
grounding and incomplete-result holds at baseline, product and final phases.

Stagehand 4.1.0 has no telemetry-off flag. Its trace exporter is configured to a
denied local `/v1/traces` path. The independent browser proxy rejects export without
reading/logging spans. In-memory SDK spans still exist; no trace payload reaches
an external collector or the storefront. The browser allowlist also denies
external navigation, redirects, tunnels and checkout. Chromium's background time
query is disabled while preserving the pinned SDK's other disabled features.
Chromium can still attempt Google startup connections despite its background
networking switches (an [upstream issue](https://github.com/microsoft/playwright/issues/42910)).
The proxy denies these, including CONNECT tunnels, before any external contact.
Reports separately count blocked Chromium background attempts and intercepted
external page requests; page requests must be zero. This does not claim Chromium
makes no internal startup attempts. Private journal evidence records numeric
network counters, never URLs or bodies.

Both the older preview evaluator and new worker evaluator use
`.sites-runtime/cart-ai-budget/ledger.json`. Under a process lock, the ledger
imports the high-water reservation/call counts from the older
`.sites-runtime/cart-ai-evaluation/state.json`, serializes reservations and fsyncs
them before requests. Existing reservations are never reset or refunded.
Completed calls record token usage and still retain the full reservation. Failed,
interrupted, refused and uncertain requests retain their conservative allowance.
An orphaned lock reclamation guard requires local review, rather than deletion.

Each provider request has at most 24,000 conservative input tokens (UTF-8 bytes
plus 4,096 envelope overhead), 2,048 output tokens, a 45-second provider timeout,
and a 64 KiB response envelope limit. Insufficient remaining cumulative $5 budget
prevents the request. Offline tests use separate explicitly injected mock ledgers;
they neither reset nor consume the real evaluation ledger.

Only fictional catalog/cart text reaches the model. Extraction rejects sign-in
pages and non-catalog/cart URLs. Cookies, session tokens, profiles, worker credentials,
provider errors and keys are excluded from model inputs and reports. Private keys
load from ignored `.dev.vars.cart` with mode 0600 on POSIX; Windows uses the current
account ACL. No configuration values are printed.

## Commands and acceptance

Run the offline checks without a provider key:

```sh
pnpm test:focused cart-preview po-cart-ai-reader po-cart-browser-network
pnpm cart:browser-worker:check:ai
```

For real acceptance, privately configure `OPENAI_API_KEY` in `.dev.vars.cart`.
Model/rate settings may be omitted to use the reviewed defaults above. Optional
`PANTRACK_CART_MANUAL_SECONDS` records a separately measured human walkthrough.
Never paste a key into chat or a command argument. After rechecking pricing, start
the isolated served local application. Evaluation now additionally requires a
separate private one-matrix allowance with recorded offline gate evidence; the
current follow-up allowance is consumed. The command refuses to create fixtures
or make model calls when readiness, full-matrix budget or allowance checks fail:

```sh
pnpm dev:cart-browser-worker
pnpm cart:browser-worker:evaluate
```

The dedicated evaluator seeds reviewed fictional POs through served application
endpoints, runs the durable worker and independently inspects fixture contents.
It requires exact ready carts for normal/malicious content and unchanged baseline
carts with review holds for changed price, unavailable, wrong pack and ambiguity,
across both layouts. Every case must include completed real Extraction/Metadata
requests; deterministic stops, missing calls and partial runs cannot pass.
Duplicate additions, external page requests, checkout submissions or changed
inventory/reservations fail acceptance. Any incomplete case stops the run.
Evaluation credentials are revoked afterward; unresolved holds remain intact.

Private per-run reports under `.sites-runtime/po-cart-workers/ai-evaluation/`
record model/SDK versions, case results, elapsed times, interventions, additions,
network counts, usage and conservative cumulative cost. Actual billing and human
timing comparison remain pending when unavailable. Reports never claim hosted or
supplier compatibility. Missing configuration exits before any provider request
and writes a report explicitly labeled pending.

## Verification from the previous task

- After the Metadata fix, the complete local pipeline passed: `pnpm typecheck`,
  `pnpm test` (**78 suites**), `pnpm db:check` (**34 migrations**, fresh database),
  `pnpm build`, `pnpm db:migrate:local` (none pending), `pnpm test:local`.
- `pnpm test:focused cart-preview po-cart-ai-reader po-cart-browser-network`
  passed all three suites before and after the fix. They cover strict agreement,
  missing/wrong/invalid/refused output, bounded input/output, timeout, exhaustion,
  retained failed reservations, legacy high-water import, six-process concurrent
  reservations and restart retention.
- The original **47-case** `pnpm cart:browser-worker:check:ai` passed before the
  fix. All **50 expanded cases** passed afterward across sequential runs: cases
  0–23 in a batch, then 24–49 individually after a browser interruption. Coverage
  includes the 12-case matrix; cancellation, revocation,
  lease loss and source invalidation during each inference phase; invalid,
  missing, incorrect and refused output; timeout, exhausted budget, changing
  carts, incomplete Metadata and restart recovery. Restart never reused an
  addition grant. A single uninterrupted 50-case pass is not claimed.
- After the fix, `pnpm cart:browser-worker:check:ai:http` passed the served local
  D1 **12-case matrix with 72 completed mocked requests**, independently exact
  ready carts and unchanged held carts. Report
  `af704cb8-ea2d-4d71-9b57-1c02a4c5e87d` records zero external page requests and
  checkout submissions, with `acceptanceComplete=false`. Private journals record
  **346 blocked Chromium background attempts** and **86 blocked telemetry
  attempts**, separately. All 24 credentials returned 401 after revocation.
- After the fix, existing regressions passed sequentially:
  `pnpm cart:browser-worker:check` (**36 cases**),
  `pnpm cart:browser-worker:check:http` (**7 cases**), `pnpm cart:check`
  (**16 cases**), `pnpm cart:manager:check` (**8 cases**),
  `pnpm cart:browser-session:check` (**10 cases**),
  `pnpm cart:reconciliation:check` (**6 cases**), and
  `pnpm cart:manager:check:launcher` (graceful shutdown/restart, retained cart,
  journal and worker identity, with no repeated addition).
- Preflight also encountered closed-browser errors and add-response timeouts in
  mocked and deterministic runs. A fresh preview and sequential reruns passed;
  no timeout or safety check was weakened. The browser failure remains material
  because it recurred during the paid retry below.
- After that paid failure, `pnpm cart:browser-worker:check:ai --case 6` passed
  compact/normal with mocked inference. Twelve isolated compact additions also
  passed earlier. These checks did not reproduce or resolve the intermittent
  failure and cannot replace real acceptance.
- Source files remained stable during served checks and the paid retry. SHA-256
  of the sorted 384 source/script/test/package files (path, NUL, contents):
  `9adf098375596414e73e9b0942aa83c32b76012adbc174eb3a234e391646ed57`.
- No application migration, public API, manager UI or downstream contract was
  changed. `git diff --check`, all **181 relative links** in the four changed
  documents, full diff review and a private-key scan of all **23 reviewable files**
  passed. The source snapshot still matched after cleanup.

## Real-model results and retained evidence

The owner enabled API billing and saved the key privately. Mode 0600, ignored
status, pinned configuration and both budget locations were checked without
displaying the key. Both budget files were initially absent. The reviewed maximum
reservation for 72 requests was **$1.959552**, below the remaining allowance at
each paid launch. Rates were rechecked against the official documentation before
execution. Runtime versions: **Stagehand 4.1.0, playwright-core 1.61.1, Node
22.23.2**, pinned model and reasoning `none` as above.

The initial paid attempt (`7fd28376-4050-4edd-949f-eb21436f39d6`) stopped on the
first rows/normal case after six completed requests and one correct coffee
addition. Metadata reported incomplete extraction. Its partial cart, review hold,
journal and **$0.087770** reservation remain intact. It used **3,966 input / 280
output tokens** in **17.863 seconds**, with one recorded intervention. Its private
journal records 36 blocked Chromium background attempts and 13 blocked telemetry
attempts. There were no incorrect ready results, external page requests, checkout
submissions or inventory/reservation changes.

After the focused fix and offline verification, a premature application-startup
launch (`2851b1ca-8591-44c1-825d-c99a4e06cffa`) exited before fixture creation:
**zero model requests and zero additional reservations**. This startup error is
retained separately. The one paid retry started only after application readiness,
source stability and the remaining **$4.912230** allowance were verified.

Paid retry report: `230da30a-3f99-40af-9613-9b567cae9f49`, UTC
**2026-10-12 02:03:31–02:05:36**. Every reported request completed, but the matrix
stopped on its first failed case. Remaining compact cases were not executed.

| Layout | Scenario | Result / independently inspected cart | Completed requests | Addition markers | Seconds | Recorded interventions |
|---|---|---|---:|---:|---:|---:|
| rows | normal | PASS — ready, exact cart, three additions | 10 | 3 | 29.070 | 0 |
| rows | malicious | PASS — ready, exact cart, three additions | 10 | 3 | 26.664 | 0 |
| rows | price_changed | PASS — review hold, unchanged baseline | 4 | 0 | 10.903 | 1 |
| rows | unavailable | PASS — review hold, unchanged baseline | 4 | 0 | 10.961 | 1 |
| rows | wrong_pack | PASS — review hold, unchanged baseline | 4 | 0 | 10.624 | 1 |
| rows | ambiguous | PASS — review hold, unchanged baseline | 4 | 0 | 10.874 | 1 |
| compact | normal | INCOMPLETE — add-response timeout; baseline unchanged | 4 | 1 | 26.142 | 1 |
| compact | malicious | Not run | 0 | — | — | — |
| compact | price_changed | Not run | 0 | — | — | — |
| compact | unavailable | Not run | 0 | — | — | — |
| compact | wrong_pack | Not run | 0 | — | — | — |
| compact | ambiguous | Not run | 0 | — | — | — |

The intervention counter records a caught worker stop, including the expected
review holds; it does not mean a human manually repaired a cart. In compact/normal,
`page.waitForResponse` timed out after 10 seconds at the addition stage. A durable
attempt marker existed, but independent fixture inspection found only the original
baseline and no actual addition. The attempt outcome remains unknown to the
worker and the review hold is preserved. No inference or addition was retried.
The root cause of this intermittent browser failure is unresolved.

For all seven attempted retry cases, independent checks found **zero incorrect
ready results, duplicate additions, external page requests, checkout submissions,
inventory changes or reservation changes**. Private journals separately record
**228 blocked Chromium background attempts** and **92 blocked telemetry attempts**.
The proxy denied these before external contact; network tests also proved denied
requests never reached the test destination. This is partial local evidence only.

| Accounting | Completed requests | Input tokens | Output tokens | Retained reservation |
|---|---:|---:|---:|---:|
| Initial paid attempt | 6 | 3,966 | 280 | $0.087770 |
| Single paid retry | 40 | 38,693 | 1,756 | $0.617186 |
| Cumulative | **46** | **42,659** | **2,036** | **$0.704956** |

All reservations remain in the shared ledger; the cap is still **$5**, leaving
**$4.295044** reserved-budget allowance. Recorded usage priced at standard uncached
rates is **$0.04115625**, separate from conservative reservations and an invoice.
The owner reports the available balance changed from **$5 to $4.96**, consistent
at displayed-cent precision. Itemized billing/time-range reconciliation remains
pending. Human timing comparison remains optional and unavailable.

Private reports and journals remain under
`.sites-runtime/po-cart-workers/ai-evaluation/`; preflight, consumed retry allowance
and cleanup records are under `ai-acceptance-preflight-20261011/`. Evaluation
credentials were revoked, including all 14 from the paid retry. Final local cleanup
confirmed **142 task fixture credentials return 401**. Task-owned previews and
crash-test browsers were stopped; pre-existing unrelated browser processes were
left alone. The private API key remains ignored with mode 0600.

## Bounded browser diagnosis follow-up

The implementation plan authorized one additional paid matrix only after a
supported causal fix and the complete offline gate. Investigation was bounded
to 60 fresh normal jobs; attempted historical additions were never resumed.
**The 60-job limit was reached without a reproduction or causal explanation.
Investigation stopped and paid execution was blocked.** No click, response wait,
timeout, verification, grant or uncertainty rule was changed as a speculative fix.
The old held carts, journals, ownership and reservations remain intact.

Opt-in diagnostics cover launch/connection/closure, heartbeats/ownership, form
validity and focus, click completion, add requests/responses, proxy forwarding
and independent cart observations. Files use mode 0600 and a 500-event bound.
Event categories and numeric/boolean fields are allowlisted; no credentials,
cookies, session URLs, request bodies, screenshots or raw DOM are recorded.
Ordinary workers can opt in with `--diagnostic <new-private-file>`.

Command: `pnpm cart:browser-worker:check:reliability`. Private report:
`.sites-runtime/po-cart-workers/reliability-085c998f-0239-4f1c-9469-348cbe9afa5f/report.json`.
Five jobs passed per layout/reader/delay combination. Stagehand provider replies
were delayed by 0, 750 or 1,500 ms; deterministic workers have no model requests,
so their application GET replies used the same delays. Ordering repeatedly crossed
from rows to compact. These are diagnostic passes, not post-fix acceptance evidence.

| Reader | Delay (ms) | Passed jobs | Median end-to-end seconds | Range (seconds) |
| --- | ---: | ---: | ---: | ---: |
| Deterministic | 0 | 10 | 12.657 | 12.527–13.357 |
| Deterministic | 750 | 10 | 23.589 | 23.477–23.697 |
| Deterministic | 1,500 | 10 | 34.125 | 34.030–34.252 |
| Mocked Stagehand | 0 | 10 | 17.769 | 17.683–17.825 |
| Mocked Stagehand | 750 | 10 | 25.443 | 25.364–25.550 |
| Mocked Stagehand | 1,500 | 10 | 32.989 | 32.915–33.462 |

Independent fixture inspection proved **60 exact ready carts, 180 additions,
300 completed mocked model requests, and 40 successful heartbeats**. There were
zero duplicate additions, incorrect ready carts, external page requests, checkout
submissions or inventory/reservation changes. The proxy separately recorded
**2,344 blocked Chromium startup attempts** and **756 blocked telemetry attempts**.
All 120 newly created diagnostic credentials returned 401 after revocation.
All carts, journals and diagnostic files were retained; source stayed stable over
the entire investigation (387 files, SHA-256
`3d331b5d60b3aa456acd596e7e73ee3dc4129f5055c5aa65918a84a1aeaad60d`).

Evaluator preflight now checks both loopback services and at least **$1.959552**
remaining conservative allowance before fixture creation. A private single-matrix
allowance is consumed durably before any paid request; repeated consumption fails.
Completion requires exactly 12 passing cases and 72 completed requests from that
new run. Telemetry attempts now appear separately in its report. The follow-up's
allowance is retained as `blocked_offline`, unconsumed, at
`.sites-runtime/po-cart-workers/ai-reliability-acceptance-20261011/allowance.json`.
Do not authorize it until the causal fix, 30 consecutive post-fix jobs, two complete
served mocked matrices, uninterrupted 50-case AI safety run, full pipeline and all
seven sequential browser regressions have evidence. This task did not open that gate.

Crash tests now capture the exact profile and direct child PID while their worker
is alive, prove that its live orphan blocks profile reuse, and recheck process
identity before terminating only that captured browser. The browser-worker check
retains its test journals instead of deleting failure evidence. The three older
orphaned cart browsers observed before this task were left untouched; no new crash
orphan remained after the checks.

Current follow-up checks:

- PASS — `pnpm test:focused cart-preview po-cart-ai-reader po-cart-browser-network`
  (baseline, three suites).
- PASS — `pnpm test:focused po-cart-evaluation-preflight`: missing app/storefront
  and insufficient budget create zero fixtures and make zero provider requests;
  exact budget boundary, consumed allowance reuse and diagnostic privacy/bounds.
- PASS — `pnpm cart:browser-worker:check` (36 cases), including actual orphan
  protection and scoped cleanup, interrupted responses, authority loss and replay.
- PASS — `pnpm cart:browser-worker:check:failures` (four deliberately injected
  faults): missing add request, saved addition with interrupted response, browser
  disconnection and authority loss. Restart never added again or published ready.
  Private evidence: `faults-d8639aa3-a6bc-46ff-a20a-509aeaf10d5c`.
- PASS — `pnpm cart:browser-session:check --cases 8,9` (separate-process graceful
  close and real orphan/profile protection with scoped cleanup).
- PASS — the full local pipeline: `pnpm typecheck`, `pnpm test` (**79 suites**),
  `pnpm db:check` (**34 migrations**, fresh database), `pnpm build`,
  `pnpm db:migrate:local` (none pending), and `pnpm test:local`. Private command
  output is retained in `ai-reliability-acceptance-20261011/pipeline.log`.
- PASS — actual served application/storefront readiness using an explicitly
  separate mock budget ledger, without fixtures or provider calls.
- PASS — final full diff review, `git diff --check`, all **181 relative links**
  in four changed documents, and a private-key scan of all **32 reviewable files**.
  Private model configuration remains ignored with mode 0600.
- PASS — cleanup rechecked all **124 new served fixture credentials** (120
  diagnostic and four supervised-browser credentials): each returned 401. The
  task-owned preview was stopped and ports 5181/5182 are free. Evidence is retained
  in `ai-reliability-acceptance-20261011/cleanup.json`; final source snapshot covers
  391 files, SHA-256
  `ba4b97527e20680ed575e3c90c6b80640ab186b45a0a53cc8164ae6d6b0c12c6`.
- NOT RUN — causal regression (no mechanism identified), 30 post-fix acceptance
  jobs, two new complete served mocked matrices, uninterrupted 50-case AI safety
  run, and the remaining full sequential served/preview/manager/session/
  reconciliation/launcher gate. The plan's unresolved-cause stop condition blocked
  progression; earlier task evidence is not substituted for these checks.
- NOT RUN — new paid matrix. New real token usage, reservations and billing are
  **zero**. The real ledger remains byte-identical at **$0.704956**, leaving
  **$4.295044**; the legacy budget location remains absent. Earlier usage and the
  owner's $0.04 billing comparison above remain unchanged. Official snapshot,
  reasoning `none`, and $0.75/M input / $4.50/M output pricing were rechecked against
  the linked model documentation; recheck again immediately before any later run.

## Targeted timing and observer investigation — 2026-10-13

The next plan allowed one conditional paid matrix only after a supported causal
fix and every existing offline gate. It first required 24 fresh served jobs,
with up to 12 matched confirmation jobs only if a failure or concrete lead emerged.
**All 24 passed with valid timing; no failure or causal lead emerged. Investigation
stopped, all 12 confirmation slots remained unused, and no paid requests followed.**
The historical missing-add-response mechanism remains unknown. These passes do
not rule out timing or observer effects outside the tested conditions.

The internal worker now accepts diagnostics `off`, `passive` or `form`. Existing
defaults remain: no file means off; requesting a file retains the form probe.
Passive mode records existing lifecycle/network events without a diagnostic page
evaluation, validation call, focus change or DOM listener. Off/passive error
handling also avoids the old diagnostic DOM evaluation after a failed click.
The original 60-job command is preserved; future `--acceptance` runs now disable
diagnostics to match the paid worker. No browser timeout, click, grant, exact-cart,
authority or uncertainty rule was changed as a purported causal fix.

Command: `pnpm cart:browser-worker:check:reliability --targeted`. Evidence is under
`.sites-runtime/po-cart-workers/targeted-task-20261013/`, including `report.json`,
the fsynced `investigation.json` attempt slots, `before.json` budget fingerprints
and private copies of the 32 inherited reviewable files under `before/`.
The command refuses a repeated initial run before creating another fixture;
`rerun-guard.json` records the successful negative check. This prevents an
automatic repeat of the bounded investigation or any attempted addition.

The 24 cases crossed both layouts, deterministic/mocked Stagehand readers, three
diagnostic modes and two timing profiles. All delays were test-only and occurred
before mock reservations or before invoking the first `beginAttempt`, outside
the worker's HTTP timeout and before any addition grant:

- Uneven profile: the first four Stagehand callback starts used offsets
  **0, 812, 8,027 and 8,906 ms** from the first callback, derived from the retained
  paid failure's callback-start spacing. Mock responses took 250 ms. First
  `beginAttempt` invocation targeted 16 seconds after claim in both reader modes.
- Heartbeat profile: first `beginAttempt` invocation targeted **19.75 or 20.25
  seconds** after claim, six cases on each side; mock replies took 250 ms.
  Actual heartbeat observations were recorded independently of diagnostic mode.

All first-begin targets were met within **1 ms**, uneven callback targets within
**2 ms**, and first heartbeats occurred at **20.000–20.004 seconds**. These are
harness observations, not reconstructed historical model response durations or
proof of the exact original click time. Source was stable across all 24 cases:
394 files, SHA-256
`98d973845dbfa7c88a7272313c92e2fa85c52686e267d518c67273cd7090a3b5`.

| Diagnostics | Exact ready carts | Additions | Completed mocked requests |
| --- | ---: | ---: | ---: |
| Off | 8 | 24 | 40 |
| Passive | 8 | 24 | 40 |
| Existing form probe | 8 | 24 | 40 |
| Total | **24** | **72** | **120** |

Independent fixture inspection proved zero duplicate additions, incorrect ready
carts, external page requests, checkout submissions or inventory/reservation
changes. All 24 jobs observed a heartbeat. The proxy separately counted **1,079
blocked Chromium startup attempts** and **327 blocked telemetry attempts**.
Diagnostics-off cases created no diagnostic file; passive cases recorded no form
probe events. Diagnostic files remain mode 0600 and bounded to 500 events, with
the existing category/number/boolean allowlist and no sensitive page or HTTP data.

Current-task verification:

- PASS — baseline `pnpm test:focused po-cart-evaluation-preflight po-cart-browser-network`.
- PASS — `pnpm test:focused po-cart-targeted-reliability po-cart-evaluation-preflight po-cart-browser-network`:
  balanced matrix, historical callback schedule, heartbeat boundaries, missed-target
  rejection, abort handling, diagnostic defaults and existing privacy/preflight guards.
  The first timing-helper test caught a missing abort check; it was corrected
  before any targeted browser job was started.
- PASS — the full local pipeline: `pnpm typecheck`, `pnpm test` (**80 suites**),
  `pnpm db:check` (**34 migrations**, fresh database), `pnpm build`,
  `pnpm db:migrate:local` (none pending), and `pnpm test:local`.
- PASS — `pnpm cart:browser-worker:check:failures --diagnostic-mode passive`
  (four injected faults): missing request, interrupted saved addition, browser
  disconnection and authority loss. Restart repeated no addition and never
  published readiness. Spies verified no diagnostic DOM evaluation on failure.
- PASS — `pnpm cart:browser-worker:check:failures` and
  `pnpm cart:browser-worker:check:failures --diagnostic-mode off`, four faults each.
  Together with passive mode, all **12 injected-failure checks** passed without
  duplicate additions or incorrect readiness after restart. Private output is
  retained in `targeted-task-20261013/verification.log`.
- PASS — repeated `--targeted` invocation was refused before fixture/provider
  activity; the attempt record and report stayed unchanged at 24 initial jobs.
- PASS — incremental/full diff review, `git diff --check`, **181 relative links**
  in four changed documents, private-key scan of **35 reviewable files**, and
  privacy/mode/bound checks for all **16 diagnostic files**. Compared with the
  saved task baseline, eight files were intentionally edited and three added;
  the remaining 24 inherited reviewable files were unchanged.
- PASS — all **48 new served fixture credentials** returned 401 after revocation.
  The verified task-owned preview exited cleanly and ports 5181/5182 are free.
  The three older orphaned cart browsers were left untouched; no new orphan
  remained. Private configuration is still ignored with mode 0600. Evidence and
  source/budget fingerprints remain in `targeted-task-20261013/cleanup.json`.
- NOT RUN — confirmation pairs (no lead), causal regression/fix (no mechanism),
  30 post-fix jobs, two new served mocked matrices, uninterrupted 50-case AI safety
  run, complete seven-command sequential browser gate and paid matrix. The plan's
  no-lead stop condition prevented progression; earlier evidence is not substituted.

The real budget ledger and unused paid allowance remained byte-identical to their
initial fingerprints; the legacy location remains absent. Retained reservations
are still **$0.704956**, leaving **$4.295044** under the unchanged $5 cap. New real
requests, model tokens and reservations are zero. The allowance stays
`blocked_offline`; current pricing/configuration recheck remains a prerequisite
immediately before any later authorized paid execution. No application API,
schema, migration, manager UI or downstream contract changed.

## Instrumented acceptance decision — 2026-10-13

The user explicitly replaced the historical-cause-fix prerequisite with one
instrumented real-model matrix after every fresh offline gate. The historical
timeout remains **unresolved**; the 84 earlier passing jobs do not establish a
fix. This decision supersedes the earlier stop policy, without changing its
historical evidence or granting another allowance or paid retry.

This C4 outcome adds passive diagnostics to the dedicated evaluator, leaving
ordinary workers off by default. Each case has one mode-0600 file capped at 500
events, shared by provider and browser. Fixed numeric provider phases record
reservation, request start, response status, completion, failure and abort with
elapsed times. Browser events distinguish crash/close/disconnection, catalog
readiness, filled quantity, acknowledged attempt, ownership checks, click dispatch
and add/proxy activity. No diagnostic DOM evaluation, form probe, listener
injection or artificial delay is used in passive mode. Prompts, outputs, URLs,
headers, bodies, credentials, cookies and screenshots are excluded. Setup failure
prevents fixtures and provider calls; logging failures invalidate evidence while
cleanup and uncertainty rules continue. Timeouts, exact verification, durable
grants, one click and the provider retry prohibition remain unchanged.

`pnpm cart:browser-worker:gate:ai` runs sequentially against a frozen source hash,
records private command output/report references and SHA-256 fingerprints, and
stops on the first failed gate. It requires 30 fresh normal jobs (five per layout
and delay, diagnostics off), two 12-case/72-request served mocked matrices (off
and passive with complete provider coverage), the unfiltered uninterrupted 50-case
AI safety run, all four injected faults in off/passive/form modes, the six-command
local pipeline and all seven browser regressions. It stops its own preview before
the launcher regression and rechecks readiness after restarting. Any source
change or changed evidence invalidates authorization. The existing allowance can
be authorized only from the complete report; pricing must be checked against
official documentation within five minutes of its durable consumption. The
first normal paid case is the connection check; no separate probe or retry exists.

Private task baseline: `.sites-runtime/po-cart-workers/instrumented-task-20261013/`.
Fresh frozen-source gate:
`.sites-runtime/po-cart-workers/instrumented-gate-d2810501-8226-4c9a-97ae-2fd0757f7577/report.json`.
Source: **515 files**, SHA-256
`66004925bdb9d127e0eb63dbbbad9f36b007cd822e7504c46fa5d18e009ba55a`.
All **20 offline gates passed sequentially** in **2,388.033 seconds**, with the
same source hash before and after every command. The launcher regression ran
after the task preview stopped; restart and application/storefront readiness
passed afterward. The allowance was then authorized from these reports, retaining
its original blocked record in history, and consumed durably before the paid run.

| Fresh check | Result |
| --- | --- |
| `pnpm cart:browser-worker:check:reliability --acceptance` | 30 consecutive fresh normal jobs; five per layout/delay; diagnostics off; 90 additions and 300 completed mocked requests |
| `pnpm cart:browser-worker:check:ai:http --diagnostic-mode off` | 12 passing cases, 72 completed mocked requests |
| `pnpm cart:browser-worker:check:ai:http --diagnostic-mode passive` | 12 passing cases, 72 completed mocked requests; complete provider/browser event coverage |
| `pnpm cart:browser-worker:check:ai` | All 50 cases passed in one uninterrupted run without filters |
| `pnpm cart:browser-worker:check:failures --diagnostic-mode off/passive/form` (three separate commands) | All 12 injected-failure checks passed; no repeated addition or incorrect readiness after restart |
| `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` | Complete local pipeline passed; 81 test suites; 34 migrations; none pending locally |
| Browser-worker, served browser-worker, preview, manager, browser-session, reconciliation, launcher | All seven complete regressions passed sequentially, in that order |

Private report references:

- Reliability: `reliability-aadeeb93-cbf5-4a85-a9aa-d1fadd83e8be/report.json`.
- Served off: `ai-evaluation/b19ead74-b429-49bc-b5c7-d5bf9c6a9950/report.json`.
- Served passive: `ai-evaluation/8f96edff-e4bc-448d-8793-0310920be878/report.json`.

All three paths are under `.sites-runtime/po-cart-workers/`; the gate report
contains their hashes and private command-log references. Across these 54 fresh
served jobs, independent inspection proved 38 exact ready carts, 16 baseline holds,
114 additions and 444 completed mocked requests. There were zero duplicate
additions, incorrect ready carts, external page requests, checkout submissions or
inventory/reservation changes. Separately, proxies counted **2,001 blocked
Chromium startup attempts** and **935 blocked telemetry attempts**. Reliability
median durations were 17.351, 24.912 and 32.485 seconds at 0, 750 and 1,500 ms.

Focused checks also passed for AI agreement/budgets, browser network restrictions,
preflight and provider diagnostics. Tests cover readiness, insufficient budget,
diagnostic setup and allowance failures with zero fixtures/provider requests;
stale source or altered gate references; durable single consumption; event bounds
and privacy; phase ordering; interrupted responses/aborts retaining reservations;
and logging errors allowing cleanup. Initial test-harness failures were corrected
before the source freeze or any acceptance browser job.

### Paid outcome: stopped on the second case

Immediately before execution, installed Stagehand **4.1.0**, Playwright **1.61.1**,
private configuration (mode 0600), model `gpt-5.4-mini-2026-03-17`, reasoning `none`,
and **$0.75/M input / $4.50/M output** were rechecked against
[official model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
The app/storefront were ready and the budget had **$4.295044** remaining against
the **$1.959552** conservative matrix requirement. There was no separate paid probe.

`pnpm cart:browser-worker:evaluate` ran **once** with passive diagnostics and
stopped at its first failed case. Private raw report:
`.sites-runtime/po-cart-workers/ai-evaluation/be9b3aa3-0de3-4502-8c04-a20287b7b7d2/report.json`.

| Case | Result | Requests | Additions | Duration |
| --- | --- | ---: | ---: | ---: |
| rows/normal (connection check) | Exact ready cart; complete acceptance diagnostics | 10 completed | 3 | 30.044 s |
| rows/malicious | `review_needed`; `AI_INCOMPLETE_EXTRACTION` during catalog inference; baseline unchanged | 4 completed | 0 | 10.359 s |
| Remaining ten cases | Not run after the failed case | 0 | 0 | — |

The new failure is the reader's catalog Metadata completion guard not receiving
`completed: true`. All four requests in that case completed with HTTP 200, and
there was no attempt acknowledgment, click or add request. Provider outputs were
not retained, so no claim is made about the model's reason for that verdict.
This is **not evidence explaining the historical add-response timeout**, whose
cause remains unresolved. No browser fix or timeout change is claimed.

Independent post-stop inspection confirmed the failed cart exactly matches its
saved baseline. All 14 executed provider phases have ordered reservation/start/
headers/completion events. The two used files contain 125 and 37 events, both mode
0600, with no form probes or sensitive fields. Executed-path coverage is complete;
the raw report correctly marks the failed case's required ten-request acceptance
coverage incomplete. Ten pre-created, unused diagnostic files are empty and private.
Evidence, journals, carts, ownership holds and reservations remain intact.

Total new usage: **13,827 input + 668 output = 14,495 tokens**, **14 completed
requests**, **40.534 seconds** overall. New conservative reservations are
**$0.216562**; cumulative retained reservations are **$0.921518**, leaving
**$4.078482** under the unchanged $5 cap. Standard uncached usage pricing gives an
estimate of **$0.01337625** for this run; actual billing/caching and owner billing
comparison remain unverified. Historical reservations were preserved and the
legacy budget location remains absent. The one-matrix allowance is **consumed**.
No paid retry, follow-up request, new allowance or partial-evidence substitution
was made. The required 12-case/72-request local real-AI acceptance is **not met**.

The paid run had zero duplicate additions, incorrect ready carts, external page
requests, checkout submissions or inventory/reservation changes. Proxies counted
**73 blocked Chromium startup attempts** and **38 blocked telemetry attempts**
separately. All **176** task-created or rotated served fixture credentials returned
401 after revocation. The task-owned preview stopped, ports 5181/5182 are free,
and no new browser orphan remains. Cleanup is recorded in
`instrumented-task-20261013/cleanup.json`; gate hashes still validate. Final diff,
relative-link, diagnostic privacy/mode/bound and credential-pattern reviews passed:
181 relative links, 24 evaluator diagnostic files and 39 reviewable files. Compared
with the private inherited baseline, 17 files changed and 22 remained untouched.

No public API, schema, migration, manager UI, hosting or supplier contract changed.
C4/M8 remain unchecked; hosted services, supplier access, checkout and purchasing
remain outside this authorization.

## Offline metadata contract audit — 2026-10-13

Workstream **C4**, one bounded outcome: document the completion contract, classify
private Metadata verdicts and verify conservative behavior with synthetic replies.
This does not repair extraction or improve demonstrated real-model reliability.
The last paid run retained request lifecycle counters and the rejection error,
**not model outputs or progress text**. Its rationale cannot be reconstructed,
nor can its rejected completion field now be classified as false, absent or the
wrong type. The historical add-response timeout remains unresolved.

The audit inspected installed Stagehand **4.1.0**, specifically
`dist/extension/service-worker.js` (prompt builders at lines 15861–15928,
`ExtractMetadataSchema` / `generateStructured` / `extract$1` at 16039–16104,
and snapshot extraction at 50703–50762), together with
[Pantrack's reader](../scripts/po-cart-worker/ai-reader.ts). Observations:

- The SDK captures one focused accessibility snapshot, calls `Extraction`,
  validates its structured result against the extraction schema, then calls
  `Metadata`. Screenshots are disabled here. Pantrack accepts exactly those two
  callback names in that order, with no inference retry.
- Catalog extraction requests every matching SKU, including duplicate variants
  and unavailable products, using the strict candidates schema. Cart extraction
  requests every row using the strict entries schema. Metadata's separate schema
  requires `progress` as a string and `completed` as a boolean. Pantrack passes
  each SDK JSON schema to its provider with strict structured output enabled.
- Pantrack prefixes each SDK system prompt with its untrusted-page/read-only
  instructions. The extraction user message contains the task instruction and
  `DOM:` snapshot; the task instruction itself repeats Pantrack's constraints.
  The SDK Metadata user message contains the task instruction and validated
  extracted JSON. Pantrack additionally prepends the exact original extraction
  user-message text as untrusted grounding, without rereading the page or adding
  trusted attributes, expected cart values or a new request.
- The Metadata system prompt discusses `chunksTotal > chunksSeen`. Neither
  counter is supplied by this extraction path, which calls Metadata once for the
  captured snapshot. Its schema also asks for conservative completion. These
  prompt details are observations, **not proven causes** of any paid rejection.
- Pantrack checks `completed === true` before returning Metadata to the SDK for
  schema validation. In the SDK's handler, completion otherwise controls logging
  and is removed before the public extraction result is returned. Pantrack's
  guard therefore remains necessary; independent exact product/cart agreement,
  current authorization and server final verification still decide readiness.

The new private `metadata_verdict` event is emitted immediately after Metadata
returns from the bounded provider and before that unchanged guard. Its only
payload fields are fixed numeric `phaseId` and `classification`: **0=true,
1=false, 2=missing, 3=invalid type**. Existing numeric phase IDs are reused
(unknown phases use fixed ID 10). No prompts, progress, outputs, URLs, bodies or
credentials are logged. Provider failures before returning Metadata emit no
verdict. Logging exceptions cannot bypass the guard or cleanup. The shared
0600 diagnostic file still has one 500-event cap; diagnostics off creates no file.

[Diagnostic verification](../scripts/po-cart-worker/evaluation-diagnostics.ts)
now requires exactly one verdict immediately after each completed Metadata
request, with the matching fixed phase ID and a valid classification. Missing,
duplicate, misplaced or invalid events fail verification. A diagnostic verdict
never authorizes readiness. Earlier diagnostic files and frozen-source reports
remain historical evidence for their original source; they are not rewritten to
satisfy the new verifier.

[The offline harness](../scripts/po-cart-ai-metadata-check.mjs) has no live mode:
every provider transport is explicitly mocked, uses a fictional key and an
isolated mock ledger, and Node fetch is restricted to loopback HTTP. It retains
request structures and synthetic responses only in memory while asserting
schema, instruction layering, callback order and exact snapshot grounding.
Persisted evidence consists of assertion summaries, bounded private diagnostics
and isolated fictional fixture state/journals/ledgers. An unexpected failure
stops progression and retains attempted fixtures; attempted additions are never
rerun. Missing and invalid-type fields deliberately violate the requested schema
at the mock transport boundary; they prove defensive local handling, not a
real-provider failure mode or model reliability.

### Fresh verification and retained evidence

All checks below passed in the current dirty worktree, sequentially. Both layouts
(`rows`, `compact`) and both fixture variants (`normal`, `malicious`) were used
for each completion field, targeting the first product's Metadata callback:

| Completion field | Classification | Fresh cases | Independent cart result | Additions per case | Mocked requests per case |
| --- | ---: | ---: | --- | ---: | ---: |
| `true` | 0 | 4 | Exact ready cart | 3 | 10 |
| `false` | 1 | 4 | Exact baseline, held | 0 | 4 |
| Missing | 2 | 4 | Exact baseline, held | 0 | 4 |
| String `"true"` | 3 | 4 | Exact baseline, held | 0 | 4 |

All twelve rejected cases were restarted once, with **zero additional provider
requests or additions**, unchanged exact baselines and retained holds. The 16
cases used **88 completed mocked requests** and 12 additions. Inventory,
commitments and reservations remained unchanged; external page requests and
checkout submissions were zero. No attempted addition was rerun.

| Command | Fresh result |
| --- | --- |
| `pnpm test:focused po-cart-ai-reader po-cart-provider-diagnostics po-cart-evaluation-preflight po-cart-browser-network` | Four suites passed; verdict classes and guard across baseline/product/final, no verdict on provider failure, event order/privacy, off mode, shared cap and logging-failure cleanup |
| `pnpm cart:browser-worker:check:ai:metadata` | All 16 cases and 12 rejected-case restarts passed |
| `pnpm cart:browser-worker:check:ai` | All 50 cases passed in one uninterrupted, unfiltered run |
| `pnpm cart:browser-worker:check:ai:http --diagnostic-mode passive` | All 12 served cases passed with 72 completed mocked requests, complete verdict coverage and `acceptanceComplete=false` |
| `pnpm cart:browser-worker:check:failures --diagnostic-mode passive` | All four faults passed, including restart: missing request, interrupted response, disconnected browser and authority loss |
| `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` | Complete local pipeline passed in that order: 81 suites, 34 ordered migrations/fresh database, none pending locally and served HTTP smoke checks |

Frozen source: **516 files**, SHA-256
`ff55726ba5638de0beb34c539602ae91e64e723916d8dd8c5844a6103abbaddf`.
The metadata run and each subsequent command verified that same source hash.
Documentation is excluded from the source fingerprint and was updated afterward.
Private references under `.sites-runtime/po-cart-workers/`:

- Task baseline, command logs and verification manifest:
  `metadata-task-20261013/`.
- Metadata assertions and all 16 retained fictional SQLite/cart/journal/mock-ledger
  fixtures: `ai-metadata-6b969ad2-eeb2-47ed-9d91-5e1cd5d4d5c3/report.json`.
- Served mocked matrix:
  `ai-evaluation/06244b10-b217-475c-bb70-a3b0804af9dc/report.json`.
- Passive fault evidence: `faults-4708894a-47b5-419a-8afe-956d7293cb32/`.

The 28 new metadata/served diagnostic files are mode **0600**, contain **38–128
events** each and pass privacy review. Their **80** verdicts immediately follow
the matching provider completion and contain only fixed phase/classification
fields plus the standard timestamp/event envelope. Unit checks also deliberately
exceed the shared 500-event limit and inject logging failures; the evidence
becomes unhealthy while descriptor cleanup still runs.

All **16** metadata-fixture and **24** served-fixture credentials returned 401
after explicit revocation. Retained metadata SQLite snapshots contain only revoked
worker credentials. The safety/fault checks closed their isolated in-memory
databases and HTTP servers. Existing **408 carts** and **17,652 PO rows** were
compared before/after the served run and preserved, including prior held work.
All **35** historical gate-evidence references still match their saved hashes.
Both real budget locations and the consumed allowance have unchanged SHA-256
fingerprints: cumulative reservations remain **$0.921518**, the legacy file remains
absent, and the allowance remains consumed. **Zero real provider requests** were
made. No new allowance, paid retry, migration, public API, UI, SDK version,
authorization, extraction prompt/schema/timeout or purchasing behavior changed.

Final process cleanup, relative-link and diff checks are recorded in the task's
private cleanup report. This evidence proves synthetic local handling only.

## Offline single-snapshot Metadata repair — 2026-10-13

Workstream **C4**, one bounded outcome: replace the SDK's chunk-oriented Metadata
system prompt with a static Pantrack completion check against the original
supplied snapshot, extraction instruction and extracted JSON. This is an
**offline repair candidate**, not proof of the paid rejection's cause or improved
real-model reliability. The previous paid output was not retained; its rationale
cannot be reconstructed. The historical browser timeout remains separate and
unresolved. No paid validation or new allowance is authorized.

[The reader](../scripts/po-cart-worker/ai-reader.ts) now uses the existing
untrusted-page prefix followed by Pantrack's prompt for `Metadata` only.
`Extraction` still receives the SDK's exact system prompt. Completion requires
all requested visible records, duplicates and required fields. Omissions,
inconsistencies, fabricated values and unverifiable facts require false. An empty
collection can be complete for a snapshot-supported empty cart or absent matching
SKU. Unavailable products, changed prices and conflicting variants must be
represented accurately; their presence alone does not make extraction incomplete.
Storefront text and extracted values remain untrusted data. Completion establishes
neither product acceptability, authorization nor cart readiness.

The outbound Metadata system instructions contain no SDK chunk conditions or
fabricated counters. Its two user messages remain: exact original-snapshot
grounding, then the SDK's instruction and extracted JSON. Strict schemas,
Extraction/Metadata callback order, request limits, timeouts, reservations,
diagnostics and the `completed === true` guard are unchanged. There are no
retries, extra model calls, SDK upgrades, migrations or public API/type changes.

[Callback tests](../tests/po-cart-ai-reader.mjs) now compare outbound Extraction
instructions, user messages and both schemas to the supplied callback parameters;
they compare both Metadata user messages exactly and require the Pantrack
completion rules without the old chunk conditions. One identical static Metadata
prompt is required across baseline, product and final phases and all verdicts.
Existing checks continue to reject false, missing and invalid completion values,
verify verdict ordering, and emit no verdict after provider failure. The new
contract assertions failed against the saved original prompt before the repair;
all four focused suites subsequently passed.

### Fresh verification and boundaries

After the focused checks, all browser and full-pipeline commands below ran
sequentially in the current dirty worktree against the frozen repaired source
hash. The private runner adds a provider-fetch denial guard, uses fictional
credentials and requires explicit mocked transports with isolated ledgers.
An unexpected failure stops browser progression. Attempted additions are never
repeated; fixtures, journals and historical holds remain retained.

| Command | Result |
| --- | --- |
| `pnpm test:focused po-cart-ai-reader po-cart-provider-diagnostics po-cart-evaluation-preflight po-cart-browser-network` | Four suites passed before and after the repair; the added prompt assertions separately failed as expected against the original prompt |
| `pnpm cart:browser-worker:check:ai:metadata` | All 16 fresh cases passed: both layouts × normal/malicious × true/false/missing/invalid; four exact ready carts, twelve unchanged held carts, and twelve restarts with zero further requests/additions; 88 completed mocked requests and 12 additions |
| `pnpm cart:browser-worker:check:ai` | All 50 cases passed in one uninterrupted, unfiltered run |
| `pnpm cart:browser-worker:check:ai:http --diagnostic-mode passive` | All 12 cases passed with 72 completed mocked requests, complete verdict coverage and `acceptanceComplete=false` |
| `pnpm cart:browser-worker:check:failures --diagnostic-mode passive` | All four faults and restart checks passed: missing request, interrupted response, disconnection and authority loss |
| `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` | All six commands passed in that order: 81 suites, 34 ordered migrations/fresh database, none pending locally, build and served HTTP smoke checks |

Frozen/final source: **516 files**, SHA-256
`71a5d3a7653d476aef51899fbbd6daa8b284c204dcca72673803e9a6a1ff7c0f`.
Documentation is excluded and updated after verification. Private evidence under
`.sites-runtime/po-cart-workers/`:

- Baseline copies, source/budget/allowance fingerprints, command logs and final
  verification/preservation/privacy/cleanup reports: `metadata-repair-task-20261013/`.
- Metadata matrix: `ai-metadata-3dd7cbc6-ca51-44a9-9610-695926f38da3/report.json`.
- Served mocked matrix: `ai-evaluation/303effa1-254f-43ce-987b-f6b4bf774c83/report.json`.
- Passive injected failures: `faults-3e4088ec-7ca5-4f61-9a1b-0a209b6eb4cf/`.

All **28** new metadata/served diagnostic files are mode **0600**, contain
**38–128 events** each and pass privacy/bound checks. All **80** verdicts immediately
follow the corresponding provider completion and contain only the fixed numeric
phase/classification fields and standard envelope. All **16** retained metadata
fixture credentials and **24** served fixture credentials returned 401 after
revocation; their retained SQLite records also show revoked status. The safety
and injected-failure checks closed their isolated in-memory databases and HTTP
servers. The task preview stopped, ports 5181/5182 are free, and no new task-owned
browser/worker process remains. Pre-existing processes were left untouched.
The private cleanup matcher initially matched its own shell command; its
executable filter was corrected before the final successful audit. No browser
job or attempted addition was repeated.

All **4,976** protected historical artifact states, **420** existing carts and
**22,855** existing PO rows were preserved. All **35** historical gate-evidence
references retain their saved hashes. Compared with the saved dirty baseline,
only the three prompt/test files and four documentation files changed; the other
**33** inherited reviewable files remain byte-identical. Final diff, all **186**
relative links and credential-pattern checks passed across all 40 reviewable files.
Private model configuration remains ignored and mode 0600. The private preservation,
audit and cleanup reports record these checks.

**Zero real provider requests**, tokens or new real reservations were made.
Both real budget locations and the consumed allowance retained their original
fingerprints. The real ledger still reserves **$0.921518**, leaving **$4.078482**
under the unchanged $5 cap; the legacy budget file remains absent and the
allowance remains consumed. Mocked checks prove request construction and
conservative local handling only, not model interpretation of the new wording.
C4/M8 and the 12-case/72-request real-AI acceptance remain open. Hosting, real
suppliers, checkout, purchases and deployment remain disabled.

## Metadata repair acceptance preparation — 2026-10-13

Workstream **C4**, one bounded outcome: prepare the repaired single-snapshot
Metadata prompt for one separately authorized local real-model matrix. This task
implemented the offline preparation; verification stopped at a failed reliability
gate. **No paid provider
request or new real allowance was authorized or created.** The historical timeout
and earlier Metadata rejection remain unresolved; C4/M8 remain unchecked.

### Implementation and retained data

[The reader](../scripts/po-cart-worker/ai-reader.ts) accepts an optional private
[Metadata evidence sink](../scripts/po-cart-worker/metadata-evidence.ts), enabled
by the dedicated fictional evaluator and its mocked checks. Immediately after a
successful provider return, before verdict diagnostics and the strict completion
guard, it captures only the parsed `completed` and `progress` fields. Presence is
explicit, so absent, null and invalid values remain distinguishable. No prompt,
DOM, Extraction output, credential, provider envelope or usage envelope is retained
in this stream. Text is labeled untrusted and never feeds authorization/readiness.

Each case preallocates five exclusive mode-0600 files named with fixed Metadata
phase IDs **1, 3, 5, 7, 9**. A file, including its evidence envelope, is capped at
**16 KiB**; values are never truncated or coerced. Unknown/duplicate capture,
setup, write, sync or close failure invalidates acceptance and stops progression
without retrying inference. Unrequested phases in expected held cases remain
empty. Capture operates independently of ordinary diagnostics, including off mode.

[The separate allowance module](../scripts/po-cart-worker/metadata-allowance.mjs)
creates `.sites-runtime/po-cart-workers/metadata-repair-acceptance/allowance.json`
exclusively, with **one matrix, at most 72 requests, cumulative $5 ceiling**.
Creation requires an explicit authorization reference, a consumed predecessor,
the final source/gate fingerprints and immediately verified configured pricing.
It refuses any existing file, including a consumed or partial file. The old
reauthorization helper was removed. The prior consumed allowance is never reset.
[Preflight](../scripts/po-cart-worker/evaluation-preflight.mjs) selects the new
path, revalidates predecessor/source/gate evidence/pricing and consumes it with
fsync and ownership serialization before fixtures or provider requests.
Interruption or failure never restores it.

The repaired prompt, Extraction instructions, schemas, callback order, strict
`completed === true` guard, request/output bounds, timeouts, model/SDK versions,
cart authorization and purchasing gates are preserved. No API, schema, migration,
integration or application UI change was made.

Self-review found fixed screenshot paths and historical `manager-demo` reuse in
the inherited browser regressions. The first gate was intentionally stopped after
the Metadata step and during reliability cleanup, before those regressions. Six
fresh ready carts and their attempts were retained; no addition was repeated. Its
two still-active credentials were revoked. Screenshot outputs now use fresh
folders, the launcher uses a fresh private fixture root, and reconciliation and
launcher checks revoke their fixture credentials. The ordinary demo's default
root remains unchanged. The complete gate was restarted with fresh jobs against
the final source; the interrupted run is not acceptance evidence.

### Fresh offline verification

| Check | Fresh result |
| --- | --- |
| Five focused suites: reader, provider diagnostics, preflight, Metadata evidence, browser network | Passed; exact/absent/invalid field capture across all five phases, diagnostics-off behavior, duplicate/provider/write failures, privacy/bounds, allowance exclusivity/concurrency and zero-fixture/request rejection |
| Final-source 16-case Metadata matrix | Passed: four exact ready carts, twelve baseline-preserving holds and twelve restarts without additional requests/additions; 88 completed mocked requests |
| Consecutive 30-job reliability gate | **Failed at job 25**, rows/Stagehand/0 ms; 24 preceding jobs passed. No subsequent browser check ran. |
| Both served mocked capture matrices, uninterrupted 50-case safety suite, faults in all three diagnostic modes, seven browser regressions | **Not run after the reliability failure.** Served private capture integration and full gate acceptance remain unverified. |
| Separate sequential non-browser pipeline after the stop | `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` all passed: 82 suites, 34 ordered migrations/fresh database, none pending locally, build and HTTP smoke checks |

Final source: **519 files**, SHA-256
`bbd4e9d4527831ea9c2e334dbb5b590a8463f414e81e47a032f2cc60622c5427`.
The gate and separate pipeline verified that same source before/after commands.
The pipeline pass does not satisfy the failed frozen-source gate. Provider fetches
were independently denied throughout; all inference transports were explicit mocks.

The failed reliability case retained **six completed mocked requests** (baseline,
coffee and oat Extraction/Metadata), two durable addition attempts and one independently
observed coffee addition. Its saved browser error is `page.waitForResponse: Timeout
10000ms exceeded while waiting for event "response"`, during the second addition.
The job is `review_needed/uncertain_write`, with original unrelated cart row plus
coffee only. Inventory and reservation snapshots match; account ownership and
spending exposure remain held. External page requests and checkout submissions
are zero. No addition was retried, no prompt/model changed, and no later browser
step or paid connection check ran. This is a new **mocked local timeout observation**,
not a causal explanation of the historical timeout or a real-model Metadata verdict.
Its allowance gate is unavailable and paid execution remains blocked.

The failed fixture is
`reliability-43328776-2d5d-48f4-a350-c78e16c86539/24/`.
The task's `failure.json` preserves the journal, request phases/usage, exact cart,
audit events, attempts/results, ownership, reservation and evidence hashes.

Private evidence under `.sites-runtime/po-cart-workers/`:

- Baseline copies, source/budget/allowance fingerprints, historical cart and PO
  snapshots, focused logs, interrupted-run record, final audit/preservation and
  cleanup: `metadata-acceptance-task-20261013/`.
- Frozen-source gate: `instrumented-gate-59aa7c1c-b259-440a-a25c-804dcffcf445/report.json`.
- Gate code requires fingerprints for every served mocked Metadata file in both
  diagnostic modes. Those steps were not reached, so no served capture files from
  this task are claimed. Capture is separate from ordinary numeric diagnostics.

All **9,529** protected artifact states, **432** historical carts and **23,355**
historical PO rows match their baselines; all **35** historical gate references
retain their hashes. All **62** new served-fixture credentials and **32** isolated
Metadata-fixture credentials (including the intentionally stopped first gate) are
revoked. The final Metadata matrix's **16** diagnostic files are mode 0600 and
contain **44** numeric verdicts with matching preceding provider completions;
progress text is absent from ordinary diagnostics. Private capture tests passed,
but no served capture matrix completed in this task.

The real ledger remains **$0.921518 reserved**, leaving **$4.078482** under the
unchanged $5 ceiling, against the unchanged conservative **$1.959552** requirement
for 72 requests. Both real budget locations and the prior consumed allowance
retain their fingerprints; the legacy budget and new allowance remain absent.
**Zero real requests, tokens or new real reservations** were made. Task previews
and browsers are stopped and ports 5181/5182 are free; pre-existing processes were
preserved. Final link, diff, scope and credential checks are recorded in the private
audit. No browser gate or real-model acceptance is claimed.

### Separate paid execution and rollback

The next unblocked C4 item is **review of the retained addition-response timeout**.
Browser progression stopped at the unexpected failure; this task performs no new
browser reproduction or automatic repair. Review any bounded follow-up separately,
then pass every fresh gate against its final source before seeking explicit
12-case/72-request paid-matrix authorization. Immediately before any authorized
execution, verify official model availability, supported settings and
pricing; keep `gpt-5.4-mini-2026-03-17`, reasoning `none`, Stagehand `4.1.0` and
Playwright `1.61.1`. Any mismatch blocks execution pending a separate reviewed
change. Revalidate the final source/gate and private configuration, start the
loopback application/storefront, and recompute remaining budget from both ledger
locations. After authorization, call `createMetadataAllowance` with the gate
report, freshly verified pricing and authorization reference, then run
`pnpm cart:browser-worker:evaluate` within five minutes of pricing verification.
The evaluator defaults to passive diagnostics plus private Metadata capture.

Use both layouts and all six scenarios. The first normal case is the connection
check; no paid probe, retry, prompt revision, substitution or resumed attempted
addition is authorized. Stop at the first unexpected failure. Acceptance requires
all 12 cases and exactly 72 completed requests, four exact ready carts, eight
baseline-preserving holds, complete request/verdict evidence, zero duplicate
additions, incorrect ready results, external page requests, checkout submissions,
or inventory/reservation changes. Revoke new persistent credentials, stop owned
processes, preserve reservations/evidence/holds and record actual usage and hashes.
A pass establishes this local run only; hosted, supplier, pilot and production
acceptance remain separate and the historical timeout is not explained.

Rollback restores only this task's changed source/tests from
`metadata-acceptance-task-20261013/before/`, removing its three new source/test files
as appropriate. The four newly edited previously clean scripts also have saved
baseline copies. Preserve the inherited dirty worktree, all consumed allowances,
monetary reservations, evidence, carts and unresolved holds. Restoring source
invalidates the gate. No migration rollback is needed; ordinary deterministic
preparation remains available.

## Rollback and handoff

Stop evaluation and use the ordinary deterministic worker. Preserve the shared
budget ledger, legacy high-water source, jobs, evidence, journals, profiles,
receipts, unresolved account ownership and spending/quantity holds. Never delete
reservations to retry under a fresh $5 allowance. Existing reconciliation is the
only path for attempted/uncertain carts. No migration rollback is needed.

The instrumented real matrix's prior allowance remains consumed. The repaired
Metadata prompt and this acceptance preparation have local synthetic/unit evidence
only. The current 21-step gate failed at reliability job 25 on a second-addition
response timeout; the paid run and remaining browser checks are blocked. Review
its retained failure evidence next. Do not retry the attempted addition or revise
the prompt automatically. The historical timeout is still unexplained.

Restore only this preparation's source/test changes from
`metadata-acceptance-task-20261013/before/` and remove only its three new source/test
files if rolling back this task. Preserve all inherited work, historical evidence,
consumed allowances, budget reservations and unresolved holds. The earlier prompt
repair has its separate historical baseline at
`metadata-repair-task-20261013/before/`; do not conflate the two rollbacks.
After full local real-AI acceptance succeeds, hosted fictional Browserbase/separate-worker
feasibility follows with its own configuration, budget and authorization.
See the [integration guide](PO_AI_CART_INTEGRATION_ROADMAP.md) and
[browser worker evidence](C4_PO_CART_BROWSER_LOCAL_EVIDENCE.md).
