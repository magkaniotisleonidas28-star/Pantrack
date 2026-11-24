import type { ReactNode } from 'react';
import './status-badge.css';

/** one status style used everywhere. */
export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral';

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="status-badge" data-tone={tone}>
      <span className="status-badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
