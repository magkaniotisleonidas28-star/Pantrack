'use client';

import type { ReactNode } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { inventorySections, type InventorySection } from './workspace-navigation';
import './inventory-layout.css';

// Sections are chosen in the workspace side menu; the heading names the current one.
export function InventoryLayout({
  section,
  loading,
  onRefresh,
  children,
}: {
  section: InventorySection;
  onSectionChange: (section: InventorySection) => void;
  loading: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <div className="inventory-surface" aria-busy={loading}>
      <div className="page-heading inventory-heading">
        <div>
          <div className="eyebrow">Inventory</div>
          <h1>{inventorySections.find((item) => item.id === section)?.label}</h1>
          <p>Track stock, recipes, sales and what to reorder.</p>
        </div>
        <Button variant="ghost" disabled={loading} onClick={onRefresh}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      {children}
    </div>
  );
}

export function StockSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="inventory-stock-search">
      <Search size={16} aria-hidden="true" />
      <span className="sr-only">Search stock by product, supplier, or SKU</span>
      <Input
        type="search"
        placeholder="Search stock…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
