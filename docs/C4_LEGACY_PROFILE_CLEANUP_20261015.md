# C4 verified legacy browser cleanup — 2026-10-15

## Contract and boundaries

This is one bounded local maintenance outcome under **C4**, following the
[historical-profile preflight](C4_PROFILE_PRESERVATION_PREFLIGHT_20261015.md).
Close only the three historically identified orphan test Chrome instances rooted
at PIDs 30060, 30082 and 30474, archive only the stale worker lock containing
4303, then prove an idle preflight and a stable fresh baseline. Fresh process
identity, executable and exact profile evidence authorize actions; PID numbers
alone do not. PID 4303 belongs to macOS `applekeystored` and receives no signal.

There is no browser investigation or acceptance-gate execution, paid inference,
supplier access, purchasing, deployment, power-setting change, public API or
schema change. **C4/M8 remain open. The original timeout's cause is unresolved.**

## Implementation

The [dedicated CLI](../scripts/po-cart-legacy-profile-cleanup.mjs) accepts no
arguments, overrides or resume. Its sole private root is
`.sites-runtime/po-cart-workers/legacy-profile-cleanup-task-20261015/`.
The [cleanup module](../scripts/po-cart-worker/legacy-profile-cleanup.mjs) is
separate from existing task-owned cleanup. It binds the three exact profile keys
and all 27 process identities to the unchanged historical preflight hash.

Source, historical evidence, carts, database rows, budgets and consumed records
are snapshotted before preparation. The CLI snapshots current targets, lock
metadata and profile fingerprints before consuming its durable invocation.
Four exclusive reclamation guards serialize ownership with existing workers;
existing or replaced guards block cleanup. Directory identities remain checked.

Each browser leader receives an individually verified SIGTERM, followed by a
five-second monotonic wait for all captured members. Remaining verified captured
members alone may receive individual SIGKILL signals, followed by another
five-second wait. Process groups are never signaled. New members, PID reuse,
changed identities, interruption, unavailable evidence or failed verification
stop further cleanup. Partial evidence is retained; no browser restarts or
automatic retries follow.

The single worker lock is renamed into the private archive only after its PID,
inode, hash, modification time and reused PID start time are reverified and no
profile process remains. Rename preserves its bytes and metadata. Only guards
created by this task are released. Profile directories and other stale locks
remain preserved.

The [independent auditor](../scripts/po-cart-worker/legacy-profile-audit.py)
checks processes, the untouched macOS process, archive and guards separately
from runner claims. It audits evidence/business preservation, takes two matching
profile fingerprints at least five seconds apart, records shutdown-related
profile changes and only then writes the fresh baseline. The
[non-browser tests](../tests/po-cart-legacy-profile-cleanup.mjs) cover boundaries,
PID reuse, new descendants, graceful shutdown, bounded escalation, interruption,
ownership, archival races and independent auditing with simulated processes.

## Verification and handoff

Six focused suites passed: `po-cart-legacy-profile-cleanup`,
`po-cart-profile-preflight`, `po-cart-preview-cleanup`,
`po-cart-display-on-investigation`, `po-cart-full-offline-gate` and
`po-cart-second-addition-compatibility`. All six preparation commands passed in
this worktree:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed, **97 suites** |
| `pnpm db:check` | Passed, 35 ordered migrations and fresh SQLite |
| `pnpm build` | Passed |
| `pnpm db:migrate:local` | Passed, no pending local migrations |
| `pnpm test:local` | Passed, ordinary fictional loopback HTTP smoke |

Preparation and execution used **556 source files**, SHA-256
`e6b9813c1e45e2b1e950a0b4f5ef82014922e5fca76ec820c2a731c00d9006dd`.
The single maintenance invocation was durably consumed. At
`2026-10-15T15:48:23.659Z`, the CLI recorded SIGTERM sent only to PID 30060.
It then stopped during shutdown verification and exited one. It recorded no
SIGKILL, signal to either later browser, lock archival or browser restart.
**Maintenance is incomplete; no retry was attempted.**

The report retains the signal intent, sent event, source, stage and final blocked
status. It does not retain the refusing process observation or exception
category. Read-only checks afterward pass the population, directory and lock
checks, so the exact transient refusal cannot be reconstructed from the retained
evidence. Do not attribute it to PID reuse, a new descendant, the earlier browser
timeout, or a specific observation race without new evidence.

Read-only inspection confirms all nine captured members of the first instance
are gone. The other **18 processes**, rooted at 30082 and 30474, retain their
original identities. `applekeystored` is unchanged, all four task-created guards
are cleared, and the PID-4303 worker lock remains in place. The standalone
preservation preflight returns **blocked: 18 processes and three live lock
references**. The two remaining instances and the stale worker lock still block
an idle baseline. No stable fresh baseline or complete cleanup audit is claimed.

Private evidence includes the inherited source/diff and rollback manifest,
historical evidence/cart/database baselines, focused and preparation logs,
target/ownership snapshots, the complete pre-action profile fingerprint, consumed
`task.json`, partial `report.json`, read-only post-action checks and independent
partial-action/preservation audits. Evidence files use 0600 and directories 0700.

The independent preservation audit passed for **16,551 protected evidence files**,
all **494 historical carts** and **37,320 baseline business rows** across six
local databases. Preparation smoke added **16 ordinary fictional rows** and
changed one bookkeeping row state. Zero served-cart rows, browser jobs or gate
invocations were added. The maintenance invocation itself is separately consumed.
Real reserved exposure remains **$0.921518**; budget fingerprints and historical
consumption records are unchanged. Inherited source outside the two declared
documentation files is preserved.

The post-action profile comparison records **43 changed entries**: 39 within the
first browser's profile after shutdown, plus four QuotaManager/QuotaManager-journal
files in the two unsignaled, still-active profiles. Entry counts include filesystem
metadata and singleton changes, not just changed file contents. The private
`shutdown-profile-changes.json` preserves before/after metadata and hashes.
The independent partial profile audit consequently failed its requirement that
changes remain confined to the closed profile. The four other changes are
observations of live profiles; their cause is not established. All worker locks
remain unchanged. There are no matching idle fingerprints or fresh baseline.

The [display-on investigation's seventeen-file preservation failure](C4_SECOND_ADDITION_DISPLAY_ON_20261015.md)
remains failed and unchanged. Shutdown-related changes recorded here do not
repair or excuse that historical audit.

Source rollback uses the private `rollback-manifest.json`: restore only the two
declared documentation files and remove only the five new source/documentation
files. Preserve all runtime evidence, consumed records, carts, reservations and
holds. Rollback must not reopen browsers or restore the stale worker lock.

The next unblocked C4 work is a separately scoped review of the maintenance
refusal and disposition of the remaining two instances and stale lock. This
consumed CLI must not be resumed or rerun. An idle preflight and stable fresh
baseline are still required before a **separately scoped fresh complete offline
gate**. This task ran no investigation or gate and changes no milestone checkbox.
