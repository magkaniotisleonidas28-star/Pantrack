'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRequestScope } from '@/hooks/use-request-scope';
import { useBrowserReady } from '@/hooks/use-browser-ready';
import { recoverIngredientWaste } from '@/lib/waste-browser-recovery';
import { Trash2, Star, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { WASTE_REASONS, type WasteOptions, type WasteShortcut } from '@/lib/waste-contract';
import {
  sendWasteSave,
  wasteStorageKey,
  wasteEffectiveAt,
  type PendingWasteSave,
} from '@/lib/waste-client';

function WasteRecorderClient({
  companyId,
  email,
  role,
  onDirtyChange,
  onSaved,
  launchCount = 0,
  showButton = true,
}: {
  companyId: string;
  email: string;
  role: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved?: () => void;
  launchCount?: number;
  showButton?: boolean;
}) {
  const storageKey = wasteStorageKey(companyId, email);
  const [restored] = useState(() => recoverIngredientWaste(storageKey, companyId));
  const restoredWaste = restored.pending?.kind === 'waste' ? restored.pending.request : null;
  const restoredShortcuts =
    restored.pending?.kind === 'shortcuts' ? restored.pending.request : null;
  const [observedLaunch, setObservedLaunch] = useState(launchCount);
  const [loadedLaunch, setLoadedLaunch] = useState(launchCount);
  const [enabled, setEnabled] = useState(false),
    [open, setOpen] = useState(!!restored.pending || launchCount > 0),
    [options, setOptions] = useState<WasteOptions | null>(null),
    [explicitLoading, setLoading] = useState(false),
    [error, setError] = useState(
      restored.pending
        ? 'A previous save needs confirmation. Retry the same entry to check it safely.'
        : '',
    ),
    [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''),
    [productId, setProductId] = useState(restored.pending?.request.productId ?? ''),
    [amount, setAmount] = useState(restoredWaste?.amount ?? ''),
    [reason, setReason] = useState(restoredWaste?.reason ?? ''),
    [note, setNote] = useState(restoredWaste?.note ?? '');
  const [favorites, setFavorites] = useState<string[]>(restored.favorites),
    [recent, setRecent] = useState<string[]>(restored.recent),
    [pending, setPending] = useState<PendingWasteSave | null>(restored.pending),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [discard, setDiscard] = useState(false);
  const [editingShortcuts, setEditingShortcuts] = useState(!!restoredShortcuts),
    [shortcuts, setShortcuts] = useState<WasteShortcut[]>(restoredShortcuts?.shortcuts ?? []);
  const lock = useRef(false),
    serverTime = useRef({ at: 0, received: 0 });
  const canConfigure = role === 'owner' || role === 'manager';
  const item = options?.items.find((i) => i.productId === productId),
    dirty = !saved && !!(productId || amount || reason || note || pending || editingShortcuts);
  const frozen = busy || !!pending;
  const loading = explicitLoading || loadedLaunch !== launchCount;
  if (observedLaunch !== launchCount) {
    setObservedLaunch(launchCount);
    if (launchCount > 0) {
      setOpen(true);
      if (!pending) setError('');
    }
  }

  const beginRequest = useRequestScope(companyId);
  const loadData = useCallback(() => {
    const current = beginRequest();
    return fetch('/api/waste?companyId=' + encodeURIComponent(companyId), { cache: 'no-store' })
      .then(async (response) => {
        if (!current()) return;
        if (response.status === 404) {
          setEnabled(false);
          return;
        }
        const data = (await response.json()) as WasteOptions & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load ingredients.');
        if (!current()) return;
        serverTime.current = { at: Date.parse(data.serverNow), received: performance.now() };
        setOptions(data);
        setEnabled(true);
      })
      .catch((error) => {
        if (current()) setError((error as Error).message);
      })
      .finally(() => {
        if (current()) {
          setLoadedLaunch(launchCount);
          setLoading(false);
        }
      });
  }, [companyId, beginRequest, launchCount]);
  function load() {
    setLoading(true);
    return loadData();
  }
  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function remember(favoriteIds: string[], recentIds: string[]) {
    setFavorites(favoriteIds);
    setRecent(recentIds);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ favorites: favoriteIds, recent: recentIds }),
      );
    } catch {}
  }
  function freeze(save: PendingWasteSave) {
    try {
      sessionStorage.setItem(storageKey + ':pending', JSON.stringify(save));
      setPending(save);
      return true;
    } catch {
      setError(
        'This browser cannot keep your save reference safely. Nothing was sent. Try another browser.',
      );
      return false;
    }
  }
  function clearPending() {
    setPending(null);
    try {
      sessionStorage.removeItem(storageKey + ':pending');
    } catch {}
  }
  function reset() {
    setProductId('');
    setAmount('');
    setReason('');
    setNote('');
    setSearch('');
    setSaved(false);
    setError('');
    setNotice('');
    setEditingShortcuts(false);
    setShortcuts([]);
  }
  function close(next: boolean) {
    if (next) {
      setOpen(true);
      setError(pending ? error : '');
      void load();
      return;
    }
    if (frozen) {
      setError('Confirm this save by retrying it before closing.');
      return;
    }
    if (dirty) {
      setDiscard(true);
      return;
    }
    setOpen(false);
    reset();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (!navigator.onLine) {
      setError(
        pending
          ? 'You are offline. Reconnect to confirm the previous save; keep this tab open.'
          : 'You are offline. Reconnect before saving; this entry has not been sent.',
      );
      return;
    }
    let attempt = pending;
    if (!attempt) {
      if (!item) return;
      if (editingShortcuts)
        attempt = {
          kind: 'shortcuts',
          request: {
            companyId,
            productId,
            configId: item.configId,
            operationId: crypto.randomUUID(),
            expectedRevision: item.shortcutRevision,
            shortcuts,
          },
        };
      else
        attempt = {
          kind: 'waste',
          request: {
            companyId,
            productId,
            operationId: crypto.randomUUID(),
            expectedVersion: item.version,
            amount,
            unitId: item.unitId,
            reason: reason as 'spilled',
            note,
            effectiveAt: wasteEffectiveAt(serverTime.current),
          },
        };
      if (!freeze(attempt)) return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const outcome = await sendWasteSave(attempt);
      if (outcome.kind === 'uncertain') {
        setError(outcome.message);
        return;
      }
      clearPending();
      if (outcome.kind === 'rejected') {
        setError(outcome.message);
        if (outcome.refresh) await load();
        return;
      }
      if (attempt.kind === 'shortcuts') {
        setEditingShortcuts(false);
        setShortcuts([]);
        setNotice('Quantity shortcuts saved.');
        await load();
      } else {
        remember(favorites, [productId, ...recent.filter((id) => id !== productId)].slice(0, 6));
        setSaved(true);
        onSaved?.();
        void load();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!enabled && !open) return null;
  const visible = (options?.items || []).filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  );
  const favoriteItems = visible.filter((i) => favorites.includes(i.productId));
  const recentItems = recent
    .map((id) => visible.find((i) => i.productId === id))
    .filter((i) => i && !favorites.includes(i.productId));
  function ingredientButtons(items: typeof visible) {
    return items.map((i) => (
      <div className="waste-ingredient" key={i.productId}>
        <button
          type="button"
          onClick={() => {
            setProductId(i.productId);
            setAmount('');
            setError('');
          }}
        >
          {i.name}
          <small>{i.unitLabel}</small>
        </button>
        <button
          type="button"
          aria-label={(favorites.includes(i.productId) ? 'Unfavorite ' : 'Favorite ') + i.name}
          aria-pressed={favorites.includes(i.productId)}
          onClick={() =>
            remember(
              favorites.includes(i.productId)
                ? favorites.filter((id) => id !== i.productId)
                : [...favorites, i.productId],
              recent,
            )
          }
        >
          <Star size={18} fill={favorites.includes(i.productId) ? 'currentColor' : 'none'} />
        </button>
      </div>
    ));
  }
  return (
    <>
      {showButton && (
        <Button
          type="button"
          variant="outline"
          className="waste-entry-button"
          onClick={() => close(true)}
        >
          <Trash2 size={17} />
          Record ingredient waste
        </Button>
      )}
      <Sheet open={open} onOpenChange={close}>
        <SheetContent className="waste-sheet" showCloseButton={!frozen}>
          <SheetTitle>Record waste</SheetTitle>
          <SheetDescription>
            Ingredients only · stock is updated when your save is confirmed.
          </SheetDescription>
          {notice && <p role="status">{notice}</p>}
          {error && (
            <div role="alert" className="waste-error">
              {error}
              {!pending && !item && (
                <Button type="button" variant="outline" onClick={() => void load()}>
                  Reload ingredients
                </Button>
              )}
            </div>
          )}
          {loading && !options ? (
            <p role="status">Loading ingredients…</p>
          ) : saved ? (
            <div className="waste-success" role="status">
              <CheckCircle2 size={40} />
              <h2>Waste recorded</h2>
              <p>
                {item?.name || productId} · {amount} {item?.unitLabel}
              </p>
              <p>Stock was deducted once.</p>
              <Button onClick={reset}>Record another</Button>
              <Button variant="outline" onClick={() => close(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              {!productId ? (
                <div className="waste-picker">
                  <label>
                    Find an ingredient
                    <Input
                      autoFocus
                      placeholder="Search ingredients"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {!!favoriteItems.length && (
                    <section>
                      <h3>Favorites</h3>
                      {ingredientButtons(favoriteItems)}
                    </section>
                  )}
                  {!!recentItems.length && (
                    <section>
                      <h3>Recent</h3>
                      {ingredientButtons(recentItems as typeof visible)}
                    </section>
                  )}
                  <section>
                    <h3>{search ? 'Search results' : 'All ingredients'}</h3>
                    {ingredientButtons(visible)}
                    {!visible.length && (
                      <p>
                        {options?.items.length
                          ? 'No matching ingredients.'
                          : 'No ingredients are ready. Ask a manager to classify stock units and record opening counts.'}
                      </p>
                    )}
                  </section>
                </div>
              ) : (
                <form className="waste-form" onSubmit={save}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="waste-back"
                    disabled={frozen}
                    onClick={() => {
                      setProductId('');
                      setAmount('');
                      setEditingShortcuts(false);
                      setError('');
                    }}
                  >
                    <ArrowLeft size={16} />
                    Choose another ingredient
                  </Button>
                  <h2>{item?.name || productId}</h2>
                  {editingShortcuts ? (
                    <>
                      <p>Quantity shortcuts · {item?.unitLabel}. Up to six per ingredient.</p>
                      <fieldset disabled={frozen}>
                        {shortcuts.map((s, index) => (
                          <div className="waste-shortcut-row" key={index}>
                            <label>
                              Label
                              <Input
                                required
                                maxLength={40}
                                value={s.label}
                                onChange={(e) =>
                                  setShortcuts((old) =>
                                    old.map((v, n) =>
                                      n === index ? { ...v, label: e.target.value } : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Quantity
                              <Input
                                required
                                inputMode="decimal"
                                value={s.amount}
                                onChange={(e) =>
                                  setShortcuts((old) =>
                                    old.map((v, n) =>
                                      n === index ? { ...v, amount: e.target.value } : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={'Remove shortcut ' + (index + 1)}
                              onClick={() =>
                                setShortcuts((old) => old.filter((_, n) => n !== index))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={shortcuts.length >= 6}
                          onClick={() =>
                            setShortcuts((old) => [
                              ...old,
                              { label: '', amount: '', unitId: item!.unitId },
                            ])
                          }
                        >
                          Add shortcut
                        </Button>
                      </fieldset>
                    </>
                  ) : (
                    <fieldset disabled={frozen}>
                      <label>
                        Quantity (
                        {item?.unitLabel ||
                          (pending?.kind === 'waste' ? pending.request.unitId : '')}
                        )
                        <Input
                          autoFocus
                          required
                          inputMode="decimal"
                          placeholder="Enter quantity"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      </label>
                      {!!item?.shortcuts.length && (
                        <div className="waste-shortcuts">
                          {item.shortcuts.map((s, index) => (
                            <Button
                              type="button"
                              key={index}
                              variant="outline"
                              aria-pressed={amount === s.amount}
                              onClick={() => setAmount(s.amount)}
                            >
                              {s.label}
                              <small>
                                {s.amount} {item.unitLabel}
                              </small>
                            </Button>
                          ))}
                        </div>
                      )}
                      <fieldset className="waste-reasons">
                        <legend>What happened?</legend>
                        {WASTE_REASONS.map((r) => (
                          <Button
                            type="button"
                            variant="outline"
                            key={r.id}
                            aria-pressed={reason === r.id}
                            onClick={() => setReason(r.id)}
                          >
                            {r.label}
                          </Button>
                        ))}
                      </fieldset>
                      <label>
                        Note <span>(optional)</span>
                        <textarea
                          maxLength={300}
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Anything useful to add?"
                        />
                      </label>
                      <p className="waste-hint">Recorded for now. No need to enter a time.</p>
                    </fieldset>
                  )}
                  <div className="waste-actions">
                    <Button
                      type="submit"
                      disabled={
                        busy || (!pending && (!item || (!editingShortcuts && (!amount || !reason))))
                      }
                    >
                      {busy
                        ? 'Saving…'
                        : pending
                          ? 'Retry same save'
                          : editingShortcuts
                            ? 'Save shortcuts'
                            : 'Save waste'}
                    </Button>
                    {!frozen && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (editingShortcuts) {
                            setEditingShortcuts(false);
                            setShortcuts([]);
                          } else close(false);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  {!editingShortcuts && canConfigure && !frozen && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditingShortcuts(true);
                        setShortcuts(item?.shortcuts || []);
                        setError('');
                      }}
                    >
                      Manage quantity shortcuts
                    </Button>
                  )}
                </form>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent className="waste-discard-dialog">
          <AlertDialogTitle>Discard this unfinished entry?</AlertDialogTitle>
          <AlertDialogDescription>
            No waste has been saved. Your unfinished order will stay in place.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep entry</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Discard entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function WasteRecorder(props: React.ComponentProps<typeof WasteRecorderClient>) {
  const ready = useBrowserReady();
  return ready ? (
    <WasteRecorderClient key={JSON.stringify([props.companyId, props.email])} {...props} />
  ) : null;
}
