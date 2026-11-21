'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PackageX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { RunOutReportView } from '@/lib/run-out-contract';
import './run-out.css';

type ProductName = { id: string; name: string };
type Listing = { open: RunOutReportView[]; stocked: string[] };
const CHANGED = 'pantrack:run-out-changed';

async function load(companyId: string): Promise<Listing | null> {
  const response = await fetch(
    '/api/inventory/run-out?companyId=' + encodeURIComponent(companyId),
    {
      cache: 'no-store',
    },
  );
  if (response.status === 404) return null;
  const body = (await response.json().catch(() => ({}))) as Listing & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Could not load reports. Please retry.');
  return body;
}

// A request keeps its reference until the server answers, so a retry never creates a second record.
async function send(body: Record<string, unknown>) {
  const response = await fetch('/api/inventory/run-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    created?: boolean;
    report?: RunOutReportView;
  };
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Could not save. Please retry.'), {
      status: response.status,
    });
  return result;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** "We ran out": any member reports a product that ran out (R1c). Hidden when the preview is off. */
export function RunOutButton({
  companyId,
  products,
}: {
  companyId: string;
  products: ProductName[];
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [productId, setProductId] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const operation = useRef<string | null>(null);
  const refresh = useCallback(() => {
    load(companyId).then(setListing, () => {});
  }, [companyId]);
  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh]);
  if (!listing) return null;
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const choices = listing.stocked
    .map((id) => ({ id, name: name(id) }))
    .filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const reported = (id: string) => listing.open.find((r) => r.productId === id);
  function start() {
    setSearch('');
    setProductId('');
    setNote('');
    setMessage(null);
    operation.current = null;
    setOpen(true);
    refresh();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!productId || busy) return;
    setBusy(true);
    setMessage(null);
    operation.current ??= crypto.randomUUID();
    try {
      const result = await send({
        action: 'report',
        companyId,
        operationId: operation.current,
        productId,
        note,
      });
      operation.current = null;
      setMessage({
        kind: 'ok',
        text: result.created
          ? `Thanks — ${name(productId)} is reported. A manager will check it.`
          : `${name(productId)} was already reported by ${result.report?.reporterEmail} (${when(result.report!.reportedAt)}). A manager will check it.`,
      });
      window.dispatchEvent(new Event(CHANGED));
    } catch (error) {
      // A definite refusal frees the reference; anything uncertain keeps it for the retry.
      if ((error as { status?: number }).status && (error as { status: number }).status < 500)
        operation.current = null;
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        className="waste-entry-button run-out-button"
        type="button"
        variant="outline"
        aria-label="We ran out"
        onClick={start}
      >
        <PackageX size={16} />
        <span className="waste-entry-label">We ran out</span>
      </Button>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="run-out-dialog">
          <DialogTitle>What ran out?</DialogTitle>
          <DialogDescription>
            Tell your manager something is gone. This doesn’t change stock; a manager confirms it.
          </DialogDescription>
          <form onSubmit={submit} className="run-out-form">
            <Input
              type="search"
              placeholder="Search products…"
              aria-label="Find the product that ran out"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <fieldset>
              <legend className="sr-only">Product</legend>
              {choices.map((p) => (
                <label key={p.id} data-selected={productId === p.id}>
                  <input
                    type="radio"
                    name="run-out-product"
                    value={p.id}
                    checked={productId === p.id}
                    onChange={() => setProductId(p.id)}
                  />
                  <span>{p.name}</span>
                  {reported(p.id) && <small>Already reported</small>}
                </label>
              ))}
              {!choices.length && <p className="run-out-empty">No products match.</p>}
            </fieldset>
            <label className="run-out-note">
              Note (optional)
              <Input
                value={note}
                maxLength={200}
                placeholder="For example: back fridge is empty too"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {message && (
              <p role={message.kind === 'error' ? 'alert' : 'status'} data-kind={message.kind}>
                {message.text}
              </p>
            )}
            <div className="run-out-actions">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                {message?.kind === 'ok' ? 'Done' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={!productId || busy}>
                {busy ? 'Sending…' : 'Report it'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Owners and managers see open reports and confirm (stock to zero) or dismiss them. */
export function RunOutReviews({
  companyId,
  products,
  reloadKey,
  onResolved,
}: {
  companyId: string;
  products: ProductName[];
  reloadKey: string;
  onResolved: () => Promise<void>;
}) {
  const [listing, setListing] = useState<Listing | null>(null),
    [confirming, setConfirming] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const operations = useRef(new Map<string, string>());
  const refresh = useCallback(() => {
    load(companyId).then(setListing, (e: Error) => setError(e.message));
  }, [companyId]);
  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh, reloadKey]);
  if (!listing?.open.length && !error) return null;
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  async function resolve(report: RunOutReportView, action: 'confirm' | 'dismiss') {
    const key = report.id + ':' + action;
    setBusy(key);
    setError('');
    if (!operations.current.has(key)) operations.current.set(key, crypto.randomUUID());
    try {
      await send({
        action,
        companyId,
        operationId: operations.current.get(key),
        reportId: report.id,
      });
      operations.current.delete(key);
      setConfirming('');
      window.dispatchEvent(new Event(CHANGED));
      if (action === 'confirm') await onResolved();
    } catch (e) {
      if ((e as { status?: number }).status && (e as { status: number }).status < 500)
        operations.current.delete(key);
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="run-out-reviews" aria-label="Run-out reports">
      <h2>
        {listing?.open.length === 1
          ? '1 product reported as run out'
          : `${listing?.open.length ?? 0} products reported as run out`}
      </h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul>
        {listing?.open.map((report) => (
          <li key={report.id}>
            <div>
              <strong>{name(report.productId)}</strong>
              <small>
                Reported by {report.reporterEmail} · {when(report.reportedAt)}
                {report.note && ` · “${report.note}”`}
              </small>
            </div>
            {confirming === report.id ? (
              <div className="run-out-review-actions">
                <span>Set {name(report.productId)} to zero now?</span>
                <Button disabled={!!busy} onClick={() => void resolve(report, 'confirm')}>
                  {busy === report.id + ':confirm' ? 'Saving…' : 'Yes, none left'}
                </Button>
                <Button variant="ghost" disabled={!!busy} onClick={() => setConfirming('')}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="run-out-review-actions">
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setConfirming(report.id)}
                >
                  Confirm none left
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => void resolve(report, 'dismiss')}
                >
                  {busy === report.id + ':dismiss' ? 'Dismissing…' : 'Dismiss'}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
