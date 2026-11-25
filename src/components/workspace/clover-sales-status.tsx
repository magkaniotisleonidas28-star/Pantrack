'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, EyeOff, Link2, RefreshCw } from 'lucide-react';
import { useClock } from '@/hooks/use-clock';
import { useRequestScope } from '@/hooks/use-request-scope';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  cloverPill,
  plural,
  timeAgo,
  unlinkedHeadline,
  type UnlinkedCloverEntry,
  type UnlinkedCloverSummary,
} from '@/lib/clover-unlinked';
import './clover-sales-status.css';

export type CloverSalesStatus = {
  ready: boolean;
  connected: boolean;
  syncEnabled: boolean;
  sync?: { lastSuccess: string | null; lastError: string | null } | null;
  itemMappings: Array<{ item_id: string; recipe_id: string }>;
  recipes: Array<{ recipe_id: string; name: string }>;
  recipeModifiers: Array<{ recipe_id: string; modifier_id: string; name: string }>;
  unlinked?: UnlinkedCloverSummary | null;
};

type Names = { items: Record<string, string>; options: Record<string, string> };

async function readCloverStatus(companyId: string): Promise<CloverSalesStatus | null> {
  try {
    const response = await fetch('/api/clover?companyId=' + encodeURIComponent(companyId), {
      cache: 'no-store',
    });
    return response.ok ? ((await response.json()) as CloverSalesStatus) : null;
  } catch {
    return null;
  }
}

/** Owner-only Clover status for the Sales page: reads /api/clover. */
export function useCloverSalesStatus(companyId: string, enabled: boolean) {
  const [status, setStatus] = useState<CloverSalesStatus | null>(null);
  const beginRequest = useRequestScope(companyId);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void readCloverStatus(companyId).then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [companyId, enabled]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const current = beginRequest();
    const next = await readCloverStatus(companyId);
    if (current()) setStatus(next);
  }, [companyId, enabled, beginRequest]);
  return { status, reload };
}

async function cloverAction(
  companyId: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const response = await fetch('/api/clover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, action, ...extra }),
  });
  const data = (await response.json()) as {
    error?: string;
    items?: Array<{ id: string; name: string }>;
    nextOffset?: number | null;
    created?: number;
    held?: number;
  };
  if (!response.ok) throw new Error(data.error || 'Clover request failed.');
  return data;
}

/** "Clover · checked 4 min ago" and, when sync is on, Sync now. */
export function CloverStatusPill({
  companyId,
  status,
  onChanged,
}: {
  companyId: string;
  status: CloverSalesStatus;
  onChanged: () => Promise<void>;
}) {
  const now = useClock(30_000);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pill = cloverPill(status, now);
  async function sync() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await cloverAction(companyId, 'sync');
      const created = result.created ?? 0,
        held = result.held ?? 0;
      setMessage(
        created
          ? `${created} new sale${created === 1 ? '' : 's'}${held ? `, ${held} paused` : ''}.`
          : 'No new sales.',
      );
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
      await onChanged();
    }
  }
  return (
    <div className="clover-pill">
      <StatusBadge tone={pill.tone}>{pill.label}</StatusBadge>
      {status.connected && status.syncEnabled && status.sync && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void sync()}>
          <RefreshCw size={14} aria-hidden="true" /> {busy ? 'Checking…' : 'Sync now'}
        </Button>
      )}
      {message && (
        <small role="status" className="clover-pill-message">
          {message}
        </small>
      )}
    </div>
  );
}

export type NotTrackedMark = {
  kind: 'item' | 'option';
  externalId: string;
  name: string | null;
  markedBy: string;
  markedAt: string;
};
export type CloverItemsView = {
  connected: boolean;
  marks: NotTrackedMark[];
  unlinked: UnlinkedCloverSummary | null;
};

/** Unlinked items and Not tracked marks, for owners and managers. */
export function useCloverItems(companyId: string, enabled: boolean) {
  const [view, setView] = useState<CloverItemsView | null>(null);
  const beginRequest = useRequestScope(companyId);
  const read = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/clover/not-tracked?companyId=' + encodeURIComponent(companyId),
        { cache: 'no-store' },
      );
      return response.ok ? ((await response.json()) as CloverItemsView) : null;
    } catch {
      return null;
    }
  }, [companyId]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void read().then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [enabled, read]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const current = beginRequest();
    const next = await read();
    if (current()) setView(next);
  }, [enabled, read, beginRequest]);
  return { view, reload };
}

