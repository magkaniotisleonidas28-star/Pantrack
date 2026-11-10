# A8 repeatable local browser check

Checklist: A8, one development verification outcome. Promote the captured local
manager walkthrough into a repeatable project command. A8/M7 remains open:
hosted end-to-end, concurrency and source-change acceptance still require the
separately authorized development release and hosted checks.

## Run

Install the locked dependencies, use the project's Node 22 runtime, and run:

```sh
pnpm a8:check:browser
```

The command accepts no arguments. It uses a locally available Chromium browser
(Playwright Chromium, Chrome or Edge). If needed, set `CHROME_PATH` to the local
browser executable before running it. No provider credential is needed.

Each invocation creates a new private `.sites-runtime/a8-browser/run-<uuid>`
directory. The command copies the current source inventory into its own app,
excludes local environment/credential files and historical runtime state, links
the installed dependencies, and gives Vite its own cache. Only the new app's
fixture environment and local D1 state are initialized. Existing `.dev.vars`,
`.wrangler/state`, execution profile and prior evidence are preserved.

On Windows the fresh app uses a shorter owned directory under local application
data, avoiding the SQLite path limit in deeply nested worktrees. Its absolute
`appRoot` is retained in the report; the normal evidence directory stays in the
worktree. Other platforms keep the app inside that evidence directory.

Reports, command logs, screenshots, source fingerprints and cleanup records are
retained under the new directory. `report.json` is the overall result;
`browser-result.json` records the browser assertions. A failed attempt is retained
and is never overwritten by a later invocation.

## Coverage

- Display the expected restocking calculation from fictional exact stock.
- Lose real create/edit responses and recover the same saved revision without
  duplicate origins or edits; activate the edit with the keyboard.
- Change stock through a real physical-count API call, then record one stale
  proposal invalidation across repeated reads.
- Cancel stale reviews, including in the phone layout.
- Expire the fictional sales-health record; refuse a fresh proposal and permit
  cancellation of the old stale review.
- Refuse anonymous, wrong-company and employee API access, and verify that a
  fresh employee session shows the staff workspace without manager controls.
- Compare the snapshot's inventory tables before/after proposal actions; only
  the deliberate physical count may change them. No `_cf_` table is queried.
- Keep supplier submission disabled, observe no browser request outside loopback,
  and check desktop/390-pixel layout and page errors.
- Close the browser and actual local server, verify the port is free, and retain
  the source fingerprint before/after.

The [server lifecycle test](../tests/a8-browser-lifecycle.mjs) runs in the normal
`pnpm test` suite without needing a browser. It injects the acquisition/work steps
while exercising real HTTP servers. Success, startup failure, scenario failure
and combined scenario/cleanup failure close the actual resource; cleanup inputs
are written before release and the original error is retained. Unsupported
command arguments retain fixed-shape refusal inputs before the decision, without
creating an app or database.

The full browser command is explicit; it is not automatically added to the cart
gate or the ordinary CI browser requirements.

## Validation and handoff

The permanent command passed twice from the same frozen source, with different
fresh app/database roots and fictional companies. Both runs passed the entire
browser flow, closed the browser/server, left their ports free, and preserved
every byte of the existing worktree's local settings and database files.

All six local commands passed: `pnpm typecheck`, `pnpm test` (174 selected,
162 executed and twelve existing Windows-specific skips), `pnpm db:check`
(46 migrations), `pnpm build`, `pnpm db:migrate:local` and `pnpm test:local`.
The staged source inventory stayed frozen at 813 files, hash `bd19ece7…`, through
the two browser runs and six commands. Final-head Windows/Linux CI remains an
integration requirement, separately from these local results.

Two early permanent-command attempts remain failed and retained. One could not
open SQLite at a deeply nested Windows path; the shorter owned app path fixed
that. The other exposed an incompatible dependency-cache location and incomplete
cleanup during server construction. The runner now owns its normal cache layout
and observes the server during construction; real-resource startup-failure tests
and the two complete runs pass. No application defect or repair is inferred.

Absolute verification evidence:
`C:/Users/Leo/Project/Pantrack/.sites-runtime/a8-permanent-browser-20261110`.
The validation summary, immutable command logs, prior-state hashes and browser
reports retain the actual outcomes. The earlier captured walkthrough on
`19d57a1` and its fixture/selector corrections remain separate historical evidence.

No application API, business behavior, schema, migration, dependency or supplier
contract changes. Source additions are the browser runner/scenario, focused
lifecycle helper/test and the package command. Shared status/roadmap edits record
A8 coverage only; Peter's cart/AI files are untouched. Keep this branch unmerged
through his protected preparation-to-paid-run window. No gate, allowance, paid
request, Clover action, supplier action, hosted migration or deployment is run.

Rollback removes the command and verification files; no application/data repair
is needed. Retain generated fictional evidence as needed. The next A8 acceptance
item remains authorized hosted testing after the deferred release.
