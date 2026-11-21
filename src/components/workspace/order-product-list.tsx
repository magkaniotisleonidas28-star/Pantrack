'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { money, type Product } from '@/lib/pantry';
import { groupOrderProducts } from './order-product-groups';
import './order-product-list.css';

const MANY_PRODUCTS = 20;
const storageKey = (companyId: string) => 'pantrack-order-groups:' + companyId;

function readOpen(companyId: string): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(companyId)) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

/** The order page's products, grouped by supplier into lists that open and close. */
export default function OrderProductList({
  companyId,
  products,
  totalCount,
  qty,
  onQuantity,
  searching,
}: {
  companyId: string;
  products: Product[];
  totalCount: number;
  qty: Record<string, number>;
  onQuantity: (id: string, n: number) => void;
  searching: boolean;
}) {
  // Only rendered after the products load in the browser, so storage is available here.
  const [open, setOpen] = useState<Record<string, boolean>>(() => readOpen(companyId));
  const groups = useMemo(() => groupOrderProducts(products, qty), [products, qty]);
  const defaultOpen = totalCount <= MANY_PRODUCTS;
  const isOpen = (supplier: string) => searching || (open[supplier] ?? defaultOpen);

  function remember(next: Record<string, boolean>) {
    setOpen(next);
    try {
      localStorage.setItem(storageKey(companyId), JSON.stringify(next));
    } catch {
      /* Remembering open lists is a convenience only. */
    }
  }
  const toggle = (supplier: string) => remember({ ...open, [supplier]: !isOpen(supplier) });
  const setAll = (value: boolean) =>
    remember(Object.fromEntries(groups.map(({ supplier }) => [supplier, value])));
  const allOpen = groups.every(({ supplier }) => isOpen(supplier));

  return (
    <div className="order-groups">
      {groups.length > 1 && !searching && (
        <div className="order-groups-tools">
          <button type="button" onClick={() => setAll(!allOpen)}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      {groups.map(({ supplier, products: list, chosenCount, subtotal, minimum }) => {
        const expanded = isOpen(supplier),
          panelId = 'order-group-' + supplier.replace(/[^a-z0-9]+/gi, '-');
        return (
          <section className="order-group" key={supplier} data-open={expanded}>
            <h2>
              <button
                type="button"
                className="order-group-header"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(supplier)}
                disabled={searching}
              >
                <ChevronDown size={18} aria-hidden="true" className="order-group-chevron" />
                <span className="order-group-name">
                  {supplier}
                  <small>
                    {list.length} {list.length === 1 ? 'product' : 'products'}
                  </small>
                </span>
                <span className="order-group-status">
                  {chosenCount > 0 ? (
                    <>
                      <strong>
                        {chosenCount} in order · {money(subtotal)}
                      </strong>
                      {minimum !== undefined && (
                        <small data-met={subtotal >= minimum}>
                          {subtotal >= minimum
                            ? 'Minimum met'
                            : `${money(minimum - subtotal)} to the ${money(minimum)} minimum`}
                        </small>
                      )}
                    </>
                  ) : (
                    <small>Nothing added yet</small>
                  )}
                </span>
              </button>
            </h2>
            {expanded && (
              <ul id={panelId} className="order-group-rows">
                {list.map((p) => (
                  <li key={p.id} data-selected={qty[p.id] > 0}>
                    <div className="order-row-product">
                      <strong>{p.name}</strong>
                      <small>
                        {p.pack} / {p.unit} · {p.sku}
                      </small>
                    </div>
                    <div className="order-row-price">
                      {money(p.price)}
                      <small>per {p.unit}</small>
                    </div>
                    <div className="stepper">
                      <button
                        type="button"
                        aria-label={'Decrease ' + p.name}
                        disabled={!qty[p.id]}
                        onClick={() => onQuantity(p.id, (qty[p.id] || 0) - 1)}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        aria-label={'Quantity of ' + p.name + ' in ' + p.unit + 's'}
                        type="number"
                        min="0"
                        max="999"
                        step="1"
                        value={qty[p.id] || 0}
                        onChange={(e) => onQuantity(p.id, Number(e.target.value))}
                      />
                      <button
                        type="button"
                        aria-label={'Increase ' + p.name}
                        disabled={qty[p.id] === 999}
                        onClick={() => onQuantity(p.id, (qty[p.id] || 0) + 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="order-row-subtotal">
                      {qty[p.id] ? money(p.price * qty[p.id]) : <span className="muted">—</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