async function notTrackedAction(
  companyId: string,
  action: 'mark' | 'unmark',
  kind: 'item' | 'option',
  externalId: string,
  name?: string,
) {
  const response = await fetch('/api/clover/not-tracked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, action, kind, externalId, ...(name ? { name } : {}) }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not save.');
}

/**
 * The unlinked Clover items banner. Each item or option can be linked to a
 * recipe (owners) or marked Not tracked (owners and managers), and marks can
 * be undone. A note says when paused sales are ready to try again.
 */
export function CloverUnlinkedBanner({
  companyId,
  view,
  linking,
  onChanged,
  onReviewPaused,
}: {
  companyId: string;
  view: CloverItemsView;
  /** The owner's Clover status: recipes for linking and Clover names. Null for managers. */
  linking: CloverSalesStatus | null;
  onChanged: () => Promise<void>;
  onReviewPaused?: () => void;
}) {
  const now = useClock(60_000);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<Names>({ items: {}, options: {} });
  const [namesState, setNamesState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadingNames = useRef(false);
  const summary = view.unlinked;
  const entries = useMemo(() => summary?.entries ?? [], [summary]);
  const recipeFor = (itemId: string) =>
    linking?.itemMappings.find((mapping) => mapping.item_id === itemId)?.recipe_id;

  /** Looks up names on Clover's menu, a page at a time, until each entry has one. */
  const loadNames = useCallback(async () => {
    if (loadingNames.current) return;
    loadingNames.current = true;
    setNamesState('loading');
    const wantedItems = new Set(entries.map((entry) => entry.itemId));
    const wantedOptions = new Set(
      entries.flatMap((entry) => (entry.modifierId ? [entry.modifierId] : [])),
    );
    const found: Names = { items: {}, options: {} };
    try {
      for (const [action, wanted, into] of [
        ['menu', wantedItems, found.items],
        ['modifiers', wantedOptions, found.options],
      ] as const) {
        let offset: number | null = 0;
        for (let page = 0; wanted.size && offset !== null && page < 10; page++) {
          const result = await cloverAction(companyId, action, { offset });
          for (const item of result.items ?? [])
            if (wanted.delete(item.id)) into[item.id] = item.name;
          offset = result.nextOffset ?? null;
        }
      }
      setNamesState('done');
    } catch {
      setNamesState('failed');
    } finally {
      setNames(found);
      loadingNames.current = false;
    }
  }, [companyId, entries]);

  async function run(work: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(done);
      await onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function link(entry: UnlinkedCloverEntry, key: string) {
    const target = choice[key];
    if (!target) return;
    void run(
      () =>
        cloverAction(
          companyId,
          entry.kind === 'item' ? 'mapItem' : 'mapModifier',
          entry.kind === 'item'
            ? { itemId: entry.itemId, recipeId: target }
            : { itemId: entry.itemId, modifierId: entry.modifierId, inventoryModifierId: target },
        ).then(() => undefined),
      'Linked. Past sales and stock were not changed.',
    );
  }

  const itemName = (id: string) => names.items[id] ?? `Clover item ${id}`;
  const optionName = (id: string) => names.options[id] ?? `Option ${id}`;
  const marks = view.marks;
  if (!summary && !marks.length) return null;
  if (!entries.length && !summary?.readySales && !marks.length) return null;
  return (
    <div className="clover-unlinked">
      {entries.length > 0 && summary && (
        <section className="clover-banner" data-tone="warn" aria-label="Unlinked Clover items">
          <AlertTriangle size={18} aria-hidden="true" />
          <div className="clover-banner-text">
            <strong>{unlinkedHeadline(entries)}</strong>
            <span>
              {plural(summary.waitingSales, 'sale')} {summary.waitingSales === 1 ? 'is' : 'are'}{' '}
              paused until {entries.length === 1 ? 'it is' : 'they are'} linked or marked Not
              tracked. Nothing was taken from stock.
            </span>
          </div>
          <Button
            size="sm"
            aria-expanded={open}
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next && linking && namesState === 'idle') void loadNames();
            }}
          >
            <Link2 size={14} aria-hidden="true" /> {open ? 'Hide' : 'Sort them out'}
          </Button>
        </section>
      )}
      {(error || notice) && (
        <div className="clover-messages">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
        </div>
      )}
      {open && entries.length > 0 && summary && (
        <div className="clover-link-list">
          {namesState === 'loading' && <small role="status">Getting names from Clover…</small>}
          {namesState === 'failed' && (
            <small role="status">Couldn’t get names from Clover, so item codes are shown.</small>
          )}
          <ul>
            {entries.map((entry) => {
              const key = `${entry.kind}:${entry.itemId}:${entry.modifierId ?? ''}`;
              const recipeId = entry.kind === 'option' ? recipeFor(entry.itemId) : undefined;
              const choices = !linking
                ? []
                : entry.kind === 'item'
                  ? linking.recipes.map((recipe) => ({ id: recipe.recipe_id, name: recipe.name }))
                  : linking.recipeModifiers
                      .filter((modifier) => modifier.recipe_id === recipeId)
                      .map((modifier) => ({ id: modifier.modifier_id, name: modifier.name }));
              const title =
                entry.kind === 'item'
                  ? itemName(entry.itemId)
                  : `${optionName(entry.modifierId!)} on ${itemName(entry.itemId)}`;
              const markName =
                entry.kind === 'item'
                  ? names.items[entry.itemId]
                  : names.options[entry.modifierId!];
              const seen = timeAgo(entry.lastSeen, now);
              return (
                <li key={key}>
                  <div className="clover-link-name">
                    <strong>{title}</strong>
                    <small>
                      {plural(entry.pausedSales, 'paused sale')}
                      {seen && ` · last sold ${seen}`}
                    </small>
                  </div>
                  {linking &&
                    (choices.length ? (
                      <label className="clover-link-choice">
                        <span className="sr-only">
                          {entry.kind === 'item' ? 'Recipe for ' : 'Recipe option for '}
                          {title}
                        </span>
                        <select
                          value={choice[key] ?? ''}
                          disabled={busy}
                          onChange={(event) => setChoice({ ...choice, [key]: event.target.value })}
                        >
                          <option value="">
                            {entry.kind === 'item' ? 'Choose a recipe' : 'Choose a recipe option'}
                          </option>
                          {choices.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <small className="clover-link-choice">
                        {entry.kind === 'item'
                          ? 'Add a recipe first.'
                          : 'Add this option to the recipe first.'}
                      </small>
                    ))}
                  {choices.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !choice[key]}
                      aria-label={`Link ${title}`}
                      onClick={() => link(entry, key)}
                    >
                      Link
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Mark ${title} Not tracked`}
                    title={
                      entry.kind === 'item'
                        ? 'Its sales take nothing from stock. The rest of each sale still does.'
                        : 'Takes nothing from stock on any item. The rest of each sale still does.'
                    }
                    onClick={() =>
                      void run(
                        () =>
                          notTrackedAction(
                            companyId,
                            'mark',
                            entry.kind,
                            entry.kind === 'item' ? entry.itemId : entry.modifierId!,
                            markName,
                          ),
                        `Marked Not tracked. Paused sales with it can be tried again.`,
                      )
                    }
                  >
                    <EyeOff size={14} aria-hidden="true" /> Not tracked
                  </Button>
                </li>
              );
            })}
          </ul>
          {summary.more && <small>Only the latest 200 paused sales were checked.</small>}
        </div>
      )}
      {summary && summary.readySales > 0 && (
        <section className="clover-banner" data-tone="good" aria-label="Paused sales ready">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div className="clover-banner-text">
            <strong>
              {plural(summary.readySales, 'paused sale')} {summary.readySales === 1 ? 'is' : 'are'}{' '}
              ready to try again
            </strong>
            <span>
              Every item and option in {summary.readySales === 1 ? 'it' : 'them'} is linked or Not
              tracked now.
            </span>
          </div>
          {onReviewPaused && (
            <Button size="sm" variant="outline" onClick={onReviewPaused}>
              Review
            </Button>
          )}
        </section>
      )}
      {marks.length > 0 && (
        <details className="clover-not-tracked">
          <summary>
            <EyeOff size={14} aria-hidden="true" /> Not tracked ({marks.length})
          </summary>
          <ul>
            {marks.map((mark) => {
              const title =
                mark.name ??
                (mark.kind === 'item'
                  ? `Clover item ${mark.externalId}`
                  : `Option ${mark.externalId}`);
              return (
                <li key={`${mark.kind}:${mark.externalId}`}>
                  <div className="clover-link-name">
                    <strong>{title}</strong>
                    <small>
                      {mark.kind === 'item' ? 'Item' : 'Option, on any item'} · by {mark.markedBy} ·{' '}
                      {new Date(mark.markedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Undo Not tracked for ${title}`}
                    onClick={() =>
                      void run(
                        () => notTrackedAction(companyId, 'unmark', mark.kind, mark.externalId),
                        'Tracked again. New sales with it pause until it is linked.',
                      )
                    }
                  >
                    Undo
                  </Button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
