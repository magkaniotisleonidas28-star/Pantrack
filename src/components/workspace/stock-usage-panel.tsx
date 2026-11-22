'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExactQuantity } from '@/lib/inventory-consumption-contract';
import type { ManagedInventoryRecord } from '@/lib/inventory-management-contract';
import type { Product } from '@/lib/pantry';
import {
  MIN_COUNT_DAYS,
  MIN_HISTORY_DAYS,
  unrecordedWording,
  usageStatusWording,
  type ProductUsage,
} from '@/lib/stock-usage';
import type { StockLevelsView } from '@/lib/d1-stock-levels';
import type { Caution, LevelSuggestion } from '@/lib/stock-levels';
import { Button } from '@/components/ui/button';
import { formatEveryday, friendlyContainers, type MeasurementSystem } from '@/lib/unit-preferences';
import { StockSearch } from './inventory-layout';
import './stock-usage-panel.css';

const absolute = (q: ExactQuantity): ExactQuantity => ({ ...q, minor: q.minor.replace(/^-/, '') });

// Daily amounts are estimates, so amounts of 10 or more drop their decimals: "about 130 fl oz".
const rough = (text: string) =>
  text.replace(/^(\d+)\.\d+/, (whole, units) => (Number(units) >= 10 ? units : whole));

function amount(q: ExactQuantity, system: MeasurementSystem, record?: ManagedInventoryRecord) {
  const everyday = rough(formatEveryday(q, system));
  const containers = record?.purchase
    ? friendlyContainers(q, record.purchase.quantity, record.purchase.label)
    : '';
  return containers ? `${everyday} (${containers})` : everyday;
}

function lastCount(usage: ProductUsage, system: MeasurementSystem) {
  const latest = usage.recentCounts[0];
  if (!latest) return { text: 'No count since the first', detail: '' };
  const percent = latest.differencePercent;
  const off = latest.difference.minor.startsWith('-') ? 'less' : 'more';
  return {
    text:
      latest.difference.minor === '0'
        ? 'As expected'
        : `Found ${formatEveryday(absolute(latest.difference), system)} ${off} than expected` +
          (percent === null ? '' : ` (${percent > 0 ? '+' : ''}${percent}%)`),
    detail: new Date(latest.effectiveAt).toLocaleDateString(),
  };
}

