'use client';
import { useEffect, useState } from 'react';

type Quantity = { minor: string };

/** each product's saved level, read from the suggested-levels endpoint. */
export function useLevelTargets(companyId: string, refreshKey: unknown = 0) {
  const [targets, setTargets] = useState<Record<string, Quantity | null>>({});
  useEffect(() => {
    let live = true;
    fetch('/api/inventory/levels?companyId=' + encodeURIComponent(companyId), { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              suggestions?: Array<{ productId: string; current: Quantity | null }>;
            })
          : null,
      )
      .then((body) => {
        if (!live || !body?.suggestions) return;
        setTargets(Object.fromEntries(body.suggestions.map((s) => [s.productId, s.current])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [companyId, refreshKey]);
  return targets;
}

export function relativeDay(iso: string | null, now: number) {
  if (!iso) return null;
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  return days <= 0
    ? 'Today'
    : days === 1
      ? 'Yesterday'
      : days < 30
        ? `${days} days ago`
        : new Date(iso).toLocaleDateString();
}
