# A5 older-data owner review — local walkthrough passed

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
   company. Open **Inventory** → **Older-data review**.
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
| Fixture and local preview confirmed | PASS | Agent confirmed the isolated fictional D1 and local-only preview. |
| Owner/manager flags match fixture | PASS | Owner viewed the changed fictional milk and latte messages, opening-count need, and reviewed-recipe need in a private browser tab. |
| Report has no stock-changing action | PASS | Owner reported no stock-changing button in the review area. |
| Inventory unchanged after reading | PASS | Agent reran read-only fixture verification after the owner's walkthrough; fictional stock and recipe stayed unchanged with no exact balance or event. |

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

Owner review date: 2026-09-23. Owner decision: PASS for this local fictional-data
screen walkthrough. The initial tab-access blocker was resolved using a private
browser tab. This screen result alone did not accept A5/M3.

## Subsequent owner A5/M3 decision — 2026-09-23

After reading the [M3 evidence](M3_LOCAL_EVIDENCE.md) and A5 checklist, the
owner explicitly accepted A5/M3 for development. The [A5 acceptance record](M3_LOCAL_EVIDENCE.md)
maps the M3 criteria to local tests, the A1–A3 handoffs, and the complete local
pipeline. This decision accepts the local M3 implementation and opens B5's M3
prerequisite. It does not verify migration `0012` on development D1, the hosted
Worker, production data, or M4 acceptance. The exact-inventory preview remains
off remotely pending its separate migration and runtime checks.
