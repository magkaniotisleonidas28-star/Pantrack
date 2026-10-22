# C4 fresh full offline gate run (G2) — 2026-10-21

This is G2 of the [fresh gate scope](C4_FULL_OFFLINE_GATE_SCOPE_20261021.md). It
is the one authorized invocation of the [rebound gate](C4_FULL_GATE_REBINDING_20261021.md),
wrapped in `caffeinate -di`. **Result: stopped at step 15 of 21 on a harness
cleanup regression. All final audits passed. C4/M8 remain open.**

All inference was mocked. The run used a fictional key and the real-provider
denial import, and made zero real requests. No supplier access, checkout,
purchase, deployment, migration of hosted data or power-setting change occurred.
Private evidence is retained at
`.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021/`.

## Preparation

The first preparation failed at `pnpm test` on a G1 test defect: an
absent-root assertion. It is retained at
`full-offline-acceptance-superseded-preparation-20261021/`, and no invocation was
consumed. After the fix (`3d2eb9c`), the second preparation passed all six
commands:

- `typecheck`;
- `test` (**110 suites**);
- `db:check`;
- `build`;
- `db:migrate:local`;
- `test:local`.

The frozen source was **595 files**, `6a7afe8a…ac290a3`, and the gate's
validator accepted the preparation.

The fixed `capture` then recorded:

- 23,749 protected artifacts;
- 494 carts;
- 118 databases with 46,694 historical rows.

Of 23,459 protected files shared with the earlier observation-baseline capture,
none changed across three full test runs, so repeated pipeline steps rewrite no
protected evidence. A `finish` dry run on a scratch copy passed. The baseline
pre-check passed: profiles were identical to `8ee75de7…`, preflight idle and 46
locks exact. The runner repeated it before consumption.

## Outcome

The gate ran from 00:15:17Z to 00:46:46Z on 2026-10-22. Steps 1–14 passed their
unchanged inspections:

| Step | Result |
| --- | --- |
| 1 — Metadata | 16/16 cases, 88 completed mocked requests, zero real, zero external, zero checkout |
| 2 — Reliability | **30/30 ready**, 300 completed mocked requests, balanced rows/compact × 0/750/1,500 ms |
| 3–4 — Served off/passive | 12/12 each, 72 completed requests each |
| 5 — AI safety | 50 uninterrupted cases |
| 6–8 — Faults off/passive/form | Four expected injected faults each |
| 9–14 — Pipeline | `typecheck`, `test`, `db:check`, `build`, `db:migrate:local` and `test:local` passed |
| 15 — `cart:browser-worker:check` | **Stopped.** Scenario `rows/normal` passed its checks (`PASS … ready`), then its cleanup assertion failed |
| 16–21 | Not run |

The reliability step that stopped the October 14 gate at job 5 passed all 30
jobs with the display held on. That is consistent with the
[display-on investigation](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md), but it is
**not a causal finding**. The agreed investigation rule (a repeat second-addition
failure) did not trigger.

## Step 15 cause: harness regression

The retained `states/1/cleanup.json` records `credentialsRevoked: true`,
`browserClosed: true` and **`stateSaved: false`**. The cause is in the harness:

1. The shared [`finishOfflineFixture`](../scripts/po-cart-worker/offline-case-cleanup.mjs)
   runs `VACUUM INTO '<dir>/state.sqlite'` before `writePrivate` creates `<dir>`.
2. The [browser worker check](../scripts/po-cart-browser-worker-check.mjs) passes
   `root/states/<case>`, which nothing creates beforehand. Its journals and
   credentials live in the root.
3. SQLite cannot create the directory, so the vacuum throws and
   `stateSaved: false` follows.
4. `stop()` asserts `cleanupVerified === true`, so the first scenario always fails
   here.

An isolated reproduction confirmed that `VACUUM INTO` fails with "unable to open
database" for a missing directory and succeeds for an existing one. The other
callers pass directories that already hold their files.

This check last ran on October 11 and 13, before the shared helper replaced its
cleanup in `a897ce3`. Tonight was its first run with the helper. The defect
predates G1, and the stop has no bearing on product behavior or the historical
timeout.

## Final audits

All independent audits passed:

- **Credentials:** 113 revoked, with HTTP 401 checks.
- **Processes:** 133 task profiles and all process groups clear, with ports free.
- **Consumption:** 15 consumed steps match the results.
- **Evidence:** every reference is unchanged.
- **Preservation:** 23,749 artifacts and 494 carts unchanged. Across 118
  databases no historical row was removed or changed. There were 3,573 added
  fictional and smoke rows. Bookkeeping changed in two `_cf_METADATA` row states
  and one credential-event sequence, verified to its maximum ID. Real reserved
  exposure is unchanged.

The report keeps `passed: false`, `status: stopped`. No process remains and no
retry ran. The invocation is permanently consumed with six unrun steps.

## Repair — 2026-10-21

`finishOfflineFixture` now creates the case directory with mode `0700`. It refuses
a symlink or non-directory before `VACUUM INTO`, and `cleanupVerified` still
requires a saved state. A regression in the [gate suite](../tests/po-cart-full-offline-gate.mjs)
vacuums a real `node:sqlite` state into a missing `states/1` directory. It then
checks the directory and file modes and the saved rows, and that a symlinked case
directory is refused without writing through it. The old test pre-created its
directory and faked the vacuum, which is why it missed this.

Reverting the fix or dropping the symlink guard each makes the suite fail. Type
checking, **110 suites** and build passed. `pnpm cart:browser-worker:check` was
**not** run. It launches real local browsers and adds profiles, which would
further change the profile state discussed below. Its real-browser confirmation
belongs to the next gate.

### Rebinding question for the next gate

G2 left 130 new task profiles and reused 3 existing ones. All 133 are recorded
in its `profiles/` records, nothing was removed, and lock files are back to 46
with preflight `idle`. G1's `before` check requires profiles identical to the
observation baseline, so it would now refuse every gate. Two options:

- **Option A (recommended):** allow only changes confined to profiles recorded
  by consumed gate roots whose final audits passed. Keep every other profile,
  the active `803d991d…` profile and all 46 locks exact.
- **Option B:** publish a fresh observation baseline under a new fixed root and
  policy.

Either way, the next gate also needs `full-offline-acceptance-task-20261021`
added to `consumedGateRoots` and a new root.

## Next

1. **Repair:** done (above).
2. **Rebinding:** consume the G2 root, choose the baseline option above, and
   bind a new root.
3. **Then a separately authorized fresh gate** with the same procedure.

The October 14 hold, reservation and both consumed gate roots remain retained.
This gate does not close C4/M8. Real-model, hosted, supplier, pilot and production
evidence remain separate.