function statusDetail(usage: ProductUsage) {
  if (usage.status === 'needs_counts')
    return `${usage.countedDays} of ${MIN_COUNT_DAYS} days between counts so far`;
  if (usage.status === 'needs_history')
    return `${usage.historyDays} of ${MIN_HISTORY_DAYS} days recorded so far`;
  return `Counts cover ${usage.countedDays} days`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** R1e: why Pantrack suggests this level, in plain words. */
function explanation(
  s: LevelSuggestion,
  system: MeasurementSystem,
  record?: ManagedInventoryRecord,
) {
  if (!s.level || !s.perDay || !s.supplier || s.coverDays === null || !s.spare) return '';
  const delivery =
    s.supplier.deliveryDays === 0
      ? 'delivers the same day you order'
      : `delivers ${plural(s.supplier.deliveryDays, 'day')} after you order`;
  const parts = [
    `You use about ${rough(formatEveryday(s.perDay, system))} a day. ${s.supplier.supplierName} ${delivery}, and you order every ${plural(s.supplier.orderEveryDays, 'day')}, so stock needs to last ${plural(s.coverDays, 'day')}.`,
    s.spare.minor === '0'
      ? 'Your use is steady, so no spare is added.'
      : `About ${amount(s.spare, system, record)} of that is spare, for days busier than usual.`,
  ];
  if (s.unrecordedPercent !== null && s.unrecordedPercent > 2)
    parts.push(
      `Your counts show about ${s.unrecordedPercent}% more is used than recorded; that is included.`,
    );
  if (s.runOutReports > 0)
    parts.push(
      `It ran out ${s.runOutReports === 1 ? 'once' : plural(s.runOutReports, 'time')} in the last 4 weeks, so extra spare is included.`,
    );
  parts.push(
    `Spare is sized to run short about ${cautionLabels[s.appliedCaution].odds} (${cautionLabels[s.appliedCaution].name}).`,
  );
  if (s.supplierCount > 1)
    parts.push(
      `This uses ${s.supplier.supplierName}'s schedule, the longest of this product's ${s.supplierCount} suppliers.`,
    );
  return parts.join(' ');
}

const cautionLabels: Record<Caution, { name: string; odds: string; hint: string }> = {
  lean: {
    name: 'Lean',
    odds: '1 delivery in 7',
    hint: 'Less stock and waste; runs short more often',
  },
  balanced: { name: 'Balanced', odds: '1 delivery in 20', hint: 'Runs short only now and then' },
  cautious: {
    name: 'Cautious',
    odds: '1 delivery in 100',
    hint: 'Rarely runs short; more on the shelf',
  },
};

const waiting: Record<Exclude<LevelSuggestion['status'], 'suggested'>, string> = {
  needs_history: 'A suggestion needs the history described above.',
  no_use: 'No use has been measured yet.',
  needs_supplier: 'Link this product to a supplier under Purchasing suppliers to get a suggestion.',
  needs_schedule: "Add a delivery schedule to this product's supplier under Purchasing suppliers.",
};

/** R1b: real use compared with recorded use per product; R1e: a suggested level to accept. */
export default function StockUsagePanel({
  companyId,
  products,
  records,
  system,
  active,
  reloadKey,
  canManage,
}: {
  companyId: string;
  products: Product[];
  records: ManagedInventoryRecord[];
  system: MeasurementSystem;
  active: boolean;
  reloadKey: string;
  canManage: boolean;
}) {
  const [refresh, setRefresh] = useState(0);
  const key = companyId + '|' + reloadKey + '|' + refresh;
  const [result, setResult] = useState<{ key: string; view?: StockLevelsView; error?: string }>();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(''),
    [saved, setSaved] = useState<{ productId: string; text: string; kind: 'ok' | 'error' } | null>(
      null,
    );
  const operations = useRef(new Map<string, string>());
  // Caution and Ignore are plain settings: sending the same choice twice changes nothing more.
  async function change(productId: string, body: Record<string, unknown>, done: string) {
    if (saving) return;
    setSaving(productId);
    setSaved(null);
    try {
      const response = await fetch('/api/inventory/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, productId, ...body }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not save. Please retry.');
      setSaved({ productId, kind: 'ok', text: done });
    } catch (error) {
      setSaved({ productId, kind: 'error', text: (error as Error).message });
    } finally {
      setSaving('');
      setRefresh((n) => n + 1);
    }
  }
  async function accept(s: LevelSuggestion) {
    if (!s.level || saving) return;
    const reference = operations.current.get(s.productId) ?? crypto.randomUUID();
    operations.current.set(s.productId, reference);
    setSaving(s.productId);
    setSaved(null);
    try {
      const response = await fetch('/api/inventory/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept',
          companyId,
          productId: s.productId,
          operationId: reference,
          expectedLevelMinor: s.level.minor,
          expectedSettingsVersion: result?.view?.settingsVersions[s.productId] ?? 0,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      // A definite answer frees the reference; an uncertain one keeps it for the retry.
      if (response.status < 500) operations.current.delete(s.productId);
      if (!response.ok) throw new Error(body.error || 'Could not save. Please retry.');
      setSaved({
        productId: s.productId,
        kind: 'ok',
        text: 'Saved. This is now the level Pantrack plans for.',
      });
      setRefresh((n) => n + 1);
    } catch (error) {
      setSaved({ productId: s.productId, kind: 'error', text: (error as Error).message });
      setRefresh((n) => n + 1);
    } finally {
      setSaving('');
    }
  }
  useEffect(() => {
    if (!active) return;
    let current = true;
    fetch('/api/inventory/levels?companyId=' + encodeURIComponent(companyId), {
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as StockLevelsView & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || 'Could not load usage. Please retry.');
        if (current) setResult({ key, view: body });
      })
      .catch((error: Error) => {
        if (current) setResult({ key, error: error.message });
      });
    return () => {
      current = false;
    };
  }, [active, companyId, key]);
  const loading = result?.key !== key;
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const suggestion = (id: string) => result?.view?.suggestions.find((s) => s.productId === id);
  const shown = (result?.view?.usage.products ?? []).filter((usage) =>
    name(usage.productId).toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section className="stock-usage" aria-busy={loading}>
      <div className="inventory-section-heading">
        <div>
          <h2>How much is really used</h2>
          <p>
            Pantrack compares what your counts show was really used with what it recorded from
            sales, waste and manual use over the last 8 weeks, and suggests how much of each product
            to keep. Nothing changes unless an owner or manager chooses Use this level.
          </p>
        </div>
      </div>
      {result?.view && (
        <div className="stock-caution" role="group" aria-labelledby="stock-caution-title">
          <h3 id="stock-caution-title">How careful should suggestions be?</h3>
          {canManage ? (
            <div className="stock-caution-choices">
              {(['lean', 'balanced', 'cautious'] as const).map((c) => (
                <label key={c} data-selected={result.view!.caution === c}>
                  <input
                    type="radio"
                    name="stock-caution"
                    checked={result.view!.caution === c}
                    disabled={!!saving}
                    onChange={() =>
                      void change('*', { action: 'set_caution', caution: c }, 'Saved for the café.')
                    }
                  />
                  <span>
                    <strong>{cautionLabels[c].name}</strong>
                    <small>
                      {cautionLabels[c].hint} (about {cautionLabels[c].odds})
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p>Suggestions use the {cautionLabels[result.view.caution].name} setting.</p>
          )}
          {saved?.productId === '*' && (
            <p role={saved.kind === 'error' ? 'alert' : 'status'} data-kind={saved.kind}>
              {saved.text}
            </p>
          )}
        </div>
      )}
      <StockSearch value={search} onChange={setSearch} />
      {result?.error && !loading && (
        <div role="alert" className="error">
          {result.error}
        </div>
      )}
      {loading && <p className="stock-usage-empty">Loading usage…</p>}
      {!loading && result?.view && !shown.length && (
        <p className="stock-usage-empty">
          {search ? 'No products match your search.' : 'No products have stock set up yet.'}
        </p>
      )}
      {!loading && shown.length > 0 && (
        <ul className="stock-usage-list">
          {shown.map((usage) => {
            const record = records.find((r) => r.productId === usage.productId);
            const count = lastCount(usage, system);
            return (
              <li key={usage.productId} data-status={usage.status}>
                <h3>{name(usage.productId)}</h3>
                <dl>
                  <div>
                    <dt>Everyday use</dt>
                    <dd>
                      {usage.dailyUse
                        ? `${amount(usage.dailyUse.perDay, system, record)} a day`
                        : '—'}
                      <small>
                        {usage.dailyUse?.source === 'counts'
                          ? 'Measured from your counts'
                          : usage.dailyUse
                            ? 'From recorded sales and waste; not yet checked by counts'
                            : 'Nothing recorded yet'}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Not recorded</dt>
                    <dd>
                      {unrecordedWording(usage.unrecordedPercent)}
                      {usage.measuredPerDay && usage.recordedPerDay && (
                        <small>
                          Really used {rough(formatEveryday(usage.measuredPerDay, system))} a day;
                          recorded {rough(formatEveryday(usage.recordedPerDay, system))} a day
                        </small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Last count</dt>
                    <dd>
                      {count.text}
                      {count.detail && <small>{count.detail}</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>History</dt>
                    <dd>
                      {usageStatusWording[usage.status]}
                      <small>{statusDetail(usage)}</small>
                    </dd>
                  </div>
                </dl>
                {(() => {
                  const level = suggestion(usage.productId);
                  if (!level) return null;
                  const same = !!level.level && level.current?.minor === level.level.minor;
                  const ignored = !!result?.view?.ignored[usage.productId];
                  return (
                    <div className="stock-level" data-status={level.status}>
                      <h4>Suggested level</h4>
                      {level.status === 'suggested' && level.level ? (
                        <>
                          <p className="stock-level-headline">
                            Keep about {amount(level.level, system, record)}
                            {level.current
                              ? same
                                ? ' — your level already matches'
                                : ` (now ${amount(level.current, system, record)})`
                              : ' (no level set yet)'}
                          </p>
                          {ignored ? (
                            <p>
                              You chose to ignore this suggestion. It shows again when the numbers
                              change.
                            </p>
                          ) : (
                            <p>{explanation(level, system, record)}</p>
                          )}
                          {canManage && !same && (
                            <div className="stock-level-actions">
                              {ignored ? (
                                <Button
                                  variant="outline"
                                  disabled={!!saving}
                                  onClick={() =>
                                    void change(
                                      usage.productId,
                                      { action: 'unignore' },
                                      'Showing the suggestion again.',
                                    )
                                  }
                                >
                                  Show it again
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="outline"
                                    disabled={!!saving}
                                    onClick={() => void accept(level)}
                                  >
                                    {saving === usage.productId ? 'Saving…' : 'Use this level'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={!!saving}
                                    onClick={() =>
                                      void change(
                                        usage.productId,
                                        {
                                          action: 'ignore',
                                          expectedLevelMinor: level.level!.minor,
                                        },
                                        'Ignored until the numbers change.',
                                      )
                                    }
                                  >
                                    Ignore
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <p>{waiting[level.status as keyof typeof waiting]}</p>
                      )}
                      {canManage && (
                        <label className="stock-level-caution">
                          Caution for this product
                          <select
                            value={result?.view?.productCautions[usage.productId] ?? 'cafe'}
                            disabled={!!saving}
                            onChange={(e) =>
                              void change(
                                usage.productId,
                                { action: 'set_caution', caution: e.target.value },
                                'Caution saved for this product.',
                              )
                            }
                          >
                            <option value="cafe">
                              Café setting ({cautionLabels[result!.view!.caution].name})
                            </option>
                            {(['lean', 'balanced', 'cautious'] as const).map((c) => (
                              <option key={c} value={c}>
                                {cautionLabels[c].name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {saved?.productId === usage.productId && (
                        <p
                          role={saved.kind === 'error' ? 'alert' : 'status'}
                          data-kind={saved.kind}
                        >
                          {saved.text}
                        </p>
                      )}
                    </div>
                  );
                })()}
                {usage.unexplainedIncreases > 0 && (
                  <p className="stock-usage-note">
                    {usage.unexplainedIncreases === 1
                      ? 'One count found more than deliveries explain'
                      : `${usage.unexplainedIncreases} counts found more than deliveries explain`}
                    , so it was left out. Check for a delivery that wasn’t recorded.
                  </p>
                )}
                {usage.recentCounts.length > 1 && (
                  <details>
                    <summary>Recent counts</summary>
                    <ul>
                      {usage.recentCounts.map((c) => (
                        <li key={c.effectiveAt}>
                          <span>{new Date(c.effectiveAt).toLocaleDateString()}</span>
                          <span>
                            Expected {formatEveryday(c.estimate, system)}, found{' '}
                            {formatEveryday(c.measured, system)}
                            {c.differencePercent !== null &&
                              ` (${c.differencePercent > 0 ? '+' : ''}${c.differencePercent}%)`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
