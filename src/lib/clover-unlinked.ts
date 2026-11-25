import type {
  SalesEventDraftV1,
  SalesMappingPort,
  SalesSourceBinding,
} from '@/lib/sales-event-model';

/** A Clover item, or an option on a linked item, that paused sales are waiting on. */
export type UnlinkedCloverEntry = {
  kind: 'item' | 'option';
  itemId: string;
  modifierId?: string;
  pausedSales: number;
  lastSeen: string;
};

export type UnlinkedCloverSummary = {
  entries: UnlinkedCloverEntry[];
  /** Paused sales waiting on at least one entry. */
  waitingSales: number;
  /** Paused only for links, and every item and option is linked now. */
  readySales: number;
  /** True when more paused sales exist than were checked. */
  more: boolean;
};

export type HeldCloverSale = {
  occurredAt: string;
  lines: SalesEventDraftV1['lines'];
  /** Why the sale was paused, as stored with it. */
  reasons: string[];
};

/** Pause reasons that linking fixes. */
const LINK_REASONS = new Set(['unknown_item', 'unknown_variation', 'unknown_modifier']);

/** How many of the most recent paused Clover sales are checked. */
export const UNLINKED_SCAN_LIMIT = 200;

/**
 * Re-checks paused Clover sales against today's links, using the same mapping
 * rules as sales processing. Each distinct item and option is looked up once.
 */
export async function findUnlinkedClover(
  sales: HeldCloverSale[],
  mapping: SalesMappingPort,
  input: { companyId: string; source: SalesSourceBinding; more?: boolean },
): Promise<UnlinkedCloverSummary> {
  const lookups = new Map<string, Promise<string>>();
  const lookup = (key: string, check: () => Promise<{ status: string }>) => {
    let found = lookups.get(key);
    if (!found) {
      found = check().then((result) => result.status);
      lookups.set(key, found);
    }
    return found;
  };
  const entries = new Map<string, UnlinkedCloverEntry>();
  let waitingSales = 0,
    readySales = 0;
  for (const sale of sales) {
    const missing = new Map<string, Omit<UnlinkedCloverEntry, 'pausedSales' | 'lastSeen'>>();
    for (const line of sale.lines) {
      const item = { itemId: line.externalItemId, variation: line.externalVariationId };
      const itemStatus = await lookup(`item\u0000${item.itemId}\u0000${item.variation ?? ''}`, () =>
        mapping.resolveLine({
          companyId: input.companyId,
          source: input.source,
          externalItemId: item.itemId,
          externalVariationId: item.variation,
        }),
      );
      // A Not tracked item takes nothing, so its options don't matter.
      if (itemStatus === 'not_tracked') continue;
      if (itemStatus !== 'mapped') {
        missing.set(`item\u0000${item.itemId}`, { kind: 'item', itemId: item.itemId });
        continue;
      }
      for (const modifier of line.modifiers) {
        const key = `option\u0000${item.itemId}\u0000${modifier.externalModifierId}`;
        const optionStatus = await lookup(`${key}\u0000${item.variation ?? ''}`, () =>
          mapping.resolveModifier({
            companyId: input.companyId,
            source: input.source,
            externalItemId: item.itemId,
            externalVariationId: item.variation,
            externalModifierId: modifier.externalModifierId,
          }),
        );
        if (optionStatus !== 'mapped' && optionStatus !== 'not_tracked')
          missing.set(key, {
            kind: 'option',
            itemId: item.itemId,
            modifierId: modifier.externalModifierId,
          });
      }
    }
    if (!missing.size) {
      if (sale.reasons.length && sale.reasons.every((reason) => LINK_REASONS.has(reason)))
        readySales++;
      continue;
    }
    waitingSales++;
    for (const [key, entry] of missing) {
      const current = entries.get(key);
      if (current) {
        current.pausedSales++;
        if (sale.occurredAt > current.lastSeen) current.lastSeen = sale.occurredAt;
      } else entries.set(key, { ...entry, pausedSales: 1, lastSeen: sale.occurredAt });
    }
  }
  return {
    entries: [...entries.values()].sort(
      (a, b) =>
        b.pausedSales - a.pausedSales ||
        b.lastSeen.localeCompare(a.lastSeen) ||
        a.itemId.localeCompare(b.itemId),
    ),
    waitingSales,
    readySales,
    more: input.more === true,
  };
}

/** Reads the stored lines of a paused sale; an unreadable record is skipped. */
export function heldCloverSale(row: {
  occurred_at: string;
  normalized_json: string;
  last_reason: string | null;
}): HeldCloverSale | null {
  try {
    const event = JSON.parse(row.normalized_json) as { lines?: unknown };
    if (!Array.isArray(event.lines)) return null;
    const lines = event.lines.filter(
      (line): line is SalesEventDraftV1['lines'][number] =>
        !!line &&
        typeof line === 'object' &&
        typeof (line as { externalItemId?: unknown }).externalItemId === 'string' &&
        Array.isArray((line as { modifiers?: unknown }).modifiers),
    );
    const reasons = (row.last_reason ?? '').split(',').filter(Boolean);
    return { occurredAt: row.occurred_at, lines, reasons };
  } catch {
    return null;
  }
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The headline for the unlinked banner, for example "2 Clover items and 1 option aren't linked yet". */
export function unlinkedHeadline(entries: UnlinkedCloverEntry[]) {
  const items = entries.filter((entry) => entry.kind === 'item').length,
    options = entries.length - items;
  const parts = [
    items && plural(items, 'Clover item'),
    options && plural(options, items ? 'option' : 'Clover option'),
  ]
    .filter(Boolean)
    .join(' and ');
  return `${parts} ${entries.length === 1 ? "isn't" : "aren't"} linked yet`;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string | null | undefined, now: number) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export type CloverPillInput = {
  connected: boolean;
  syncEnabled: boolean;
  sync?: { lastSuccess?: string | null; lastError?: string | null } | null;
};

/** The Clover status pill shown beside the Sales page title. */
export function cloverPill(
  status: CloverPillInput,
  now: number,
): { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string } {
  if (!status.connected) return { tone: 'neutral', label: 'Clover not connected' };
  if (!status.syncEnabled) return { tone: 'neutral', label: 'Clover connected · sync off' };
  if (status.sync?.lastError) return { tone: 'bad', label: 'Clover sync problem' };
  const ago = timeAgo(status.sync?.lastSuccess, now);
  return ago
    ? { tone: 'good', label: `Clover · checked ${ago}` }
    : { tone: 'neutral', label: 'Clover · not checked yet' };
}
