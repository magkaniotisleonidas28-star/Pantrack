'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Clock, Plug, TrendingUp } from 'lucide-react';
import { useRequestScope } from '@/hooks/use-request-scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InventoryManagementView } from '@/lib/inventory-management-contract';
import SalesExceptions from './sales-exceptions';
import {
  CloverStatusPill,
  CloverUnlinkedBanner,
  useCloverSalesStatus,
} from './clover-sales-status';
import { salesSections, type SalesSection } from './workspace-navigation';

type Recipe = { id: string; name: string };
type SalesImport = { reference: string; created: string };
type SalesEvent = {
  eventKey: string;
  state: string;
  occurredAt: string;
  provider?: string;
  externalReference?: string;
};

const stateLabels: Record<string, string> = {
  received: 'Received',
  processing: 'Processing',
  applied: 'Stock updated',
  held: 'Needs review',
  failed: 'Failed',
  dismissed: 'Dismissed',
  superseded: 'Replaced',
};

const upcoming = [
  {
    icon: TrendingUp,
    title: 'Best sellers and slow movers',
    text: 'See which menu items sell most and least, week by week.',
  },
  {
    icon: Clock,
    title: 'Busy days and hours',
    text: 'Spot your busiest times to plan prep and staffing.',
  },
  {
    icon: BarChart3,
    title: 'Ordering from sales',
    text: 'Suggested orders that follow what you actually sell.',
  },
  {
    icon: Plug,
    title: 'Automatic register sync',
    text: 'Sales arrive from your register on their own, with no file uploads.',
  },
];

/**
 * Sales recording and history, separate from recipe management. The exact
 * inventory preview records sales through its existing reviewed sales flow;
 * otherwise the original batch import is used.
 */
