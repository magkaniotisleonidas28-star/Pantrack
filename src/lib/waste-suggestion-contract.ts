import { z } from 'zod';
import type { WasteReason } from './inventory-management-contract';

/**
 * Photo waste suggestions (decision 0010). A reader proposes waste entries from
 * a photo and a note; a person confirms them in the normal waste forms. Nothing
 * here records waste, and photos are never stored.
 */

export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];
/** The browser resizes photos first; this bounds what the server will read. */
export const MAX_PHOTO_BYTES = 1_500_000;
export const MAX_SUGGESTED_ENTRIES = 5;

export const wasteSuggestionRequest = z
  .object({
    companyId: z.string().trim().min(1).max(200),
    operationId: z.string().uuid(),
    note: z.string().trim().max(300),
    photo: z
      .object({
        mediaType: z.enum(PHOTO_MEDIA_TYPES),
        data: z
          .string()
          .min(16)
          .max(Math.ceil(MAX_PHOTO_BYTES / 3) * 4)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  // A photo, a note, or both.
  .refine((b) => !!b.photo || !!b.note, { message: 'Add a photo or a note.' });

export type WasteSuggestionRequest = z.infer<typeof wasteSuggestionRequest>;

/** What the person did with a suggestion: saved as suggested, saved after changes, or not used. */
export const wasteSuggestionOutcome = z
  .object({
    companyId: z.string().trim().min(1).max(200),
    operationId: z.string().uuid(),
    outcome: z.enum(['confirmed', 'edited', 'discarded']),
  })
  .strict();

const signatures: Record<PhotoMediaType, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/webp': (b) =>
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
};

/** Decodes the photo and checks it really is the stated image type and size. */
export function readPhoto(
  photo: NonNullable<WasteSuggestionRequest['photo']>,
): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(photo.data), (c) => c.charCodeAt(0));
  } catch {
    throw new SuggestionError('invalid_photo', 'Choose a photo again.');
  }
  if (bytes.length > MAX_PHOTO_BYTES)
    throw new SuggestionError('invalid_photo', 'This photo is too large. Choose it again.');
  if (bytes.length < 12 || !signatures[photo.mediaType](bytes))
    throw new SuggestionError('invalid_photo', 'This file is not a photo Pantrack can read.');
  return bytes;
}

export class SuggestionError extends Error {
  constructor(
    public readonly code:
      | 'invalid_photo'
      | 'operation_conflict'
      | 'reader_unavailable'
      | 'reader_failed'
      | 'not_enabled'
      | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'SuggestionError';
  }
}

/** What the reader may choose from. Refs are opaque, so internal IDs stay on the server. */
export type ReaderCatalogItem = {
  ref: string;
  name: string;
  /** "menu": whole items such as a croissant or a latte. "ingredient": stock such as milk. */
  kind: 'menu' | 'ingredient';
  /** For ingredients, the unit amounts are given in, such as "fl oz". */
  unit?: string;
};

export type ReaderInput = {
  /** Absent when the person sent only a note. */
  photo?: { mediaType: PhotoMediaType; bytes: Uint8Array<ArrayBuffer> };
  note: string;
  catalog: ReaderCatalogItem[];
  reasons: WasteReason[];
};

/** Untrusted reader output; every field is checked before anyone sees it. */
export type ReaderOutput = {
  entries: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost of this request in millionths of a US dollar. */
  costMicroUsd: number;
};

export interface WasteReader {
  read(input: ReaderInput): Promise<ReaderOutput>;
}

export type SuggestedEntry = {
  ref: string;
  name: string;
  kind: 'menu' | 'ingredient';
  /** Whole items for menu entries; a decimal amount for ingredients, or null when the photo cannot show it. */
  quantity: string | null;
  unit: string | null;
  reason: WasteReason;
  /** A short, plain explanation shown to the person, such as "5 croissants on the tray". */
  explanation: string;
};

const REASONS: WasteReason[] = ['end_of_day', 'spilled', 'spoiled', 'preparation_error', 'other'];
const whole = /^[1-9]\d{0,2}$/;
const decimal = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/;

/**
 * Keeps only entries that name an item from the catalog, with a sensible
 * quantity and a known reason. Anything else is dropped, so the person fills
 * the form instead. A missing ingredient amount stays null and is asked.
 */
export function checkedEntries(raw: unknown, catalog: ReaderCatalogItem[]): SuggestedEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: SuggestedEntry[] = [];
  for (const value of raw.slice(0, MAX_SUGGESTED_ENTRIES)) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Record<string, unknown>;
    const item = catalog.find((c) => c.ref === e.ref);
    if (!item || seen.has(item.ref)) continue;
    const reason = REASONS.find((r) => r === e.reason) ?? 'other';
    const quantity = typeof e.quantity === 'string' ? e.quantity.trim() : null;
    if (item.kind === 'menu' && (!quantity || !whole.test(quantity))) continue;
    if (
      item.kind === 'ingredient' &&
      quantity !== null &&
      (!decimal.test(quantity) || /^0(?:\.0+)?$/.test(quantity))
    )
      continue;
    seen.add(item.ref);
    entries.push({
      ref: item.ref,
      name: item.name,
      kind: item.kind,
      quantity,
      unit: item.kind === 'ingredient' && quantity !== null ? (item.unit ?? null) : null,
      reason,
      explanation: typeof e.explanation === 'string' ? e.explanation.trim().slice(0, 200) : '',
    });
  }
  return entries;
}

const reasonWords: Array<[RegExp, WasteReason]> = [
  [/spill|dropped|knocked/i, 'spilled'],
  [/end of (the )?day|unsold|leftover|closing/i, 'end_of_day'],
  [/spoil|expired|out of date|sour|mould|mold|stale/i, 'spoiled'],
  [/wrong|mistake|remake|burnt|burned/i, 'preparation_error'],
];

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
const singular = (text: string) => text.replace(/(?:es|s)\b/g, '');
/** The main part of a name, before details such as "· barista" or "(1 L)". */
const core = (name: string) => name.split(/[·(–—]| - /)[0];

/**
 * A fixed, offline reader for development and tests: it cannot see photos and
 * reads "5 croissants" or "spilled a latte" from the note. It costs nothing.
 */
export const fakeWasteReader: WasteReader = {
  async read(input) {
    const note = words(input.note);
    const reason = reasonWords.find(([pattern]) => pattern.test(input.note))?.[1] ?? 'other';
    const entries = input.catalog
      .filter((item) => {
        const name = singular(words(core(item.name)));
        return name && singular(note).includes(name);
      })
      .map((item) => {
        const name = singular(words(core(item.name)));
        const count = new RegExp(`(\\d+)\\s+${name.replace(/\s+/g, '\\s+')}`).exec(singular(note));
        return {
          ref: item.ref,
          quantity: item.kind === 'menu' ? (count?.[1] ?? '1') : null,
          reason,
          explanation: `Read "${item.name}" from your note.`,
        };
      });
    return {
      entries,
      provider: 'fake',
      model: 'fake-note-reader',
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
    };
  },
};
