# C4 cart preparation preview

## Outcome and boundary

The owner selected a local visible-browser prototype, Baldor as the intended future supplier, and a bounded real-AI evaluation. On 2026-10-08 the owner chose to finish with real-AI evaluation pending. This C4 slice prepares a controlled fictional cart from a reviewed draft and hands the same browser to a manager. It does not establish Baldor compatibility, accept M8, approve spending, submit checkout, or change stock/incoming quantities.

The PO record remains the auditable input. This experiment validates a possible cart channel alongside the [existing rollout](PURCHASE_ORDER_ROLLOUT.md); it does not silently replace its approval, confirmation or receiving gates. The next external step is [C3 Baldor access feasibility](C3_BALDOR_PREPARATION.md).

## Run the demo

1. Run `pnpm dev:cart`. The workspace uses `http://127.0.0.1:5181`; the fictional supplier uses port 5182. Existing previews on other ports and their databases are preserved.
2. In another terminal, run `pnpm cart:seed` once to create **Cart practice café** and its reviewed draft. Repeated seeding creates another practice company, rather than overwriting anything.
3. Visit `http://127.0.0.1:5181/signin-with-chatgpt?return_to=/`, select that company, open **Purchase-order drafts**, and open the reviewed fictional supplier draft.
4. Choose a layout/scenario and select **Prepare demo cart**. Chromium opens separately. The UI reports checks for exact supplier SKU, pack, quantity and price.
5. Select **Review cart in supplier browser** to take over that same session. For expired sign-in, use the fictional sign-in button, then **Resume and verify** in Pantrack. No password or 2FA code is used.

Chrome for Testing is detected from an existing Playwright cache, or Stagehand locates installed Chrome. Set `CHROME_PATH` to a compatible Chromium executable if needed. No browser is downloaded automatically. Preparation remains offline even when model credentials exist.

The three catalog products are DEMO-COFFEE (case of 6 × 1 lb, $54), DEMO-OAT (case of 12 × 1 L, $32), and DEMO-CUPS (sleeve of 50, $6.50). Other SKUs, unknown prices and live supplier identities stop for review. Unrelated existing cart items are preserved. Existing requested SKUs require review; canceling a job never clears the supplier cart. To repeat a successful scenario with an empty practice account, seed a new fictional company.

## Contracts and recovery

- A default-off, loopback-only `/api/cart-preview-context` endpoint uses existing server company/role/CSRF authorization and returns the current saved draft and actor. A serve-only Vite bridge exposes `/api/cart-preview` start/status/resume/cancel/inspect; it is absent from production builds.
- Jobs bind company, actor, operation ID, draft revision, account/location and browser session. Receipts, state-transition history, baseline and attempted writes persist atomically in `.sites-runtime/cart-preview`; one process owns that store. Reopening the draft retrieves its saved job without browser storage. Source edits/cancellation invalidate readiness, including start replays. Repeated status reads do not duplicate an unchanged invalidation event.
- Stagehand 4.1 launches Chromium; Playwright handles deterministic browser operations over CDP. SDK page-driver navigation/RPC races found during verification motivated this split. AI may select a product candidate; trusted code derives selectors, verifies exact values and performs controlled actions.
- Browser proxy and context request interception allow the fictional storefront only. The browser's local CDP control port is the sole proxy exception. Checkout is blocked by the browser and by the fixture server; an unrestricted agent is never run.
- Interrupted work stops for review. Resume rereads the current cart and reconciles attempted changes before adding anything. Ready is cart preparation only, not a purchased or incoming order.
- No schema migration, production data change, deployment, supplier contact or live account access occurred. Stop the preview to roll back availability; retain local files for diagnosis. Interrupted preparation requires explicit resume after process/browser loss. Reopening a verified job restores its browser profile and rechecks the cart before handoff.

## Verification

- `pnpm test`: 52 suites passed, including anonymous, wrong-company, forbidden-role, CSRF and default-off cart-context tests, durable receipts, revision/actor binding, cart preservation and pre-call budget accounting. Routine tests make no model calls and launch no browser.
- `pnpm cart:check`: 16 offline Chromium scenarios passed across both layouts: available items, unavailable items, changed prices, wrong packs, ambiguous SKUs, interrupted responses after writes, expired sign-in and untrusted page instructions. The fixture state independently verified exact quantities, preserved unrelated items, no false ready result and no duplicate additions.
- `pnpm cart:check:http`: served local authentication/tenant/CSRF/strict-input checks, concurrent replay, account cart lock, same-session inspection, reopening, source invalidation and unchanged inventory passed.
- `pnpm typecheck`, `pnpm db:check`, `pnpm build`, `pnpm db:migrate:local`, `pnpm test:local` and `git diff --check` passed. Migration check applied the 28 existing migrations to a fresh SQLite database; normal local migration reported no pending migrations.
- Served ready state reviewed at 1440px and 390px with no horizontal overflow. The mechanical UI detector's side-accent-border finding was removed. The independent finish reviewer approved the scoped extension after secondary text contrast increased from 4.42:1 to 5.19:1; the fix is local to the cart component and preserves global tokens. The documentation pass confirmed inheritance from the existing draft screen and no global style changes. Dark mode, keyboard focus, long text and other states were not visually reviewed.

Logs and browser results are ignored under `.sites-runtime`. Screenshot evidence is local under `.impeccable/review`. This is local/offline evidence; no real-AI, provider, supplier sandbox, pilot or production pass is claimed.

## Pending real-AI evaluation

Configure an ignored `.dev.vars.cart` locally with `OPENAI_API_KEY`, `PANTRACK_CART_AI_MODEL`, `PANTRACK_CART_INPUT_USD_PER_MILLION` and `PANTRACK_CART_OUTPUT_USD_PER_MILLION`. Use a Responses-compatible model supporting structured outputs and its current published pricing. Never paste credentials into chat, screenshots, source or logs.

Run `pnpm cart:evaluate` explicitly when ready. It operates on fictional generated orders at port 5183 and never reads the application's supplier/customer database. Each text-only request reserves a conservative token/price ceiling in the durable `.sites-runtime/cart-ai-evaluation/state.json` ledger before network access. Reservations, including failed or uncertain calls, are not refunded; cumulative reservations cannot exceed $5 across runs. Missing configuration or insufficient budget stops the evaluation. Concurrent evaluators are refused. An interrupted evaluation leaves its lock for inspection rather than automatically clearing it.

The report records each layout/scenario, exact independent cart result, interventions, elapsed time, model and conservative cumulative reserved cost. Actual billing is explicitly unknown. Record a human manual walkthrough in seconds as `PANTRACK_CART_MANUAL_SECONDS` to compare time; without it the comparison remains pending. Credentials, real inference performance, manual time savings and Baldor access remain unproved. C4 and M8 remain open.

Implementation artifacts: [proposal](../openspec/changes/ai-cart-preparation-preview/proposal.md), [design](../openspec/changes/ai-cart-preparation-preview/design.md), [spec](../openspec/changes/ai-cart-preparation-preview/specs/cart-preparation-preview/spec.md), [tasks](../openspec/changes/ai-cart-preparation-preview/tasks.md).
