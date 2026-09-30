'use client';
import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import type {ProposalLifecycleView} from '@/lib/d1-replenishment-lifecycle';
import type {Product} from '@/lib/pantry';

export default function A8SavedReviews({companyId, products}: {companyId: string; products: Product[]}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [views, setViews] = useState<ProposalLifecycleView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [packs, setPacks] = useState('0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, string>());
  const selected = views.find(view => view.origin.id === selectedId);

  async function load() {
    if (!productId) return;
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams({companyId, productId});
      const response = await fetch(`/api/replenishment/proposals?${query}`, {cache: 'no-store'});
      const data = await response.json() as {views?: ProposalLifecycleView[]; error?: string};
      if (!response.ok) throw new Error(data.error ?? 'Saved reviews could not be loaded.');
      setViews(data.views ?? []);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function act(kind: 'create' | 'edit' | 'cancel') {
    if (busy || !productId || (kind !== 'create' && !selected)) return;
    setBusy(true); setError(''); setNotice('');
    const key = kind === 'create' ? `create:${productId}` : `${kind}:${selected!.origin.id}:${selected!.revision}:${packs}:${reason}`;
    let change = pending.current.get(key);
    if (!change) { change = crypto.randomUUID(); pending.current.set(key, change); }
    const body = kind === 'create'
      ? {action: kind, companyId, productId, proposalId: change, createId: change}
      : kind === 'edit'
        ? {action: kind, companyId, proposalId: selected!.origin.id, expectedRevision: selected!.revision,
            changeId: change, packs, reason}
        : {action: kind, companyId, proposalId: selected!.origin.id, expectedRevision: selected!.revision,
            changeId: change, reason};
    try {
      const response = await fetch('/api/replenishment/proposals', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
      });
      const data = await response.json() as {view?: ProposalLifecycleView; error?: string};
      if (!response.ok) throw new Error(data.error ?? 'Review action failed.');
      pending.current.delete(key);
      if (data.view) {
        setViews(previous => [data.view!, ...previous.filter(view => view.origin.id !== data.view!.origin.id)]);
        setSelectedId(data.view.origin.id);
        setPacks(data.view.packs);
      }
      setReason('');
      setNotice(kind === 'create' ? 'Review saved. No supplier was contacted.' :
        kind === 'edit' ? 'Quantity edit audited. No supplier was contacted.' : 'Review canceled.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section>
    <div className="inventory-section-heading"><div><h2>Saved review proposals</h2>
      <p>Saving requires current Clover sales health. Stock, settings, and sales changes mark an older proposal for a new review. Supplier submission is disabled.</p>
    </div></div>
    <div className="inventory-actions">
      <Select value={productId} onValueChange={value => {setProductId(value); setViews([]); setSelectedId(''); setError(''); pending.current.clear();}}>
        <SelectTrigger aria-label="Product for saved reviews"><SelectValue placeholder="Choose a product"/></SelectTrigger>
        <SelectContent>{products.map(product => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="outline" disabled={busy || !productId} onClick={() => void load()}>Load saved reviews</Button>
      <Button disabled={busy || !productId} onClick={() => void act('create')}>Save new review</Button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <div className="catalog-grid">{views.map(view => <article className="catalog-card" key={view.origin.id}>
      <span className="status">{view.status} · revision {view.revision}</span>
      <h3>{products.find(product => product.id === view.origin.productId)?.name ?? view.origin.productId}</h3>
      <p>{view.packs} whole packs · {view.invalidationReason ? `Needs new review: ${view.invalidationReason}` : 'Source checked on load'}</p>
      <small>Supplier submission: disabled · mapping and price: unverified</small>
      <Button variant="outline" onClick={() => {setSelectedId(view.origin.id); setPacks(view.packs); setReason('');}}>Inspect review</Button>
    </article>)}</div>
    {selected && <article className="catalog-card">
      <h3>Review history and quantity</h3>
      <p>Saved at {new Date(selected.origin.createdAt).toLocaleString()} by {selected.origin.createdBy}.</p>
      <p>Snapshot recommendation: {selected.origin.snapshot.explanation.recommendedPacks} packs · current reviewed quantity: {selected.packs} packs.</p>
      <p>Warnings: {selected.handoff.warnings.join(', ') || 'none'}.</p>
      <p>Source check: {selected.invalidationReason ?? 'current at last load'}.</p>
      {selected.events.map(event => <p key={event.revision}>Revision {event.revision}: {event.kind} by {event.actor} — {event.reason}</p>)}
      {!selected.invalidationReason && ['draft', 'review_required'].includes(selected.status) && <>
        <label>Whole packs<Input inputMode="numeric" value={packs} onChange={event => setPacks(event.target.value)}/></label>
        <label>Reason for edit or cancellation<Input maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label>
        <div className="inventory-actions">
          <Button disabled={busy || reason.trim().length < 4} onClick={() => void act('edit')}>Save quantity edit</Button>
          <Button variant="outline" disabled={busy || reason.trim().length < 4} onClick={() => void act('cancel')}>Cancel review</Button>
        </div>
      </>}
      {selected.invalidationReason && selected.status === 'review_required' && <>
        <label>Reason for cancellation<Input maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label>
        <Button variant="outline" disabled={busy || reason.trim().length < 4} onClick={() => void act('cancel')}>Cancel stale review</Button>
      </>}
    </article>}
  </section>;
}
