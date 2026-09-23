# A5 older-data owner review — pending walkthrough

This is a development-only check of the read-only **Older-data review** screen.
Use only the separate fictional local test database prepared for this check. Do
not enter real company, employee, sale, customer, or supplier information. The
exact inventory preview must remain off in normal use and must not be enabled
on a remote environment for this review.

## Before starting

- The test guide confirms that `http://127.0.0.1:5173` is using the separate
  fictional database and the hidden preview is enabled only for this local run.
- The guide records that this fixture has no exact inventory balance before
  opening the screen. Do not change the existing local database.

## Owner walkthrough

1. Sign in with a fictional owner or manager account and open the fictional
   company. Open **Exact inventory** → **Older-data review**.
2. Check that the fixture's changed older stock and recipe appear with clear
   review messages. Check that a product lacking an exact opening count and a
   recipe lacking an active reviewed version are identified.
3. Check that the screen offers no button that silently converts older
   quantities, approves a recipe, or changes stock. A change flag is a prompt
   to compare records, not proof the older value is wrong.
4. Ask the test guide to compare the exact inventory balance with the recorded
   before value. Opening the report must not have changed stock or recipes.

Record PASS, FAIL, or BLOCKED for each step, the visible non-sensitive message
if something fails, and whether any step was skipped. Do not include passwords,
email addresses, links, tokens, or screenshots containing them. A local PASS
prepares A5 evidence; it does not by itself accept M3 or authorize deployment.

| Step | Result | Safe notes |
| --- | --- | --- |
| Fixture and local preview confirmed | Pending | |
| Owner/manager flags match fixture | Blocked | Owner could not view the local review tab. Agent precheck is recorded below only. |
| Report has no stock-changing action | Blocked | Owner could not view the local review tab. Agent precheck is recorded below only. |
| Inventory unchanged after reading | Pending | |

## Agent precheck — 2026-09-23

The separate `.sites-runtime/a5-review-state` database was created from all 13
local migrations and seeded with one fictional company, product, and recipe.
Its legacy baseline markers are fictional simulations; the separate automated
test exercises the actual `0009` backfill.
The local preview showed the changed milk and recipe, the missing opening
count, and the need for an active reviewed recipe. No stock-changing action
appeared in the review tab. A read-only verification after opening it found the
fictional stock and recipe unchanged, no exact balance, no exact inventory
event, and no foreign-key errors. This is agent-observed local evidence, not
the owner's acceptance of the screen wording. Employee role restrictions are
covered separately by the local security suite; this fixture uses only a mock
owner account.

To reproduce this isolated precheck, apply local migrations with Wrangler's
`--persist-to .sites-runtime/a5-review-state` option, run
`node scripts/a5-review-fixture.mjs seed` once on the empty fixture database,
then start `PANTRACK_A5_REVIEW=enabled pnpm dev`. The opt-in serve mode points
only to that fixture state and enables the preview locally; normal `pnpm dev`
continues to use the existing local database and its unchanged gate setting
(off by default). After viewing,
run `node scripts/a5-review-fixture.mjs verify`. Do not run the seed command on
the normal local D1 database.

Owner review date: pending. Owner decision: blocked by access to the local review tab. C1/M2 and Cloudflare
build gates remain separate.
