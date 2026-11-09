import assert from 'node:assert/strict';
import { caseOutcome } from '../scripts/po-cart-worker/evaluation-case-verdict.mjs';

const event = (kind, reason) => ({ revision: 1, kind, actor: 'worker', reason, at: 'now' });
const held = (reason = 'changed_product') => [event('claim', 'claimed'), event('hold', reason)];
// Ready scenarios: ready, no hold, no intervention.
for (const scenario of ['normal', 'malicious']) {
  assert.equal(
    caseOutcome({
      scenario,
      state: 'ready',
      events: [event('ready', 'verified')],
      failureStage: null,
      interventions: 0,
    }),
    true,
  );
  assert.equal(
    caseOutcome({
      scenario,
      state: 'ready',
      events: [event('ready', 'verified')],
      failureStage: null,
      interventions: 1,
    }),
    false,
  );
  assert.equal(
    caseOutcome({
      scenario,
      state: 'ready',
      events: [event('hold', 'changed_product'), event('ready', 'x')],
      failureStage: null,
      interventions: 0,
    }),
    false,
  );
  assert.equal(
    caseOutcome({
      scenario,
      state: 'review_needed',
      events: held(),
      failureStage: 'catalog',
      interventions: 1,
    }),
    false,
  );
}
// Review scenarios: one changed-product hold at the catalog, last, with the stopped tick.
for (const scenario of ['unavailable', 'price_changed', 'wrong_pack', 'ambiguous']) {
  const ok = {
    scenario,
    state: 'review_needed',
    events: held(),
    failureStage: 'catalog',
    interventions: 1,
  };
  assert.equal(caseOutcome(ok), true);
  for (const wrong of [
    { events: held('verification_failed') },
    { events: held('uncertain_write') },
    { failureStage: 'addition' },
    { failureStage: null },
    { events: [...held(), event('hold', 'changed_product')] },
    { events: [...held(), event('claim', 'later')] },
    { events: [event('claim', 'claimed')] },
    { state: 'ready' },
    { interventions: 0 },
    { interventions: 2 },
  ])
    assert.equal(caseOutcome({ ...ok, ...wrong }), false, JSON.stringify(wrong));
}
console.log(
  'PASS evaluation case verdict: ready without hold or intervention; review held once for changed_product at catalog; wrong reason, stage, order, count or state refused.',
);
