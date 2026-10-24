# C4 full offline gate rebinding (G4 preparation) — 2026-10-24

This source-only C4/M8 task follows the [G3 run and step-21 repair](C4_FULL_OFFLINE_GATE_RUN_20261022.md).
It has one reviewable outcome: a fresh gate binding. Its pre-invocation check
accounts for the worker locks that a passing gate's deliberate crash scenarios
leave, and its step logs keep a safe summary of any failure. No gate, browser,
preview, model, supplier or migration ran, and no runtime state was changed.
**C4/M8 remain open.**

## Owner decisions applied

- **Gate-left worker locks:** the owner chose **Option A**. Accept only locks that
  an audited, consumed gate accounts for, and keep every historical lock exact.
  Option B, archiving the locks before each gate, was not chosen. It would change
  runtime state, contradicts the earlier decision to exclude stale-lock
  archival, and would recur after every full gate.
- **Readable failures:** fold a fixed-shape failure summary into this binding,
  because the gate runner's source is frozen per invocation anyway.

## Changes

| File | Change |
| --- | --- |
| [`acceptance-gate.mjs`](../scripts/po-cart-worker/acceptance-gate.mjs) | Gate root is now `full-offline-acceptance-task-20261024`. `consumedGateRoots` adds G3's `…-20261022`. New `failureSummary`, described below. `gatePolicy`, the 21 steps and every threshold are unchanged. |
| [`po-cart-ai-gate.mjs`](../scripts/po-cart-ai-gate.mjs) | Each step log is the existing safe log plus `failureSummary(exitCode, output)`. The summary is empty for a passing step. |
| [`full-gate-audit.py`](../scripts/po-cart-worker/full-gate-audit.py) | Same new root. `CONSUMED` adds G3. `gate_profiles` also returns each profile's recorded worker PIDs. New `gate_locks`. `before` accounts for those locks, as described below. `capture` and `finish` are unchanged. |
| [`observation-baseline-audit.py`](../scripts/po-cart-worker/observation-baseline-audit.py) | `worker_locks(accounted)` accepts a caller-verified set of extra locks. It refuses one that overlaps the 46 historical locks. With no argument it behaves exactly as before. |

### `gate_locks` rule

`gate_locks` examines every lock or guard in `browser-profiles` that is not one of
the 46 historical locks. Each must:

- be a regular `<profile>.lock` file, checked by the existing stable `lock_fields`.
  A `.lock.reclaim` guard is never accepted.
- name a profile recorded by a qualifying consumed gate, under the
  [existing rule](C4_FULL_GATE_REBINDING_20261022.md#changes).
- contain only decimal digits equal to a worker PID that a qualifying gate
  recorded for that profile.
- name a PID that is absent from an independent process collection.

Anything else refuses. `before` then runs these checks in order:

1. it requires the historical locks, including the stale `4303` lock, to stay
   exact through `worker_locks(accounted)`;
2. it allows accounted locks to appear in the profile fingerprint only as
   additions;
3. it re-runs `gate_locks` after the fingerprint and requires the same result.

### `failureSummary`

For a failed step, the log gains one line: `FAILURE summary:` followed by these
fields.

| Field | Contents |
| --- | --- |
| `exit` | The exit code, or `signal` |
| `kinds` | Standard error class names |
| `codes` | `ERR_*` and `net::ERR_*` codes |
| `timeoutsMs` | Playwright `Timeout N ms` values |
| `at` | Up to eight `scripts/` or `tests/` file:line locations that name existing repository files |
| `cleanup` | The launcher's fixed cleanup failure categories |

Message text is never copied. The three step-21 reproduction logs would have
produced these summaries:

- `ERR_ASSERTION` at `po-cart-manager-launcher-check.mjs:47`;
- `net::ERR_ABORTED` at line 36;
- a 45,000 ms timeout.

## Verification

The [audit suite](../tests/po-cart-full-gate-audit.mjs) now drives the **real**
observation `worker_locks` and `lock_fields` against real fixture lock files,
including the stale `4303` lock.

- **Passes:**
  - no extra lock;
  - a lock for the passing gate's recorded profile that holds its recorded PID,
    with the owner gone.
- **Refuses:**
  - a fingerprint lock entry without a file;
  - a lock for an unrecorded profile;
  - a lock for a profile recorded only by the failed gate;
  - a reclaim guard;
  - a PID mismatch;
  - a trailing newline;
  - a live owner;
  - an owner that reappears before the re-check;
  - a symlinked lock;
  - a removed historical lock;
  - an unaccounted extra or historical-overlap set passed directly to the real
    `worker_locks`.
- All earlier cases still pass, and the real gate roots, including the new
  absent one, are unchanged.

The [gate suite](../tests/po-cart-full-offline-gate.mjs) pins the new root and all
three consumed roots. It checks `failureSummary` against output carrying a
fictional secret: in a message, a URL, a cleanup list and a path-shaped token.
It also checks the empty passing case and the `signal` case, and pins the runner's
log write.

Planted defects were each caught:

- **Locks (10):**
  1. no PID match;
  2. no live-owner check;
  3. no re-check;
  4. accepting guards;
  5. loose bytes;
  6. no `lock_fields`;
  7. allowing any lock entry;
  8. counting a failed gate;
  9. a superset historical check, which first survived behind `gate_locks` and
     was caught after adding the direct cases;
  10. a historical overlap.
- **Summary (5):**
  1. no repository-file filter;
  2. no category allowlist;
  3. a summary on success;
  4. a raw message line;
  5. the runner omitting the summary.

| Command | Result |
| --- | --- |
| `pnpm test po-cart-full-gate-audit po-cart-full-offline-gate po-cart-observation-baseline` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **113 suites** |
| `pnpm build` | Passed |

`db:check`, `db:migrate:local` and `test:local` are not claimed; the next gate's
six-command preparation runs them.

A read-only live run of `baseline_holds()`, with writes disabled, passed against
the current state:

- baseline `8ee75de7…` holds, with preflight idle;
- 46 historical locks are exact;
- 4 gate locks are accounted;
- the 80,692 changed entries are all inside the 329 profiles that G2 and G3
  recorded.

The new root is absent.

## Next gate procedure (separately authorized)

The procedure is the same as [G3](C4_FULL_GATE_REBINDING_20261022.md#next-gate-procedure-separately-authorized),
using the new root:

1. Run the frozen six-command preparation.
2. Run `full-gate-audit.py capture`.
3. Dry-run `finish` against the capture.
4. Invoke `caffeinate -di pnpm cart:browser-worker:gate:ai` once.

All inference stays mocked, the stop rule is unchanged, and a repeat
second-addition failure routes to causal investigation. Steps 15 and 19 will
again leave crash-scenario locks, which the following binding accounts for in the
same way.

Rollback reverts this commit. Every consumed root, the observation baseline and
all runtime state are untouched.
