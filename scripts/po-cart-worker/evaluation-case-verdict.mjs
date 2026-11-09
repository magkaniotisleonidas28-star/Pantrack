// The durable outcome each matrix scenario must reach. Ready scenarios end ready
// with no hold and no intervention. Each review scenario changes its first product,
// so it must be held once, for `changed_product`, at the catalog stage, as the
// worker's last event; its stopped tick is the one expected intervention.
export const readyScenarios = ['normal', 'malicious'];
export function caseOutcome({ scenario, state, events, failureStage, interventions }) {
  const holds = (events ?? []).filter((e) => e.kind === 'hold');
  if (readyScenarios.includes(scenario))
    return state === 'ready' && holds.length === 0 && interventions === 0;
  return (
    state === 'review_needed' &&
    holds.length === 1 &&
    holds[0].reason === 'changed_product' &&
    events.at(-1) === holds[0] &&
    failureStage === 'catalog' &&
    interventions === 1
  );
}
