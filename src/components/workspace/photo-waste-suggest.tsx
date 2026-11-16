'use client';
import { useEffect, useState } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WASTE_REASONS } from '@/lib/waste-contract';
import { preparePhoto } from '@/lib/photo-prepare';
import type { ResolvedSuggestion, WasteSuggestionResult } from '@/lib/d1-waste-suggestions';

export type SuggestionOutcome = 'confirmed' | 'edited' | 'discarded';

/** Tells the server what the person did with a suggestion; failures never block waste entry. */
export function reportSuggestionOutcome(
  companyId: string,
  operationId: string,
  outcome: SuggestionOutcome,
) {
  void fetch('/api/waste/suggestions/outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, operationId, outcome }),
  }).catch(() => undefined);
}

/**
 * "Record waste from a photo" (decision 0010). The photo and note go to the
 * server, which suggests entries; the person opens each in the normal form and
 * checks it before anything is saved.
 */
export default function PhotoWasteSuggest({
  companyId,
  disabled,
  saved,
  onUse,
}: {
  companyId: string;
  disabled: boolean;
  /** Suggestions already saved, keyed by operation ID and reference. */
  saved: Record<string, SuggestionOutcome>;
  onUse: (entry: ResolvedSuggestion, suggestion: { operationId: string; note: string }) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<WasteSuggestionResult | null>(null),
    // One reference per photo and note, so a retry is never read or billed twice.
    [attempt, setAttempt] = useState<{
      operationId: string;
      photo: Awaited<ReturnType<typeof preparePhoto>>;
    } | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function choose(next: File | null) {
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : '');
    setAttempt(null);
    setResult(null);
    setError('');
  }

  async function suggest() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const current = attempt ?? {
        operationId: crypto.randomUUID(),
        photo: await preparePhoto(file),
      };
      setAttempt(current);
      const response = await fetch('/api/waste/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          operationId: current.operationId,
          note: note.trim(),
          photo: { mediaType: current.photo.mediaType, data: current.photo.data },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        result?: WasteSuggestionResult;
        error?: string;
      };
      if (!response.ok || !body.result) {
        setError(body.error || 'The photo could not be read. Try again, or use the form below.');
        return;
      }
      setResult(body.result);
      if (body.result.status !== 'suggested') setAttempt(null);
    } catch (e) {
      setError((e as Error).message || 'The photo could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    if (result?.status === 'suggested' && !savedHere)
      reportSuggestionOutcome(companyId, result.operationId, 'discarded');
    choose(null);
    setNote('');
  }

  const savedHere =
    !!result && Object.keys(saved).some((key) => key.startsWith(result.operationId + ':'));
  const reasonLabel = (id: string) => WASTE_REASONS.find((r) => r.id === id)?.label ?? id;
  return (
    <section className="photo-waste" aria-labelledby="photo-waste-title">
      <h3 id="photo-waste-title">Record waste from a photo</h3>
      <p>
        Take a photo of what is being thrown out and add a short note. Pantrack suggests the entry,
        and you check it before anything is saved.
      </p>
      {!result ? (
        <>
          <label className="photo-waste-pick">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected waste photo" />
            ) : (
              <span>
                <Camera size={20} aria-hidden="true" />
                Take or choose a photo
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              disabled={disabled || busy}
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Note <span className="task-optional-label">Helps with amounts</span>
            <textarea
              maxLength={300}
              rows={2}
              disabled={disabled || busy}
              placeholder={'e.g. "5 croissants, end of day" or "spilled a large oat latte"'}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setAttempt(null);
              }}
            />
          </label>
          <div className="task-form-actions">
            <Button
              type="button"
              disabled={disabled || busy || !file}
              onClick={() => void suggest()}
            >
              {busy ? 'Reading photo…' : attempt ? 'Try again' : 'Suggest entries'}
            </Button>
            {file && !busy && (
              <Button type="button" variant="ghost" onClick={() => choose(null)}>
                Remove photo
              </Button>
            )}
          </div>
        </>
      ) : (
        <div role="status" className="photo-waste-result">
          <p>{result.message}</p>
          {result.entries.map((entry) => (
            <article key={entry.ref} className="photo-waste-entry">
              <div>
                <strong>
                  {entry.quantity
                    ? `${entry.quantity}${entry.unit ? ` ${entry.unit}` : ' ×'} ${entry.name}`
                    : `${entry.name} · amount needed`}
                </strong>
                <small>
                  {reasonLabel(entry.reason)}
                  {entry.explanation ? ` · ${entry.explanation}` : ''}
                </small>
              </div>
              {saved[result.operationId + ':' + entry.ref] ? (
                <span className="photo-waste-saved">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  Saved
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    onUse(entry, { operationId: result.operationId, note: note.trim() })
                  }
                >
                  Check and save
                </Button>
              )}
            </article>
          ))}
          <Button type="button" variant="ghost" disabled={disabled} onClick={startOver}>
            {result.entries.length && !savedHere
              ? 'None of these are right'
              : 'Record another photo'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="waste-error">
          {error}
        </p>
      )}
    </section>
  );
}
