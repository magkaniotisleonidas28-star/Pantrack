import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getChatGPTUser } from './chatgpt-auth';
import { database } from '@/db/raw';
import { exactInventoryPreviewEnabled } from './exact-inventory-gate';
import { D1WasteSuggestions } from './d1-waste-suggestions';
import { createOpenAIWasteReader } from './openai-waste-reader';
import {
  fakeWasteReader,
  SuggestionError,
  type PhotoSuggestionStatus,
  type WasteReader,
} from './waste-suggestion-contract';

/**
 * The reader behind photo suggestions, chosen only by explicit server settings:
 * "openai" with the owner's key stored as the OPENAI_WASTE_API_KEY secret, or
 * the offline "fake" for local development. Anything else means unavailable.
 */
export function wasteReader(): WasteReader | null {
  const settings = env as unknown as {
    PANTRACK_WASTE_READER?: string;
    OPENAI_WASTE_API_KEY?: string;
  };
  if (settings.PANTRACK_WASTE_READER === 'fake') return fakeWasteReader;
  if (settings.PANTRACK_WASTE_READER === 'openai' && settings.OPENAI_WASTE_API_KEY?.trim())
    return createOpenAIWasteReader({ apiKey: settings.OPENAI_WASTE_API_KEY.trim() });
  return null;
}

const suggestionStatus: Partial<Record<SuggestionError['code'], number>> = {
  invalid_photo: 400,
  not_enabled: 403,
  operation_conflict: 409,
  cap_reached: 429,
};

export async function handleWasteSuggestion(req: Request, reader = wasteReader()) {
  if (!exactInventoryPreviewEnabled())
    return Response.json(
      { error: 'Waste recording is not enabled.', code: 'preview_disabled' },
      { status: 404 },
    );
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
    if (!reader)
      throw new SuggestionError(
        'reader_unavailable',
        'Photo suggestions are not available yet. Use the waste form.',
      );
    // Identity comes only from the signed-in session.
    const result = await new D1WasteSuggestions(database(), reader).suggest(
      await req.json(),
      user.userId,
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: 'Add a photo or a note, and keep the note under 300 characters.' },
        { status: 400 },
      );
    if (error instanceof SuggestionError)
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: suggestionStatus[error.code] ?? 503,
        },
      );
    return Response.json(
      { error: 'The photo could not be read. Use the waste form.', code: 'reader_failed' },
      { status: 503 },
    );
  }
}

/** Records what the person did with a suggestion; it never records or changes waste. */
export async function handleWasteSuggestionOutcome(req: Request) {
  if (!exactInventoryPreviewEnabled())
    return Response.json(
      { error: 'Waste recording is not enabled.', code: 'preview_disabled' },
      { status: 404 },
    );
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
    const result = await new D1WasteSuggestions(database(), fakeWasteReader).recordOutcome(
      await req.json(),
      user.userId,
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: 'Invalid suggestion outcome.' }, { status: 400 });
    if (error instanceof SuggestionError && error.code === 'not_found')
      return Response.json({ error: error.message, code: error.code }, { status: 404 });
    return Response.json({ error: 'The outcome could not be recorded.' }, { status: 503 });
  }
}

/** The owner's switch and this month's spending (owner only, through the route wrapper). */
export async function handleWastePhotoSettings(req: Request) {
  if (!exactInventoryPreviewEnabled())
    return Response.json(
      { error: 'Waste recording is not enabled.', code: 'preview_disabled' },
      { status: 404 },
    );
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
    const service = new D1WasteSuggestions(database(), fakeWasteReader);
    if (req.method === 'GET') {
      const companyId = new URL(req.url).searchParams.get('companyId')!;
      return Response.json(await service.usage(companyId, wasteReader() !== null));
    }
    const result = await service.setEnabled(await req.json(), user.userId);
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: 'Choose on or off.' }, { status: 400 });
    return Response.json({ error: 'The setting could not be saved. Try again.' }, { status: 503 });
  }
}

/** Availability for the Waste page, without spending details. */
export async function photoSuggestionStatus(companyId: string): Promise<PhotoSuggestionStatus> {
  const usage = await new D1WasteSuggestions(database(), fakeWasteReader).usage(
    companyId,
    wasteReader() !== null,
  );
  return { connected: usage.connected, enabled: usage.enabled, limitReached: usage.limitReached };
}
