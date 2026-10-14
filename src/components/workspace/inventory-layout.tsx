'use client';

import type {ReactNode} from 'react';
import {RefreshCw,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {inventorySections,type InventorySection} from './workspace-navigation';
import './inventory-layout.css';

export function InventoryLayout({section,onSectionChange,loading,onRefresh,children}:{
  section:InventorySection;onSectionChange:(section:InventorySection)=>void;
  loading:boolean;onRefresh:()=>void;children:ReactNode;
}) {
  return <div className="inventory-surface" aria-busy={loading}>
    <div className="page-heading inventory-heading">
      <div><h1>Inventory</h1><p>Track stock, manage recipes, and review sales and purchasing suggestions.</p></div>
      <Button variant="ghost" disabled={loading} onClick={onRefresh}><RefreshCw size={16}/>Refresh</Button>
    </div>
    <nav className="inventory-section-nav" aria-label="Inventory sections">
      {inventorySections.map(item=><button type="button" key={item.id} aria-current={section===item.id?'page':undefined} onClick={()=>onSectionChange(item.id)}>{item.label}</button>)}
    </nav>
    {children}
  </div>;
}

export function StockSearch({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  return <label className="inventory-stock-search"><Search size={16} aria-hidden="true"/><span className="sr-only">Search stock by product, supplier, or SKU</span><Input type="search" placeholder="Search stock…" value={value} onChange={event=>onChange(event.target.value)}/></label>;
}
