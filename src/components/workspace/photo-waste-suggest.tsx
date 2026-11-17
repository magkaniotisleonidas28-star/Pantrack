'use client';
import { useEffect, useState } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WASTE_REASONS } from '@/lib/waste-contract';
import { preparePhoto } from '@/lib/photo-prepare';
import type { ResolvedSuggestion, WasteSuggestionResult } from '@/lib/d1-waste-suggestions';
import type { PhotoSuggestionUsage } from '@/lib/waste-suggestion-contract';

const dollars = (micro: number) => '$' + (micro / 1_000_000).toFixed(2);

/**
 * The owner's switch for photo suggestions and this month's spending (decision 0010).
 * Off until the owner turns it on; capped at $10 a month.
 */
export function PhotoWasteOwner({
  companyId,
  enabled,
  onChange,
}: {
  companyId: string;
  enabled: boolean;
  onChange: () => void;
}) {
  const [usage, setUsage] = useState<PhotoSuggestionUsage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    fetch('/api/waste/suggestions/settings?companyId=' + encodeURIComponent(companyId), {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? (r.json() as Promise<PhotoSuggestionUsage>) : null))
      .then((u) => {
        if (current) setUsage(u);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [companyId, enabled]);
  async function toggle(next: boolean) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/waste/suggestions/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, enabled: next }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error);
      onChange();
    } catch (e) {
      setError((e as Error).message || 'The setting could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="photo-waste-owner">
      <div>
        <strong>Photo and note suggestions are {enabled ? 'on' : 'off'}</strong>
        <small>
          {enabled
            ? `${usage ? dollars(usage.spentMicroUsd) : '…'} of ${dollars(usage?.capMicroUsd ?? 10_000_000)} used this month. They stop at the limit until next month.`
            : 'When on, everyone who records waste can get a suggested entry from a photo or a note. Each one uses your OpenAI account, up to $10 a month.'}
        </small>
      </div>
      <Button
        type="button"
        variant={enabled ? 'ghost' : 'default'}
        disabled={busy}
        onClick={() => void toggle(!enabled)}
      >
        {busy ? 'Saving…' : enabled ? 'Turn off' : 'Turn on'}
      </Button>
      {error && (
        <p role="alert" className="waste-error">
          {error}
        </p>
      )}
    </div>
  );
}

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
 * "Record waste from a photo or note" (decision 0010). A photo, a note, or both go
 * to the server, which suggests entries; the person opens each in the normal form and
 * checks it before anything is saved.
 */
export default function PhotoWasteSuggest({
  companyId,
  disabled,
  limitReached = false,
  saved,
  onUse,
}: {
  companyId: string;
  disabled: boolean;
  /** This month's $10 limit is used up; the normal form still works. */
  limitReached?: boolean;
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
      photo: Awaited<ReturnType<typeof preparePhoto>> | null;
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
    if ((!file && !note.trim()) || busy) return;
    setBusy(true);
    setError('');
    try {
      const current = attempt ?? {
        operationId: crypto.randomUUID(),
        photo: file ? await preparePhoto(file) : null,
      };
      setAttempt(current);
      const response = await fetch('/api/waste/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          operationId: current.operationId,
          note: note.trim(),
          ...(current.photo
            ? { photo: { mediaType: current.photo.mediaType, data: current.photo.data } }
            : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        result?: WasteSuggestionResult;
        error?: string;
      };
      if (!response.ok || !body.result) {
        setError(body.error || 'This could not be read. Try again, or use the form below.');
        return;
      }
      setResult(body.result);
      if (body.result.status !== 'suggested') setAttempt(null);
    } catch (e) {
      setError((e as Error).message || 'This could not be sent. Try again.');
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
      <h3 id="photo-waste-title">Record waste from a photo or note</h3>
      <p>
        Take a photo of what is being thrown out, write a short note, or both. Pantrack suggests the
        entry, and you check it before anything is saved.
      </p>
      {limitReached && !result ? (
        <p role="status" className="photo-waste-banner">
          This month&apos;s $10 limit for suggestions is reached. Use the waste form below; it
          starts again next month.
        </p>
      ) : !result ? (
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
            Note{' '}
            <span className="task-optional-label">Optional with a photo; helps with amounts</span>
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
              disabled={disabled || busy || (!file && !note.trim())}
              onClick={() => void suggest()}
            >
              {busy
                ? file
                  ? 'Reading photo…'
                  : 'Reading note…'
                : attempt
                  ? 'Try again'
                  : 'Suggest entries'}
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
