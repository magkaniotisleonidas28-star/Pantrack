'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CloverOptionLinkView } from '@/lib/d1-clover-option-links';

type Item = { id: string; name: string };
export type CloverOptionSet = { id: string; name: string; choices: Item[] };

/** Link each option-set choice to its Clover option once (decision 0009 step 4). */
export default function CloverOptionLinks({
  optionSets,
  links,
  modifiers,
  busy,
  onAction,
}: {
  optionSets: CloverOptionSet[];
  links: CloverOptionLinkView[];
  modifiers: Item[];
  busy: boolean;
  onAction: (action: 'linkOption' | 'unlinkOption', extra: Record<string, unknown>) => void;
}) {
  const [setId, setSetId] = useState(''),
    [picked, setPicked] = useState<Record<string, string>>({});
  const set = optionSets.find((s) => s.id === setId);
  return (
    <section style={{ marginTop: 20 }}>
      <h3>Link option-set choices</h3>
      <p>
        Link each choice, such as Oat milk, to its Clover option once. Every item using that set,
        now or later, then recognizes it in Clover sales. A modifier mapped on one item above takes
        priority.
      </p>
      {!optionSets.length ? (
        <p>Add option sets under Inventory → Recipes first.</p>
      ) : (
        <>
          <label>
            Option set
            <select
              value={setId}
              onChange={(e) => {
                setSetId(e.target.value);
                setPicked({});
              }}
            >
              <option value="">Choose option set</option>
              {optionSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {set && !modifiers.length && <p>Load Clover modifiers to choose their options.</p>}
          {set && (
            <ul className="clover-option-links">
              {set.choices.map((choice) => {
                const linked = links.filter((l) => l.setId === set.id && l.choiceId === choice.id);
                const modifier = modifiers.find((m) => m.id === picked[choice.id]);
                return (
                  <li key={choice.id}>
                    <strong>{choice.name}</strong>
                    <span>
                      {linked.length
                        ? linked.map((l) => (
                            <span key={l.modifierId} className="sample-tag">
                              {l.modifierName}
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={`Unlink ${l.modifierName} from ${choice.name}`}
                                onClick={() =>
                                  onAction('unlinkOption', {
                                    setId: set.id,
                                    modifierId: l.modifierId,
                                  })
                                }
                              >
                                ×
                              </button>
                            </span>
                          ))
                        : 'Not linked'}
                    </span>
                    {modifiers.length > 0 && (
                      <span>
                        <label>
                          <span className="sr-only">Clover option for {choice.name}</span>
                          <select
                            value={picked[choice.id] ?? ''}
                            onChange={(e) => setPicked({ ...picked, [choice.id]: e.target.value })}
                          >
                            <option value="">Choose Clover option</option>
                            {modifiers.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy || !modifier}
                          onClick={() =>
                            modifier &&
                            onAction('linkOption', {
                              setId: set.id,
                              choiceId: choice.id,
                              modifierId: modifier.id,
                              modifierName: modifier.name,
                            })
                          }
                        >
                          Link
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
