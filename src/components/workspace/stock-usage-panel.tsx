'use client';
import { useEffect, useState } from 'react';
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
import type { StockUsageView } from '@/lib/d1-stock-usage';
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

/** R1b: read-only comparison of real use (from counts) with recorded use, per product. */
export default function StockUsagePanel({
  companyId,
  products,
  records,
  system,
  active,
  reloadKey,
}: {
  companyId: string;
  products: Product[];
  records: ManagedInventoryRecord[];
  system: MeasurementSystem;
  active: boolean;
  reloadKey: string;
}) {
  const key = companyId + '|' + reloadKey;
  const [result, setResult] = useState<{ key: string; view?: StockUsageView; error?: string }>();
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!active) return;
    let current = true;
    fetch('/api/inventory/usage?companyId=' + encodeURIComponent(companyId), {
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as StockUsageView & {
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
  const shown = (result?.view?.products ?? []).filter((usage) =>
    name(usage.productId).toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section className="stock-usage" aria-busy={loading}>
      <div className="inventory-section-heading">
        <div>
          <h2>How much is really used</h2>
          <p>
            Pantrack compares what your counts show was really used with what it recorded from
            sales, waste and manual use over the last 8 weeks. This is read only: nothing here
            changes stock or orders.
          </p>
        </div>
      </div>
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
