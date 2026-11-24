'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  PackageX,
  PauseCircle,
  Settings2,
  ShoppingBag,
  TrendingDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { money, type Order, type Product } from '@/lib/pantry';
import { stockState, type StockState } from '@/lib/stock-status';
import { timeAgo, unlinkedHeadline, type UnlinkedCloverSummary } from '@/lib/clover-unlinked';
import { useLevelTargets } from './use-level-targets';
import './home-stock.css';

type StockRecord = {
  productId: string;
  version: number;
  onHand: { minor: string };
  latestCountEffectiveAt: string | null;
};
type Clover = {
  connected: boolean;
  syncEnabled: boolean;
  sync?: { lastSuccess?: string | null; heldCount?: number } | null;
  unlinked?: UnlinkedCloverSummary | null;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** a home page with today's key figures and a to-do list. */
export default function HomePanel({
  companyId,
  companyName,
  email,
  role,
  products,
  orders,
  draftCount,
  refreshKey,
  onNavigate,
}: {
  companyId: string;
  companyName: string;
  email: string;
  role: string;
  products: Product[];
  orders: Order[];
  draftCount: number;
  refreshKey: number;
  onNavigate: (tab: string) => void;
}) {
  const [records, setRecords] = useState<StockRecord[] | null>(null);
  const [runOuts, setRunOuts] = useState(0);
  const [paused, setPaused] = useState<number | null>(null);
  const [clover, setClover] = useState<Clover | null>(null);
  const [now] = useState(() => Date.now());
  const canManage = role === 'owner' || role === 'manager';
  const id = encodeURIComponent(companyId);
  useEffect(() => {
    let live = true;
    void Promise.all([
      getJson<{ exact?: { records: StockRecord[] } | null }>('/api/inventory?companyId=' + id),
      getJson<{ open: unknown[] }>('/api/inventory/run-out?companyId=' + id),
      canManage
        ? getJson<{ events: Array<{ state: string }> }>('/api/sales/events?companyId=' + id)
        : null,
      role === 'owner' ? getJson<Clover>('/api/clover?companyId=' + id) : null,
    ]).then(([inventory, reports, sales, connection]) => {
      if (!live) return;
      setRecords(inventory?.exact?.records ?? []);
      setRunOuts(reports?.open.length ?? 0);
      setPaused(sales ? sales.events.filter((event) => event.state === 'held').length : null);
      setClover(connection);
    });
    return () => {
      live = false;
    };
  }, [id, canManage, role, refreshKey]);
  const targets = useLevelTargets(companyId, refreshKey);
  const counts = useMemo(() => {
    const result: Record<StockState, number> = { setup: 0, out: 0, low: 0, count_due: 0, ok: 0 };
    if (!records) return result;
    for (const product of products) {
      const record = records.find((value) => value.productId === product.id);
      result[stockState(record, targets[product.id], now)]++;
    }
    return result;
  }, [records, products, targets, now]);
  const loading = records === null;
  const figures: Array<{
    label: string;
    value: number | null;
    tone: StatusTone;
    icon: typeof PackageX;
    tab: string;
    hint: string;
  }> = [
    {
      label: 'Out of stock',
      value: counts.out,
      tone: 'bad',
      icon: PackageX,
      tab: 'inventory',
      hint: 'products at zero',
    },
    {
      label: 'Running low',
      value: counts.low,
      tone: 'warn',
      icon: TrendingDown,
      tab: 'inventory',
      hint: 'under 30% of their level',
    },
    {
      label: 'Counts due',
      value: counts.count_due,
      tone: 'warn',
      icon: ClipboardList,
      tab: 'inventory',
      hint: 'not counted in 7 days',
    },
    {
      label: 'Paused sales',
      value: paused,
      tone: 'warn',
      icon: PauseCircle,
      tab: 'sales',
      hint: 'waiting for review',
    },
    {
      label: 'Run-out reports',
      value: runOuts,
      tone: 'bad',
      icon: AlertTriangle,
      tab: 'inventory',
      hint: 'from your team',
    },
  ];
  const todo = [
    runOuts > 0 && {
      key: 'runout',
      title: `Review ${runOuts} run-out report${runOuts === 1 ? '' : 's'}`,
      detail: 'Confirm none is left, or dismiss.',
      time: '1 min',
      tab: 'inventory',
      action: 'Review',
    },
    counts.out > 0 && {
      key: 'out',
      title: `${counts.out} product${counts.out === 1 ? ' is' : 's are'} out`,
      detail: 'Add them to your next order.',
      time: '2 min',
      tab: 'order',
      action: 'Order',
    },
    counts.count_due > 0 && {
      key: 'count',
      title: `Count ${counts.count_due} product${counts.count_due === 1 ? '' : 's'}`,
      detail: 'Not counted in the last 7 days.',
      time: `${Math.max(2, counts.count_due)} min`,
      tab: 'inventory',
      action: 'Count',
    },
    !!clover?.unlinked?.entries.length && {
      key: 'clover-links',
      title: unlinkedHeadline(clover.unlinked.entries),
      detail: `Link them so ${clover.unlinked.waitingSales} paused sale${clover.unlinked.waitingSales === 1 ? '' : 's'} can come off stock.`,
      time: `${Math.max(2, clover.unlinked.entries.length)} min`,
      tab: 'sales',
      action: 'Link',
    },
    paused &&
      paused > 0 && {
        key: 'paused',
        title: `Review ${paused} paused sale${paused === 1 ? '' : 's'}`,
        detail: 'Nothing was taken from stock yet.',
        time: '3 min',
        tab: 'sales',
        action: 'Review',
      },
    counts.setup > 0 &&
      canManage && {
        key: 'setup',
        title: `Set up ${counts.setup} product${counts.setup === 1 ? '' : 's'}`,
        detail: 'How it comes, then how much you have.',
        time: `${counts.setup} min`,
        tab: 'inventory',
        action: 'Set up',
      },
    draftCount > 0 && {
      key: 'draft',
      title: `Finish your order`,
      detail: `${draftCount} product${draftCount === 1 ? '' : 's'} in your draft.`,
      time: '2 min',
      tab: 'order',
      action: 'Open',
    },
  ].filter(Boolean) as Array<{
    key: string;
    title: string;
    detail: string;
    time: string;
    tab: string;
    action: string;
  }>;
  const today = new Date(now);
  const name = email.split('@')[0];
  return (
    <section className="home-panel" aria-labelledby="home-title">
      <header className="home-greeting">
        <span className="eyebrow">
          {today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
        <h1 id="home-title">
          {greeting(today)}, {name}
        </h1>
      </header>
      <div className="home-figures" role="list">
        {figures.map(({ label, value, tone, icon: Icon, tab, hint }) => (
          <button
            type="button"
            role="listitem"
            key={label}
            className="home-figure"
            data-tone={value ? tone : 'neutral'}
            onClick={() => onNavigate(tab)}
          >
            <span className="home-figure-label">
              <Icon size={15} aria-hidden="true" />
              {label}
            </span>
            <strong>{loading || value === null ? '—' : value}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      <div className="home-columns">
        <section className="home-card" aria-labelledby="home-todo">
          <div className="home-card-head">
            <h2 id="home-todo">To do</h2>
            <span className="count">{todo.length}</span>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : todo.length ? (
            <ul className="home-todo">
              {todo.map((item) => (
                <li key={item.key}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <span className="home-time">{item.time}</span>
                  <Button size="sm" variant="outline" onClick={() => onNavigate(item.tab)}>
                    {item.action} <ArrowRight size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-empty">
              <CheckCircle2 size={30} aria-hidden="true" />
              <strong>All caught up</strong>
              <span>Nothing needs you right now.</span>
            </div>
          )}
        </section>
        <aside className="home-side">
          {role === 'owner' && (
            <section className="home-card" aria-labelledby="home-pos">
              <div className="home-card-head">
                <h2 id="home-pos">Clover</h2>
                {clover ? (
                  clover.connected ? (
                    <StatusBadge tone={clover.syncEnabled ? 'good' : 'neutral'}>
                      {clover.syncEnabled ? 'Connected' : 'Connected · sync off'}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Not connected</StatusBadge>
                  )
                ) : (
                  <StatusBadge tone="neutral">Unknown</StatusBadge>
                )}
              </div>
              <p className="home-small">
                {clover?.connected
                  ? clover.sync?.lastSuccess
                    ? `Last checked ${timeAgo(clover.sync.lastSuccess, now) ?? new Date(clover.sync.lastSuccess).toLocaleString()}`
                    : 'No sync yet.'
                  : 'Connect Clover so sales take ingredients off your stock.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate(clover?.connected ? 'sales' : 'setup')}
              >
                <Settings2 size={14} /> {clover?.connected ? 'Sales' : 'Set up'}
              </Button>
            </section>
          )}
          <section className="home-card" aria-labelledby="home-orders">
            <div className="home-card-head">
              <h2 id="home-orders">Recent orders</h2>
              <Button size="sm" variant="ghost" onClick={() => onNavigate('history')}>
                All
              </Button>
            </div>
            {orders.length ? (
              <ul className="home-orders">
                {orders.slice(0, 3).map((order) => (
                  <li key={order.id}>
                    <div>
                      <strong>Order {order.id.slice(0, 6).toUpperCase()}</strong>
                      <small>
                        {new Date(order.created).toLocaleDateString()} · {order.items.length}{' '}
                        products
                      </small>
                    </div>
                    <span className="home-order-total">{money(order.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="home-empty compact">
                <ShoppingBag size={24} aria-hidden="true" />
                <span>No orders yet.</span>
                <Button size="sm" onClick={() => onNavigate('order')}>
                  Start an order
                </Button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
