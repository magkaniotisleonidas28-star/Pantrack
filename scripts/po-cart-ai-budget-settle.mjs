import { isAbsolute } from 'node:path';
import { AiBudgetLedger } from './cart-preview/ai-budget.mjs';
import { validatePricing } from './po-cart-worker/metadata-allowance.mjs';
import { readPrivate } from './po-cart-worker/private-files.mjs';

// Owner billing settlement of the shared AI budget ledger. Contacts no provider.
//   plan --billing-checked-at ISO        read-only: what a settlement would cover
//   apply --billing-checked-at ISO --billed-usd N --approval-file P --pricing-file P
//                                        only after the owner compared provider
//                                        billing and separately authorized it
const usage = Error('Use `plan` or `apply` with the documented flags and absolute paths.');
const modes = {
  plan: ['--billing-checked-at'],
  apply: ['--billing-checked-at', '--billed-usd', '--approval-file', '--pricing-file'],
};
const [mode, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(modes, mode)) throw usage;
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  const [flag, value] = [rest[i], rest[i + 1]];
  if (!modes[mode].includes(flag) || Object.hasOwn(args, flag) || !value) throw usage;
  if (flag.endsWith('-file') && !isAbsolute(value)) throw usage;
  args[flag] = value;
}
if (modes[mode].some((f) => !args[f])) throw usage;
if (!/^\d+(\.\d{1,6})?$/.test(args['--billed-usd'] ?? '0')) throw usage;

const ledger = new AiBudgetLedger(),
  checkedAt = args['--billing-checked-at'];
const usd = (micros) => micros / 1e6;
if (mode === 'plan') {
  const p = await ledger.plan({
    model: 'gpt-5.4-mini-2026-03-17',
    inputRate: 0.75,
    outputRate: 4.5,
    checkedAt,
  });
  console.log(
    JSON.stringify(
      {
        reservations: p.reservationIds.length,
        earliest: p.earliest,
        latest: p.latest,
        reservedUsd: usd(p.reservedMicros),
        recordedUsageUsd: usd(p.usageMicros),
        unsettledExcluded: p.excluded,
        ledgerReservedUsd: usd(p.reservedTotalMicros),
      },
      null,
      1,
    ),
  );
} else {
  const pricing = readPrivate(args['--pricing-file']),
    { authorizationReference } = readPrivate(args['--approval-file']);
  validatePricing(pricing);
  const t = await ledger.settle({
    authorizationReference,
    billedUsd: Number(args['--billed-usd']),
    model: pricing.model,
    inputRate: pricing.inputUsdPerMillion,
    outputRate: pricing.outputUsdPerMillion,
    checkedAt,
  });
  console.log(
    JSON.stringify(
      {
        settlement: t.id,
        reservations: t.reservationIds.length,
        reservedUsd: usd(t.reservedMicros),
        recordedUsageUsd: usd(t.usageMicros),
        billedUsd: usd(t.billedMicros),
        settledUsd: usd(t.settledMicros),
        ledgerBeforeUsd: usd(t.beforeMicros),
        ledgerAfterUsd: usd(t.afterMicros),
      },
      null,
      1,
    ),
  );
}
