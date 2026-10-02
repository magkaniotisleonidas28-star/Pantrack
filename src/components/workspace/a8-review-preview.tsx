'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {formatCanonical} from '@/lib/inventory-quantities';
import type {ReviewProposalSnapshot} from '@/lib/replenishment-proposal';
import type {Product} from '@/lib/pantry';
import A8SavedReviews from './a8-saved-reviews';

type ReviewResponse =
  | {kind: 'snapshot'; snapshot: ReviewProposalSnapshot}
  | {kind: 'unavailable'; reason: string};

export default function A8ReviewPreview({companyId, products}: {companyId: string; products: Product[]}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function calculate() {
    if (!productId || loading) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const query = new URLSearchParams({companyId, productId});
      const response = await fetch(`/api/replenishment/review?${query}`, {cache: 'no-store'});
      const data = await response.json() as ReviewResponse & {error?: string};
      if (!response.ok) throw new Error(data.error ?? 'Review could not be loaded.');
      setResult(data);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const snapshot = result?.kind === 'snapshot' ? result.snapshot : null;
  const explain = snapshot?.explanation;
  const sales = snapshot?.salesReadiness;
  return <><section>
    <div className="inventory-section-heading"><div><h2>Clover-backed proposal preview</h2>
      <p>Calculate an explainable review from exact stock, versioned settings, and this company’s Clover sync health. This preview saves nothing and cannot place an order.</p>
    </div></div>
    <div className="inventory-actions">
      <Select value={productId} onValueChange={value => {setProductId(value); setResult(null); setError('');}}>
        <SelectTrigger aria-label="Product for proposal preview"><SelectValue placeholder="Choose a product"/></SelectTrigger>
        <SelectContent>{products.map(product => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button disabled={!productId || loading} onClick={() => void calculate()}>{loading ? 'Calculating…' : 'Calculate review'}</Button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {result?.kind === 'unavailable' && <p role="status" className="notice">Review unavailable: {result.reason.replaceAll('_', ' ')}. Check exact stock and planning settings, then retry.</p>}
    {snapshot && explain && <article className="catalog-card">
      <span className="status">Review only · {sales?.status} sales health</span>
      <h3>{products.find(product => product.id === snapshot.productId)?.name ?? snapshot.productId}</h3>
      <p>Target: {formatCanonical(snapshot.quantities.target)} {snapshot.quantities.target.dimension}</p>
      <p>On hand: {formatCanonical(snapshot.quantities.onHand)} + confirmed incoming: {formatCanonical(snapshot.quantities.incoming)} = position: {formatCanonical(explain.position)}</p>
      <p>Shortfall: {formatCanonical(explain.shortfall)} · stock per pack: {formatCanonical(snapshot.quantities.pack)} · before limits: {explain.wantedPacks} packs</p>
      <p>Limits: capacity {explain.capacityPacks ?? 'none'}, shelf life {explain.shelfLifePacks ?? 'none'}, policy {explain.maximumPacks ?? 'none'} packs.</p>
      <strong>Review suggestion: {explain.recommendedPacks} whole packs</strong>
      <p>Sales checkpoint: {sales?.source === 'clover_sync' ? sales.checkpointAt ?? 'missing' : 'fictional'} · held events: {sales?.heldEventCount}</p>
      {sales?.source === 'clover_sync' && <p>Sales warnings: {sales.reasons.join(', ') || 'none'}.</p>}
      <p>Review reasons: {explain.reviewReasons.join(', ') || 'none'}.</p>
      <small>Supplier SKU, account, delivery, and price are unverified. Saving or editing requires a successful sales sync and checkpoint within the last 10 minutes. Recalculate after any stock, settings, or sync change.</small>
    </article>}
  </section><A8SavedReviews companyId={companyId} products={products}/></>;
}