export default function SalesPanel({
  companyId,
  role,
  section,
  onInventoryChanged,
  onSection,
}: {
  companyId: string;
  role: string;
  section: SalesSection;
  onInventoryChanged: () => void;
  onSection?: (section: SalesSection) => void;
}) {
  const clover = useCloverSalesStatus(companyId, role === 'owner');
  const showClover = !!clover.status && (clover.status.connected || clover.status.ready);
  const [recipes, setRecipes] = useState<Recipe[]>([]),
    [imports, setImports] = useState<SalesImport[]>([]),
    [exact, setExact] = useState<InventoryManagementView | null>(null),
    [events, setEvents] = useState<SalesEvent[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reference, setReference] = useState(''),
    [sales, setSales] = useState<Record<string, number>>({});
  const lock = useRef(false);
  const beginRequest = useRequestScope(companyId);
  const call = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      const r = await fetch(
        '/api/' + path + '?companyId=' + encodeURIComponent(companyId),
        body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...body, companyId }),
            }
          : undefined,
      );
      const d = (await r.json()) as {
        error?: string;
        recipes?: Recipe[];
        imports?: SalesImport[];
        exactEnabled?: boolean;
        exact?: InventoryManagementView | null;
        events?: SalesEvent[];
        replayed?: boolean;
      };
      if (!r.ok) throw new Error(d.error || 'Request failed');
      return d;
    },
    [companyId],
  );
  const load = useCallback(() => {
    const current = beginRequest();
    return Promise.all([call('sales'), call('inventory')])
      .then(async ([s, i]) => {
        const exactView = i.exactEnabled === true ? (i.exact ?? null) : null;
        const history = exactView && section === 'history' ? await call('sales/events') : null;
        if (!current()) return;
        setRecipes(s.recipes || []);
        setImports(s.imports || []);
        setExact(exactView);
        setEvents(history?.events || []);
      })
      .catch((e) => {
        if (current()) setError((e as Error).message);
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
  }, [call, beginRequest, section]);
  useEffect(() => {
    void load();
  }, [load]);

  function loadCsv(text: string) {
    try {
      const rows = text.trim().split(/\r?\n/);
      if (rows.shift()?.trim().toLowerCase() !== 'recipe_id,quantity')
        throw new Error('The file’s first line must be recipe_id,quantity.');
      const next: Record<string, number> = {};
      for (const row of rows) {
        const parts = row.trim().split(','),
          n = Number(parts[1]);
        if (
          parts.length !== 2 ||
          !recipes.some((r) => r.id === parts[0]) ||
          !Number.isInteger(n) ||
          n < 1 ||
          n > 10000
        )
          throw new Error('Each row needs a known recipe ID and a whole number from 1 to 10000.');
        next[parts[0]] = (next[parts[0]] || 0) + n;
        if (next[parts[0]] > 10000) throw new Error('A recipe’s total is over 10000.');
      }
      setSales(next);
      setNotice('File loaded. Check the numbers, add a name for this batch, then save.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const d = await call('sales', {
        action: 'import',
        reference,
        lines: Object.entries(sales)
          .filter(([, q]) => q > 0)
          .map(([recipeId, quantity]) => ({ recipeId, quantity })),
      });
      setNotice(
        d.replayed
          ? 'These sales were already saved under that name, so stock wasn’t changed again.'
          : 'Sales saved. Stock estimates are updated.',
      );
      setSales({});
      setReference('');
      onInventoryChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const label = salesSections.find((item) => item.id === section)?.label;
  const exactRecipes = exact
    ? exact.recipes
        .filter((version) => version.status === 'active')
        .map((version) => ({
          ...version,
          modifiers: exact.modifiers.filter(
            (m) => m.recipeId === version.recipeId && m.status === 'active',
          ),
        }))
    : [];
  return (
    <section className="sales-panel" aria-busy={loading}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Sales</div>
          <h1>{label}</h1>
        </div>
        {showClover && clover.status && (
          <CloverStatusPill
            companyId={companyId}
            status={clover.status}
            onChanged={clover.reload}
          />
        )}
      </div>
      {showClover && clover.status?.connected && (
        <CloverUnlinkedBanner
          companyId={companyId}
          status={clover.status}
          onChanged={clover.reload}
          onReviewPaused={() => {
            if (section === 'record')
              document.querySelector('.sales-entry')?.scrollIntoView({ behavior: 'smooth' });
            else onSection?.('record');
          }}
        />
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {loading && section !== 'insights' && <p role="status">Loading sales…</p>}
      {!loading && section === 'record' && exact && (
        <SalesExceptions
          companyId={companyId}
          role={role}
          recipes={exactRecipes}
          onInventoryReload={async () => {
            onInventoryChanged();
            await load();
          }}
        />
      )}
      {!loading && section === 'record' && !exact && (
        <div className="catalog-card sales-batch-form">
          {!recipes.length ? (
            <p>Add a recipe first (Inventory → Recipes), so Pantrack knows what each item uses.</p>
          ) : (
            <>
              <label>
                Name this batch
                <Input
                  value={reference}
                  maxLength={100}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. Register 1, Monday close"
                />
              </label>
              <small>Each name can be used once, so the same sales are never counted twice.</small>
              {recipes.map((r) => (
                <label className="sales-quantity" key={r.id}>
                  {r.name}
                  <Input
                    aria-label={'Number sold: ' + r.name}
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                    value={sales[r.id] || 0}
                    onChange={(e) => setSales({ ...sales, [r.id]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <label className="csv-picker">
                Or load a file from your register
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (f.size > 100000) {
                      setError('The file must be under 100 KB.');
                      return;
                    }
                    loadCsv(await f.text());
                  }}
                />
              </label>
              <small>File columns: recipe_id,quantity · up to 20 menu items per batch.</small>
              <Button
                disabled={busy || !reference.trim() || !Object.values(sales).some((q) => q > 0)}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save sales'}
              </Button>
            </>
          )}
        </div>
      )}
      {!loading && section === 'history' && (
        <div className="catalog-card">
          {exact ? (
            events.length ? (
              <ul className="sales-history">
                {events.map((event) => (
                  <li key={event.eventKey}>
                    <span>
                      <strong>{stateLabels[event.state] ?? event.state}</strong>
                      {(event.provider || event.externalReference) && (
                        <small>
                          {[event.provider, event.externalReference].filter(Boolean).join(' · ')}
                        </small>
                      )}
                    </span>
                    <small>{new Date(event.occurredAt).toLocaleString()}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No sales recorded yet.</p>
            )
          ) : imports.length ? (
            <ul className="sales-history">
              {imports.map((i) => (
                <li key={i.reference}>
                  <strong>{i.reference}</strong>
                  <small>{new Date(i.created).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No sales saved yet.</p>
          )}
        </div>
      )}
      {section === 'insights' && (
        <div className="catalog-grid">
          {upcoming.map(({ icon: Icon, title, text }) => (
            <article className="catalog-card coming-soon-card" key={title}>
              <Icon size={24} />
              <span className="soon-badge">Coming soon</span>
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
