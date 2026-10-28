import { shortcutSubmission, wasteSubmission } from './waste-contract';
import { menuWasteSubmission, menuWasteSetup, menuWasteReview } from './menu-waste-contract';
import type { PendingWasteSave } from './waste-client';

type Reads = {
  preferences: (key: string) => string | null;
  pending: (key: string) => string | null;
};
const browserReads: Reads = {
  preferences: (key) => localStorage.getItem(key),
  pending: (key) => sessionStorage.getItem(key),
};
type MenuPending = (
  | { kind: 'entry'; request: ReturnType<typeof menuWasteSubmission.parse> }
  | { kind: 'setup'; request: ReturnType<typeof menuWasteSetup.parse> }
  | { kind: 'review'; request: ReturnType<typeof menuWasteReview.parse> }
) & { ambiguous: true };

function readRecovery<T extends { request: { companyId: string } }>(
  key: string,
  companyId: string,
  decode: (value: Record<string, unknown>) => T | null,
  reads: Reads,
) {
  const result: { favorites: string[]; recent: string[]; pending: T | null } = {
    favorites: [],
    recent: [],
    pending: null,
  };
  try {
    const value = JSON.parse(reads.preferences(key) || '{}');
    if (Array.isArray(value.favorites))
      result.favorites = value.favorites.filter((v: unknown) => typeof v === 'string').slice(0, 50);
    if (Array.isArray(value.recent))
      result.recent = value.recent.filter((v: unknown) => typeof v === 'string').slice(0, 6);
  } catch {
    /* Preferences must never prevent pending-save recovery. */
  }
  try {
    const value = JSON.parse(reads.pending(key + ':pending') || 'null');
    if (value && typeof value === 'object') {
      const pending = decode(value);
      if (pending?.request.companyId === companyId) result.pending = pending;
    }
  } catch {
    /* Corrupt or foreign browser data is never submitted. */
  }
  return result;
}

export function recoverIngredientWaste(key: string, companyId: string, reads = browserReads) {
  return readRecovery<PendingWasteSave>(
    key,
    companyId,
    (value) =>
      value.kind === 'waste'
        ? { kind: 'waste', request: wasteSubmission.parse(value.request) }
        : value.kind === 'shortcuts'
          ? { kind: 'shortcuts', request: shortcutSubmission.parse(value.request) }
          : null,
    reads,
  );
}
export function recoverMenuWaste(key: string, companyId: string, reads = browserReads) {
  return readRecovery<MenuPending>(
    key,
    companyId,
    (value) =>
      value.kind === 'entry'
        ? { kind: 'entry', request: menuWasteSubmission.parse(value.request), ambiguous: true }
        : value.kind === 'setup'
          ? { kind: 'setup', request: menuWasteSetup.parse(value.request), ambiguous: true }
          : { kind: 'review', request: menuWasteReview.parse(value.request), ambiguous: true },
    reads,
  );
}
