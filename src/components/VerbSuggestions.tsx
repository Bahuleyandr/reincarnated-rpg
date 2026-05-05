"use client";

/**
 * VerbSuggestions — three preset buttons + an escape-hatch tile,
 * surfaced above the play-page input box. The first three come
 * from the API's verbSuggestions field (active beat → form's
 * iconicVerbs → form.verbs[]). The escape hatch reveals the
 * free-text input box for "say something else…" — that path
 * routes to the LLM narrator on /api/turn/stream.
 *
 * Design principle (per the user): "mimicking the option of
 * choice but directing the direction of the story." The presets
 * are author-curated arc moves when a beat fires; iconic
 * form-moves otherwise. Either way, every preset will produce
 * specific, on-form prose because the verb is guaranteed to be
 * in the phrase bank.
 *
 * The escape hatch is always available, but it's deliberately
 * de-emphasised — the preset path is the recommended one. The
 * 4th tile reads "say something else…" in a quieter color than
 * the verb buttons.
 */
import { useState } from "react";

export interface VerbSuggestionData {
  verb: string;
  label: string;
  description: string;
  source: "beat" | "iconic" | "fallback";
  advancesArc?: boolean | string;
}

interface Props {
  suggestions: VerbSuggestionData[];
  /** Submits the chosen preset verb. The play page wires this to
   *  /api/turn/stream with body.presetVerb=<verb>. */
  onPickPreset(verb: string): void;
  /** Called when the player toggles the escape hatch open. The
   *  parent reveals its existing InputBox below. */
  onOpenFreeText(): void;
  disabled?: boolean;
  /** Whether the free-text box is currently open. Used to render
   *  the escape-hatch tile in a "selected" state and hide the
   *  preset buttons (they'd be confusing alongside an open text
   *  input). */
  freeTextOpen: boolean;
}

export function VerbSuggestions({
  suggestions,
  onPickPreset,
  onOpenFreeText,
  disabled,
  freeTextOpen,
}: Props) {
  // The three preset buttons. Hidden when free-text is open so
  // the player isn't choosing between two surfaces at once.
  return (
    <div className="px-4 py-3 border-t border-stone-800 space-y-2">
      {!freeTextOpen && suggestions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {suggestions.map((s) => (
            <PresetButton
              key={s.verb}
              suggestion={s}
              onPick={() => onPickPreset(s.verb)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      {freeTextOpen ? (
        <button
          type="button"
          onClick={onOpenFreeText}
          className="w-full text-[10px] text-stone-500 hover:text-stone-300 underline underline-offset-2 text-left"
          disabled={disabled}
        >
          ← back to preset choices
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpenFreeText}
          className="w-full text-left px-3 py-2 border border-dashed border-stone-700 rounded text-[11px] text-stone-500 hover:text-stone-300 hover:border-stone-500 transition-colors"
          disabled={disabled}
          aria-label="open the free-text input to say something else"
        >
          <span className="italic">✎ say something else…</span>
          <span className="ml-2 text-[10px] text-stone-600">
            (your words; routes to the LLM narrator)
          </span>
        </button>
      )}
    </div>
  );
}

function PresetButton({
  suggestion,
  onPick,
  disabled,
}: {
  suggestion: VerbSuggestionData;
  onPick(): void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const advances = suggestion.advancesArc === true;
  const branches =
    typeof suggestion.advancesArc === "string" &&
    suggestion.advancesArc.startsWith("branch:");

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`text-left px-3 py-2 border rounded transition-colors ${
        disabled
          ? "border-stone-800 text-stone-700 cursor-not-allowed"
          : "border-stone-700 hover:border-[var(--form-accent-border)] hover:bg-[var(--form-accent-bg)]"
      }`}
    >
      <div className="flex items-baseline gap-1.5 mb-0.5">
        {(advances || branches) && (
          <span
            className="text-[10px]"
            style={{ color: "var(--form-accent)" }}
            title={
              branches
                ? `branches the arc (${suggestion.advancesArc})`
                : "advances the arc"
            }
          >
            {branches ? "↳" : "▸"}
          </span>
        )}
        <span
          className={`text-xs ${
            hover && !disabled ? "text-stone-100" : "text-stone-200"
          }`}
        >
          {suggestion.label}
        </span>
      </div>
      {suggestion.description && (
        <p className="text-[10px] text-stone-500 italic leading-4">
          {suggestion.description}
        </p>
      )}
    </button>
  );
}
