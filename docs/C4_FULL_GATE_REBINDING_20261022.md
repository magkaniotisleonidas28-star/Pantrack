# C4 full offline gate rebinding (G3 preparation) — 2026-10-22

This source-only C4/M8 task follows the [G2 run and repair](C4_FULL_OFFLINE_GATE_RUN_20261021.md).
Its one reviewable outcome is a fresh gate binding whose pre-invocation check
accounts for profiles that an audited, consumed gate recorded. No gate, browser,
preview, model, supplier or migration ran. **C4/M8 remain open; historical causes
remain unresolved.**

## Owner decision applied

The owner chose **Option A**: allow only changes confined to profiles recorded by
consumed gate roots whose final audits passed. **Option B**, a fresh observation
baseline, was not chosen. It would also have failed as built: the baseline auditor
refuses any drift outside the active profile, so it would reject G2's profiles.

## Changes

| File | Change |
| --- | --- |
| [`acceptance-gate.mjs`](../scripts/po-cart-worker/acceptance-gate.mjs) | Gate root is now `full-offline-acceptance-task-20261022`. `consumedGateRoots` lists both the October 14 and the G2 (`…-20261021`) roots, and `createGateInvocation` refuses each under any spelling. `gatePolicy`, the 21 steps and every threshold are unchanged. |
| [`full-gate-audit.py`](../scripts/po-cart-worker/full-gate-audit.py) | Same new root. `CONSUMED` is now the list of both roots, and `capture` refuses either. `before` now accounts for gate-recorded profiles through `gate_profiles`, described below. `finish` is unchanged. |

**`gate_profiles`** reads each consumed root. A root contributes profile
directories only if:

- it was invoked (`task.json` exists);
- its retained `final-audit.json` has every audit flag and `passed` set to true;
- every file that audit references is unchanged and inside that root;
- its `process-audit.json` passed with `profilesClear`;
- its `preservation.json` passed;
- its process-audit profile count equals its number of profile records.

Each record must name a 64-hex directory directly under `browser-profiles`, other
than the active `803d991d…` profile. Otherwise the check refuses. A gate that does
not qualify contributes nothing, so drift in its profiles still refuses.

The October 14 root does not qualify, because its credential audit did not pass.
That is harmless: its profiles predate the baseline.

**`before`** still requires everything G1 required:

- a published, consistent baseline;
- idle preflight;
- historical PIDs absent;
- all 46 locks exact;
- the retained singleton.

A changed fingerprint entry is now allowed only if its top-level directory is a
qualifying gate profile. Top-level lock files, the active profile and every other
profile must still match the baseline exactly.

## Verification

The [audit suite](../tests/po-cart-full-gate-audit.mjs) now builds two consumed
gate fixtures, one with passing audits and one without. It covers:

- **Passes:**
  - a clean state;
  - accounted drift in a reused and a new recorded profile, including an added,
    a changed and a removed entry.
- **Refuses:**
  - unrelated-profile drift;
  - drift in an unrecorded profile, or in one recorded only by the failed gate;
  - drift in a recorded profile of a gate that was never invoked;
  - lock-file drift that shares a recorded profile's prefix;
  - active-profile drift;
  - records that name the active profile, a path outside `browser-profiles` or a
    non-profile name;
  - changed referenced audit evidence;
  - a profile-count mismatch;
  - the earlier G1 refusals.
- **Capture** now refuses both consumed roots.

The [gate suite](../tests/po-cart-full-offline-gate.mjs) pins the new root and both
consumed roots, and checks that each consumed root is refused.

Seven planted defects were each caught:

1. counting a failed gate;
2. dropping the reference-hash check;
3. dropping the profile-name check;
4. prefix matching instead of directory matching;
5. allowing an active-profile record;
6. dropping the count check;
7. counting an uninvoked root.

The count defect first survived, because the evidence-hash check masked it. The
fixture now builds that case with consistent hashes.

| Command | Result |
| --- | --- |
| `pnpm test po-cart-full-gate-audit po-cart-full-offline-gate` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **110 suites** |
| `pnpm build` | Passed |

`db:check`, `db:migrate:local` and `test:local` are not claimed; the next gate's
six-command preparation runs them.

A read-only live run of `baseline_holds()` passed against the current state:

- baseline `8ee75de7…` holds, with preflight idle and 46 exact locks;
- there are 385,433 current entries;
- the 32,366 changed entries are all inside the 133 profiles G2 recorded, and no
  other entry changed.

Nothing was written. The new root is absent.

## CI portability correction

PR #12 CI failed `pnpm test` on Ubuntu and Windows, although the branch passes
locally and in a clean clone. Both causes were test assumptions; neither was a
defect in the gate tools.

- **Ubuntu:** the observation-baseline WAL-copy test expected a plain `mode=ro`
  open of a sidecar-less WAL copy to fail. That is what happens on macOS. Linux
  SQLite instead opens it by creating `-wal`/`-shm` sidecars. This confirms why
  `open_readonly` uses `immutable=1`. The test now opens a separate copy plainly
  and accepts either a refusal or created sidecars as proof that plain opening is
  unsafe. It still requires the helper to read the copy and create nothing.
  Disabling `immutable=1` still fails the suite.
- **Windows:** the cleanup regression asserted POSIX modes and created a symlink.
  Those assertions now run only off Windows, matching the suites' existing POSIX
  conventions.

After `000e26d`, type checking, 110 suites and build passed locally. CI passed on
`ubuntu-latest` and `windows-latest`.

That change altered the frozen source, so the first preparation was retired
uninvoked. It had passed the six-command pipeline at `40f84755…` and a capture of
25,498 protected files, 548 carts and 196 databases, a trial `finish` and the
`before` check. It has no `task.json`. It is retained unchanged at
`.sites-runtime/po-cart-workers/full-offline-acceptance-superseded-preparation-20261022/`,
and the gate root was re-prepared. The root binding is unchanged.

## Next gate procedure (separately authorized)

The procedure is the same as [G2](C4_FULL_GATE_REBINDING_20261021.md#g2-procedure-separately-authorized),
using the new root:

1. Run the frozen six-command preparation.
2. Run `full-gate-audit.py capture`.
3. Dry-run `finish` against the capture.
4. Invoke `caffeinate -di pnpm cart:browser-worker:gate:ai` once.

All inference stays mocked, the stop rule is unchanged, and a repeat
second-addition failure routes to causal investigation. Step 15 will be the first
real-browser run of the cleanup repair.

Rollback reverts this commit. Both consumed roots, the observation baseline and
all runtime state are untouched.
