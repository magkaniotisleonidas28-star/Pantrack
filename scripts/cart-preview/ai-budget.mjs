import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPrivate, writePrivate, profileLock } from '../po-cart-worker/private-files.mjs';

export const budgetFile = resolve('.sites-runtime/cart-ai-budget/ledger.json');
export const legacyBudgetFile = resolve('.sites-runtime/cart-ai-evaluation/state.json');
const ceiling = 5_000_000;
export const budgetCeilingMicros = ceiling;
const count = (n) => Number.isSafeInteger(n) && n >= 0;
// Provider usage can appear on the billing page after a delay. A settlement covers
// only reservations made at least this long before the owner's billing check.
export const billingLagMs = 60 * 60 * 1000;

// A completed reservation's cost from its recorded usage, rounded up per call.
// Rates are USD per million tokens, so tokens × rate is micro-USD.
export function usageMicros(usage, inputRate, outputRate) {
  const input = usage?.inputTokens,
    output = usage?.outputTokens,
    total = usage?.totalTokens ?? 0;
  if (!count(input) || !count(output) || !count(total)) return null;
  return Math.ceil(input * inputRate + Math.max(output, total - input) * outputRate);
}

// Both evaluators use this one ledger. Reservations are never refunded, even on
// refusal, interruption, timeout or a crash before the provider's reply is saved.
// Only an owner's billing settlement replaces completed reservations' amounts.
export class AiBudgetLedger {
  constructor(file = budgetFile, legacy = legacyBudgetFile) {
    this.file = file;
    this.legacy = legacy;
  }

  async locked(fn) {
    const deadline = Date.now() + 5000;
    let release;
    while (!release) {
      try {
        release = profileLock(this.file + '.ownership');
      } catch (e) {
        // A reclamation guard left by a crash requires review. Never remove it.
        if (e.code !== 'EEXIST' && e.message !== 'Account profile is actively owned.') throw e;
        if (Date.now() >= deadline) throw Error('AI budget lock requires local review.');
        await new Promise((ok) => setTimeout(ok, 10));
      }
    }
    try {
      return fn();
    } finally {
      release();
    }
  }

  read() {
    const state = existsSync(this.file)
      ? readPrivate(this.file)
      : { version: 1, legacyReservedMicros: 0, legacyCalls: 0, reservations: [] };
    if (
      state.version !== 1 ||
      !count(state.legacyReservedMicros) ||
      !count(state.legacyCalls) ||
      !Array.isArray(state.reservations) ||
      state.reservations.some((r) => !r.id || !count(r.micros) || r.micros === 0) ||
      !this.settlementsValid(state)
    )
      throw Error('AI budget ledger requires local review.');
    if (existsSync(this.legacy)) {
      const old = readPrivate(this.legacy);
      if (!count(old.reservedMicros) || !count(old.calls))
        throw Error('Legacy AI budget requires local review.');
      // Carry forward the high-water mark, including later legacy reservations.
      state.legacyReservedMicros = Math.max(state.legacyReservedMicros, old.reservedMicros);
      state.legacyCalls = Math.max(state.legacyCalls, old.calls);
    }
    return state;
  }

  // Each settled reservation belongs to exactly one settlement, whose amount is
  // never below its recorded usage or billed total, nor above what it replaced.
  settlementsValid(state) {
    if (state.settlements === undefined) return true;
    if (!Array.isArray(state.settlements) || !state.settlements.length) return false;
    const byId = new Map(state.reservations.map((r) => [r.id, r])),
      settled = new Set();
    for (const t of state.settlements) {
      const ids = t?.reservationIds;
      if (
        typeof t?.id !== 'string' ||
        typeof t.authorizationReference !== 'string' ||
        !t.authorizationReference.trim() ||
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((id) => !byId.has(id) || settled.has(id)) ||
        new Set(ids).size !== ids.length ||
        ![t.reservedMicros, t.usageMicros, t.billedMicros, t.settledMicros].every(count) ||
        t.reservedMicros !== ids.reduce((sum, id) => sum + byId.get(id).micros, 0) ||
        t.settledMicros !== Math.max(t.usageMicros, t.billedMicros) ||
        t.settledMicros > t.reservedMicros
      )
        return false;
      ids.forEach((id) => settled.add(id));
    }
    return true;
  }

  total(state) {
    const settled = new Set((state.settlements ?? []).flatMap((t) => t.reservationIds));
    const n =
      state.legacyReservedMicros +
      state.reservations.reduce((sum, r) => sum + (settled.has(r.id) ? 0 : r.micros), 0) +
      (state.settlements ?? []).reduce((sum, t) => sum + t.settledMicros, 0);
    if (!count(n)) throw Error('Invalid AI budget total.');
    return n;
  }

