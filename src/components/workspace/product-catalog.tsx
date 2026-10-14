'use client';

import {useState} from 'react';
import {Plus,Search,ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {money,type Product} from '@/lib/pantry';

export default function ProductCatalog({products,onAdd,onEdit,onWasteSetup}:{
  products:Product[];onAdd:()=>void;onEdit:(product:Product)=>void;onWasteSetup?:()=>void;
}) {
  const [search,setSearch]=useState('');
  const shown=products.filter(product=>[product.name,product.supplier,product.sku,product.category].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="product-catalog">
    <div className="page-heading"><div><h1>Product catalog</h1><p>Save exact SKUs, packaging, and supplier links.</p></div><div className="inventory-actions">
      {onWasteSetup&&<Button variant="outline" onClick={onWasteSetup}>Café-item waste setup</Button>}
      <Button onClick={onAdd}><Plus size={17}/>Add product</Button>
    </div></div>
    <div className="catalog-list-tools"><label className="catalog-search"><Search size={18} aria-hidden="true"/><Input aria-label="Search catalog by product, supplier, SKU, or category" placeholder="Search products, suppliers, or SKUs…" value={search} onChange={e=>setSearch(e.target.value)}/></label><p>{shown.length} of {products.length} products</p></div>
    <ul className="catalog-products">{shown.map(product=><li className="catalog-product-row" key={product.id}>
      <div className="catalog-product-name"><h2>{product.name}</h2><small>SKU {product.sku||'not entered'} · {product.category}</small></div>
      <dl className="catalog-product-facts">
        <div><dt>Supplier</dt><dd>{product.supplier||'Supplier not linked'}</dd></div>
        <div><dt>Packaging</dt><dd>{product.pack} / {product.unit}</dd></div>
        <div><dt>Estimated price</dt><dd>{product.priceKnown===false?'Price unknown':money(product.price)}<small>per {product.unit} · {product.sample?'Sample':'Unverified price'}</small></dd></div>
      </dl>
      <div className="catalog-product-actions"><Button variant="ghost" aria-label={'Edit '+product.name} onClick={()=>onEdit(product)}>Edit</Button>{product.url&&<a href={product.url} target="_blank" rel="noreferrer" aria-label={'Open supplier product for '+product.name}>Supplier page<ExternalLink size={14} aria-hidden="true"/></a>}</div>
    </li>)}</ul>
    {!shown.length&&<div className="catalog-list-empty"><h2>{search?'No matching products':'Your catalog starts here'}</h2><p>{search?'Try another name, supplier, or SKU.':'Add a product with its supplier SKU and purchase packaging.'}</p>{search&&<Button variant="ghost" onClick={()=>setSearch('')}>Clear search</Button>}</div>}
  </section>;
}
