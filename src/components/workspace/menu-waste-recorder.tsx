'use client';
import { useEffect, useRef, useState } from 'react';
import { Star, CheckCircle2, ArrowLeft, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { WASTE_REASONS } from '@/lib/waste-contract';
import { menuWasteSubmission, menuWasteSetup, menuWasteReview, type MenuWasteOptions, type MenuWasteItem, type MenuWasteReceipt, type WasteSaleChoice } from '@/lib/menu-waste-contract';
import { sendSaveRequest, wasteStorageKey } from '@/lib/waste-client';
import WasteRecorder from './waste-recorder';
export type WasteSection = 'record' | 'setup' | 'review';
type Pending = ({
    kind: 'entry';
    request: ReturnType<typeof menuWasteSubmission.parse>;
} | {
    kind: 'setup';
    request: ReturnType<typeof menuWasteSetup.parse>;
} | {
    kind: 'review';
    request: ReturnType<typeof menuWasteReview.parse>;
}) & { ambiguous?: true };
type Held = {
    id: string;
    name: string;
    quantity: number;
    reason: string;
    occurredAt: string;
    sourceKind: 'product' | 'recipe';
    sourceId: string;
};
const itemKey = (i: Pick<MenuWasteItem, 'kind' | 'id'>) => JSON.stringify([i.kind, i.id]);
export default function MenuWasteRecorder({ companyId, email, role, page, section = 'record', launchCount = 0, refreshKey = 0, onEnabledChange, onDirtyChange, onSaved, onSetup, onSection }: {
    companyId: string;
    email: string;
    role: string;
    page: boolean;
    section?: WasteSection;
    launchCount?: number;
    refreshKey?: number;
    onEnabledChange: (v: boolean) => void;
    onDirtyChange: (v: boolean) => void;
    onSaved: () => void;
    onSetup?: (id: string) => void;
    onSection?: (v: WasteSection) => void;
}) {
    const [options, setOptions] = useState<MenuWasteOptions | null>(null), [enabled, setEnabled] = useState(false), [loading, setLoading] = useState(false), [open, setOpen] = useState(false), [discard, setDiscard] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [search, setSearch] = useState(''), [selected, setSelected] = useState(''), [quantity, setQuantity] = useState('1'), [reason, setReason] = useState(''), [note, setNote] = useState(''), [mode, setMode] = useState<'unsold' | 'replacement' | 'sold'>('unsold'), [modifiers, setModifiers] = useState<Record<string, number>>({});
    const [favorites, setFavorites] = useState<string[]>([]), [recent, setRecent] = useState<string[]>([]), [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState<MenuWasteReceipt | null>(null), [sales, setSales] = useState<WasteSaleChoice[]>([]), [saleKey, setSaleKey] = useState(''), [salesLoading, setSalesLoading] = useState(false);
    const [held, setHeld] = useState<Held[]>([]), [reviewId, setReviewId] = useState(''), [ingredientLaunch, setIngredientLaunch] = useState(0), [ingredientDirty, setIngredientDirty] = useState(false);
    const manager = role === 'owner' || role === 'manager', storage = wasteStorageKey(companyId, email) + ':menu', lock = useRef(false), serverTime = useRef({ at: Date.now(), received: 0 });
    const item = options?.items.find(i => itemKey(i) === selected), dirty = !saved && !!(selected || pending || note), frozen = busy || !!pending;
    const view = pending?.kind === 'setup' ? 'setup' : pending?.kind === 'review' ? 'review' : pending?.kind === 'entry' ? 'record' : page ? section : 'record';
    async function load() {
        setLoading(true);
        try {
            const r = await fetch('/api/waste/items?companyId=' + encodeURIComponent(companyId), { cache: 'no-store' });
            if (r.status === 404) {
                setEnabled(false);
                onEnabledChange(false);
                return;
            }
            const d = await r.json() as MenuWasteOptions & {
                error?: string;
            };
            if (!r.ok)
                throw Error(d.error || 'Could not load café items.');
            setOptions(d);
            setEnabled(true);
            onEnabledChange(true);
            serverTime.current = { at: Date.parse(d.serverNow), received: performance.now() };
            if (manager) {
                const h = await fetch('/api/waste/review?companyId=' + encodeURIComponent(companyId), { cache: 'no-store' }), v = await h.json() as {
                    entries: Held[];
                    error?: string;
                };
                if (!h.ok)
                    throw Error(v.error || 'Could not load review entries.');
                setHeld(v.entries);
            }
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => { void load(); }, [companyId, refreshKey]);
    useEffect(() => {
        try {
            const d = JSON.parse(localStorage.getItem(storage) || '{}');
            if (Array.isArray(d.favorites))
                setFavorites(d.favorites.filter((v: unknown) => typeof v === 'string').slice(0, 50));
            if (Array.isArray(d.recent))
                setRecent(d.recent.filter((v: unknown) => typeof v === 'string').slice(0, 6));
        }
        catch { }
        try {
            const p = JSON.parse(sessionStorage.getItem(storage + ':pending') || 'null');
            if (p) {
                const parsed: Pending = p.kind === 'entry' ? { kind: 'entry', request: menuWasteSubmission.parse(p.request) } : p.kind === 'setup' ? { kind: 'setup', request: menuWasteSetup.parse(p.request) } : { kind: 'review', request: menuWasteReview.parse(p.request) };
                if (parsed.request.companyId === companyId) {
                    setPending({...parsed,ambiguous:true});
                    setOpen(true);
                    setError('A previous save needs confirmation. Retry the same save.');
                    if (parsed.kind === 'entry') {
                        const b = parsed.request;
                        setSelected(itemKey({ kind: b.sourceKind, id: b.sourceId }));
                        setQuantity(String(b.quantity));
                        setReason(b.reason);
                        setNote(b.note);
                        setMode(b.mode);
                        setModifiers(Object.fromEntries(b.modifiers.map(m => [m.id, m.perItem])));
                    }
                }
            }
        }
        catch { }
    }, [companyId, email]);
    useEffect(() => { if (launchCount > 0) {
        setOpen(true);
        void load();
    } }, [launchCount]);
    useEffect(() => { if (page) {
        setOpen(false);
        void load();
    } }, [page, section]);
    useEffect(() => { onDirtyChange(dirty || ingredientDirty); }, [dirty, ingredientDirty, onDirtyChange]);
    useEffect(() => { if (!dirty)
        return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
    async function loadSales(kind: 'product' | 'recipe', id: string) { setSalesLoading(true); setSales([]); setSaleKey(''); try {
        const r = await fetch('/api/waste/sales?' + new URLSearchParams({ companyId, sourceKind: kind, sourceId: id }), { cache: 'no-store' }), d = await r.json() as {
            sales: WasteSaleChoice[];
            error?: string;
        };
        if (!r.ok)
            throw Error(d.error || 'Could not find recorded sales.');
        setSales(d.sales);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setSalesLoading(false);
    } }
    useEffect(() => { if (item && mode === 'sold')
        void loadSales(item.kind, item.id); }, [selected, mode]);
    function remember(f: string[], r: string[]) { setFavorites(f); setRecent(r); try {
        localStorage.setItem(storage, JSON.stringify({ favorites: f, recent: r }));
    }
    catch { } }
    function reset() { setSelected(''); setQuantity('1'); setReason(''); setNote(''); setMode('unsold'); setModifiers({}); setSaleKey(''); setSaved(null); setError(''); setNotice(''); }
    function close(v: boolean) { if (v) {
        setOpen(true);
        return;
    } if (frozen) {
        setError('Retry this same save to confirm it before closing.');
        return;
    } if (dirty) {
        setDiscard(true);
        return;
    } setOpen(false); reset(); }
    function markAmbiguous(attempt: Pending) {
        const uncertain:Pending={...attempt,ambiguous:true};
        setPending(uncertain);
        try{sessionStorage.setItem(storage+':pending',JSON.stringify(uncertain));}catch{}
    }
    async function send(attempt: Pending) {
        if (lock.current)
            return;
        if (!navigator.onLine) {
            setError('You are offline. Reconnect before saving; keep this entry open.');
            return;
        }
        if (!pending) {
            try {
                sessionStorage.setItem(storage + ':pending', JSON.stringify(attempt));
                setPending(attempt);
            }
            catch {
                setError('This browser cannot keep the save reference safely. Nothing was sent.');
                return;
            }
        }
        lock.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const outcome = await sendSaveRequest('/api/waste/' + (attempt.kind === 'entry' ? 'entries' : attempt.kind === 'setup' ? 'setup' : 'review'), attempt.request,fetch,attempt.ambiguous===true);
            if (outcome.kind === 'uncertain') {
                markAmbiguous(attempt);
                setError(outcome.message);
                return;
            }
            if (outcome.kind === 'saved') {
                const r = outcome.result as Partial<MenuWasteReceipt> & {
                    revision?: number;
                };
                if (!r || (attempt.kind === 'setup' ? typeof r.revision !== 'number' : r.operationId !== (attempt.kind === 'entry' ? attempt.request.operationId : attempt.request.entryId) || !['deducted', 'classified', 'held'].includes(r.status || ''))) {
                    markAmbiguous(attempt);
                    setError('We could not confirm the save. Retry this same save.');
                    return;
                }
                if (attempt.kind === 'entry') {
                    setSaved(r as MenuWasteReceipt);
                    remember(favorites, [selected, ...recent.filter(i => i !== selected)].slice(0, 6));
                    onSaved();
                }
                else {
                    setNotice(attempt.kind === 'setup' ? 'Café item setting saved.' : 'Entry linked. No additional stock was deducted.');
                    setReviewId('');
                }
            }
            setPending(null);
            try {
                sessionStorage.removeItem(storage + ':pending');
            }
            catch { }
            if (outcome.kind === 'rejected')
                setError(outcome.message);
            await load();
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    function save(e: React.FormEvent) {
        e.preventDefault();
        if (pending) {
            void send(pending);
            return;
        }
        if (!item)
            return;
        const choice = sales.find(s => JSON.stringify([s.applicationKey, s.lineId]) === saleKey);
        const request = { companyId, operationId: crypto.randomUUID(), sourceKind: item.kind, sourceId: item.id, sourceVersion: item.version, quantity: Number(quantity), reason: reason as 'spilled', note, mode, effectiveAt: new Date(serverTime.current.at + Math.max(0, performance.now() - serverTime.current.received)).toISOString(), modifiers: mode === 'sold' ? [] : item.modifiers.filter(m => modifiers[m.id]).map(m => ({ id: m.id, versionId: m.versionId, perItem: modifiers[m.id] })), ...(choice ? { sale: { applicationKey: choice.applicationKey, lineId: choice.lineId } } : {}) };
        const parsed = menuWasteSubmission.safeParse(request);
        if (!parsed.success) {
            setError('Choose a reason and a whole quantity from 1 to 999.');
            return;
        }
        void send({ kind: 'entry', request: parsed.data });
    }
    const list = (options?.items || []).filter(i => (i.offered || !!search) && i.name.toLowerCase().includes(search.toLowerCase()));
    function cards(items: MenuWasteItem[]) { return items.map(i => <div className="menu-waste-item" key={itemKey(i)}><button type="button" disabled={frozen || !i.ready} onClick={() => { setSelected(itemKey(i)); setQuantity('1'); setReason(''); setModifiers({}); setError(''); }}><strong>{i.name}</strong><small>{i.ready ? i.kind === 'recipe' ? 'Recipe ingredients deducted' : 'Individual items deducted' : i.issue}</small></button><button type="button" disabled={frozen} aria-label={(favorites.includes(itemKey(i)) ? 'Unfavorite ' : 'Favorite ') + i.name} aria-pressed={favorites.includes(itemKey(i))} onClick={() => remember(favorites.includes(itemKey(i)) ? favorites.filter(v => v !== itemKey(i)) : [...favorites, itemKey(i)].slice(0, 50), recent)}><Star size={18} fill={favorites.includes(itemKey(i)) ? 'currentColor' : 'none'}/></button>{!i.ready && manager && <Button type="button" variant="outline" disabled={frozen} onClick={() => { onSection?.('setup'); setOpen(false); }}>Set up item</Button>}</div>); }
    const selectedHeld = held.find(h => h.id === reviewId);
    const reviewSale = sales.find(s => JSON.stringify([s.applicationKey, s.lineId]) === saleKey);
    const body = <div className="menu-waste-content">
  {error && <div role="alert" className="waste-error">{error}</div>}{notice && <p role="status">{notice}</p>}
  {pending && pending.kind !== 'entry' && <div className="notice">This save needs confirmation. Details are frozen.<Button disabled={busy} onClick={() => void send(pending)}>{busy ? 'Saving…' : 'Retry same save'}</Button></div>}
  {loading && !options ? <p role="status">Loading café items…</p> : view === 'setup' && manager ? <>
   <h2>Café item setup</h2><p>Ready-made food comes from your catalog. Drinks and food made here use active recipes.</p><label>Find a catalog item<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search croissants, bagels…"/></label>
   <div className="menu-waste-setup">{options?.items.filter(i => i.kind === 'product' && i.name.toLowerCase().includes(search.toLowerCase())).map(i => <article key={i.id}><h3>{i.name}</h3><p>{i.offered ? 'Bought ready-made café item' : 'Not yet offered in the café waste list'}</p><Button disabled={frozen} variant="outline" onClick={() => void send({ kind: 'setup', request: { companyId, productId: i.id, offered: !i.offered, expectedRevision: i.revision, operationId: crypto.randomUUID() } })}>{i.offered ? 'Remove from café waste list' : 'Bought ready-made café item'}</Button>{i.offered && !i.ready && <><p>{i.issue}</p><p>Choose <strong>each</strong>, enter how many come in a box, and count how many you have now.</p><Button disabled={frozen} onClick={() => { setOpen(false); onSetup?.(i.id); }}>Set up stock count</Button></>}</article>)}</div><p>Prepared items: create and activate their recipe under Inventory → Recipe versions.</p>
  </> : view === 'review' && manager ? <><h2>Waste needing review</h2><p>These entries made no stock deduction. Link a confirmed sale; do not record them again as unsold waste.</p>{!held.length && <p>No entries need review.</p>}{held.map(h => <article className="menu-waste-review" key={h.id}><strong>{h.quantity} × {h.name}</strong><p>{WASTE_REASONS.find(r => r.id === h.reason)?.label} · {new Date(h.occurredAt).toLocaleString()}</p><Button disabled={frozen} variant="outline" onClick={() => { setReviewId(h.id); void loadSales(h.sourceKind, h.sourceId); }}>Find counted sale</Button></article>)}{selectedHeld && <div className="menu-waste-review"><h3>Link {selectedHeld.name}</h3>{salesLoading ? <p>Loading recorded sales…</p> : <label>Recorded sale<select value={saleKey} disabled={frozen} onChange={e => setSaleKey(e.target.value)}><option value="">Choose a matching sale</option>{sales.map(s => <option key={JSON.stringify([s.applicationKey, s.lineId])} value={JSON.stringify([s.applicationKey, s.lineId])}>{s.name} · {new Date(s.occurredAt).toLocaleString()} · {s.available} available {s.modifiers.join(', ')}</option>)}</select></label>}<Button disabled={frozen || !saleKey} onClick={() => { if (reviewSale)
            void send({ kind: 'review', request: { companyId, entryId: selectedHeld.id, operationId: crypto.randomUUID(), sale: { applicationKey: reviewSale.applicationKey, lineId: reviewSale.lineId } } }); }}>Link without deducting stock</Button>{!salesLoading && !sales.length && <p>No eligible sale has arrived yet. Recheck after sales are confirmed.</p>}</div>}</> : saved ? <div className="waste-success" role="status"><CheckCircle2 size={36}/><h2>{saved.status === 'held' ? 'Saved for manager review' : 'Waste recorded'}</h2><p>{saved.quantity} × {saved.itemName}</p><p>{saved.message}</p><Button onClick={reset}>Record another</Button></div> : !selected ? <>
   <label>Find a café item<Input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search croissants, lattes, bagels…"/></label>
   {!!list.filter(i => favorites.includes(itemKey(i))).length && <section><h3>Favorites</h3>{cards(list.filter(i => favorites.includes(itemKey(i))))}</section>}
   {!!recent.filter(k => list.some(i => itemKey(i) === k) && !favorites.includes(k)).length && <section><h3>Recent</h3>{cards(recent.map(k => list.find(i => itemKey(i) === k)).filter((i): i is MenuWasteItem => !!i && !favorites.includes(itemKey(i))))}</section>}
   <section><h3>{search ? 'Search results' : 'Café items'}</h3>{cards(list)}{!list.length && <p>No café items are ready. {manager ? 'Use Item setup for ready-made food, or add an active recipe.' : 'Ask a manager to set up the items you offer.'}</p>}</section>
   <Button variant="ghost" disabled={frozen} onClick={() => { setIngredientLaunch(n => n + 1); setOpen(false); }}>Record ingredient waste</Button>
  </> : <form className="waste-form" onSubmit={save}>
   <Button type="button" variant="ghost" disabled={frozen} onClick={reset}><ArrowLeft size={16}/>Choose another item</Button><h2>{item?.name || selected}</h2>
   <fieldset disabled={frozen}><label>How many items?<Input autoFocus required type="number" min="1" max="999" step="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></label><div className="waste-shortcuts">{[1, 2, 5].map(n => <Button key={n} type="button" variant="outline" aria-pressed={quantity === String(n)} onClick={() => setQuantity(String(n))}>{n}</Button>)}</div>
   <fieldset className="waste-reasons"><legend>Why was it wasted?</legend>{WASTE_REASONS.map(r => <Button type="button" key={r.id} variant="outline" aria-pressed={reason === r.id} onClick={() => setReason(r.id)}>{r.label}</Button>)}</fieldset>
   <label>Was this already recorded as a sale?<select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setModifiers({}); }}><option value="unsold">Unsold item — deduct stock</option><option value="replacement">New replacement — deduct stock</option><option value="sold">Already sold / counted — no extra deduction</option></select></label>
   <p className="waste-hint">{mode === 'unsold' ? 'Use this for food or drinks that will not be recorded as a sale.' : mode === 'replacement' ? 'Use this for an extra preparation that is not separately entered as a sale.' : 'Choose the counted sale. If it has not arrived, this entry is saved for manager review without deducting stock.'}</p>
   {mode === 'sold' ? salesLoading ? <p>Loading recorded sales…</p> : <label>Counted sale<select value={saleKey} onChange={e => setSaleKey(e.target.value)}><option value="">Not found yet — send for review</option>{sales.map(s => <option key={JSON.stringify([s.applicationKey, s.lineId])} value={JSON.stringify([s.applicationKey, s.lineId])}>{s.name} · {new Date(s.occurredAt).toLocaleString()} · {s.available} available {s.modifiers.join(', ')}</option>)}</select></label> : !!item?.modifiers.length && <fieldset><legend>How was it made?</legend>{item.modifiers.map(m => <label key={m.id}>{m.name}<select value={modifiers[m.id] || 0} onChange={e => setModifiers(old => ({ ...old, [m.id]: Number(e.target.value) }))}><option value="0">None</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} per item</option>)}</select></label>)}</fieldset>}
   <label>Note (optional)<textarea maxLength={300} rows={2} value={note} onChange={e => setNote(e.target.value)}/></label></fieldset>
   <div className="waste-actions"><Button type="submit" disabled={busy || (!pending && !reason)}>{busy ? 'Saving…' : pending ? 'Retry same save' : mode === 'sold' && !saleKey ? 'Save for review' : 'Save waste'}</Button>{!frozen && <Button type="button" variant="outline" onClick={() => setDiscard(true)}>Cancel</Button>}</div>
  </form>}
  {error && !pending && <Button variant="outline" onClick={() => void load()}>Refresh items</Button>}
 </div>;
    return <>
  {(enabled || pending) && page && <section className="menu-waste-page"><div className="page-heading"><div><h1>Waste</h1><p>Record the café item. Its stock or recipe ingredients are handled for you.</p></div><Trash2 size={28}/></div>{body}</section>}
  <Sheet open={open && !page} onOpenChange={close}><SheetContent className="waste-sheet" showCloseButton={!frozen}><SheetTitle>Record café-item waste</SheetTitle><SheetDescription>Ready-made food and recipe-based drinks.</SheetDescription>{onSection && <Button variant="outline" disabled={busy} onClick={() => { setOpen(false); onSection('record'); }}>Open Waste page</Button>}{body}</SheetContent></Sheet>
  <WasteRecorder companyId={companyId} email={email} role={role} showButton={false} launchCount={ingredientLaunch} onDirtyChange={setIngredientDirty} onSaved={onSaved}/>
  <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent className="waste-discard-dialog"><AlertDialogTitle>Discard this unfinished entry?</AlertDialogTitle><AlertDialogDescription>No waste has been saved. Your order draft stays in place.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Keep entry</AlertDialogCancel><AlertDialogAction onClick={() => { reset(); setOpen(false); }}>Discard entry</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </>;
}