  // Completed, unsettled reservations of `model` with usable recorded usage, made
  // at least the billing lag before `checkedAt`. Others keep their full amounts.
  settlementPlan(state, { model, inputRate, outputRate, checkedAt }) {
    const at = Date.parse(checkedAt);
    if (!Number.isFinite(at) || at > Date.now()) throw Error('Valid billing check time required.');
    const settled = new Set((state.settlements ?? []).flatMap((t) => t.reservationIds)),
      eligible = state.reservations.filter(
        (r) =>
          !settled.has(r.id) &&
          r.status === 'completed' &&
          r.model === model &&
          Date.parse(r.at) <= at - billingLagMs &&
          usageMicros(r.usage, inputRate, outputRate) !== null,
      );
    return {
      reservationIds: eligible.map((r) => r.id),
      reservedMicros: eligible.reduce((sum, r) => sum + r.micros, 0),
      usageMicros: eligible.reduce(
        (sum, r) => sum + usageMicros(r.usage, inputRate, outputRate),
        0,
      ),
      earliest: eligible[0]?.at ?? null,
      latest: eligible.at(-1)?.at ?? null,
      excluded: state.reservations.length - settled.size - eligible.length,
    };
  }

  async plan(options) {
    return this.locked(() => {
      const s = this.read();
      return {
        ...this.settlementPlan(s, options),
        reservedTotalMicros: this.total(s),
        legacyReservedMicros: s.legacyReservedMicros,
      };
    });
  }

  // Only after the owner checks provider billing and separately authorizes this
  // settlement. A billed total above what it would replace needs review instead.
  async settle({ authorizationReference, billedUsd, ...options }) {
    if (typeof authorizationReference !== 'string' || !authorizationReference.trim())
      throw Error('Explicit settlement authorization reference required.');
    if (!Number.isFinite(billedUsd) || billedUsd < 0) throw Error('Billed total required.');
    const billedMicros = Math.round(billedUsd * 1e6);
    return this.locked(() => {
      const s = this.read(),
        plan = this.settlementPlan(s, options);
      if (!plan.reservationIds.length) throw Error('No completed reservations to settle.');
      if (billedMicros > plan.reservedMicros)
        throw Error('Billed total exceeds the settled reservations; review billing first.');
      const settlement = {
        id: randomUUID(),
        at: new Date().toISOString(),
        authorizationReference,
        billing: { usd: billedUsd, checkedAt: options.checkedAt, lagMs: billingLagMs },
        pricing: {
          model: options.model,
          inputUsdPerMillion: options.inputRate,
          outputUsdPerMillion: options.outputRate,
        },
        reservationIds: plan.reservationIds,
        reservedMicros: plan.reservedMicros,
        usageMicros: plan.usageMicros,
        billedMicros,
        settledMicros: Math.max(plan.usageMicros, billedMicros),
      };
      const before = this.total(s);
      s.settlements = [...(s.settlements ?? []), settlement];
      if (!this.settlementsValid(s)) throw Error('Settlement invalid.');
      writePrivate(this.file, s);
      return { ...settlement, beforeMicros: before, afterMicros: this.total(s) };
    });
  }

  async snapshot() {
    return this.locked(() => {
      const s = this.read();
      writePrivate(this.file, s);
      return { ...s, reservedMicros: this.total(s) };
    });
  }

  // `minimumRemainingMicros` must stay unreserved after this call; zero by default.
  async reserve(micros, metadata = {}, { minimumRemainingMicros = 0 } = {}) {
    if (!count(minimumRemainingMicros)) throw Error('Invalid AI budget floor.');
    return this.locked(() => {
      const s = this.read();
      if (!count(micros) || micros === 0 || this.total(s) + micros > ceiling)
        throw Error('The cumulative $5 AI evaluation budget cannot cover another call.');
      if (this.total(s) + micros + minimumRemainingMicros > ceiling) throw Error('AI_BUDGET_FLOOR');
      const reservation = {
        ...metadata,
        id: randomUUID(),
        micros,
        at: new Date().toISOString(),
        status: 'reserved',
      };
      s.reservations.push(reservation);
      writePrivate(this.file, s);
      return reservation.id;
    });
  }

  async complete(id, usage) {
    return this.locked(() => {
      const s = this.read(),
        r = s.reservations.find((r) => r.id === id);
      if (!r) throw Error('Missing AI reservation.');
      r.status = 'completed';
      r.usage = usage;
      writePrivate(this.file, s);
    });
  }
}
