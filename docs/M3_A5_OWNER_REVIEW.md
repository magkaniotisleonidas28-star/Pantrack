# A5 older-data owner review — pending walkthrough

This is a development-only check of the read-only **Older-data review** screen.
Use only a separate fictional local test database prepared for this check. Do
not enter real company, employee, sale, customer, or supplier information. The
exact inventory preview must remain off in normal use and must not be enabled
on a remote environment for this review.

## Before starting

- The test guide confirms that `http://127.0.0.1:5173` is using the separate
  fictional database and the hidden preview is enabled only for this local run.
- The test guide records the fixture's stock and recipe flags and the exact
  inventory balance before opening the screen. If no separate fixture is ready,
  mark this walkthrough **BLOCKED**; do not change the existing local database.

## Owner walkthrough

1. Sign in with a fictional owner or manager account and open the fictional
   company. Open **Exact inventory** → **Older-data review**.
2. Check that the fixture's changed older stock and recipe appear with clear
   review messages. Check that a product lacking an exact opening count and a
   recipe lacking an active reviewed version are identified.
3. Check that the screen offers no button that silently converts older
   quantities, approves a recipe, or changes stock. A change flag is a prompt
   to compare records, not proof the older value is wrong.
4. Using a separate fictional employee session, check that **Older-data
   review** is unavailable. Do not use developer tools or alter permissions.
5. Ask the test guide to compare the exact inventory balance with the recorded
   before value. Opening the report must not have changed stock or recipes.

Record PASS, FAIL, or BLOCKED for each step, the visible non-sensitive message
if something fails, and whether any step was skipped. Do not include passwords,
email addresses, links, tokens, or screenshots containing them. A local PASS
prepares A5 evidence; it does not by itself accept M3 or authorize deployment.

| Step | Result | Safe notes |
| --- | --- | --- |
| Fixture and local preview confirmed | Pending | |
| Owner/manager flags match fixture | Pending | |
| Report has no stock-changing action | Pending | |
| Employee cannot open report | Pending | |
| Inventory unchanged after reading | Pending | |

Owner review date: pending. Owner decision: pending. C1/M2 and Cloudflare
build gates remain separate.
