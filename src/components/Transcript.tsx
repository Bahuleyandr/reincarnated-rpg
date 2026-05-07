"use client";

import { useEffect, useRef } from "react";

import type { RollResult } from "@/lib/game/types";

import { DiceRollDisplay } from "./DiceRollDisplay";

export interface TranscriptEntry {
  kind: "narration" | "input" | "system";
  text: string;
  /** Optional roll attached to a narration entry; rendered as a
   *  small dice line above the prose. */
  roll?: RollResult | null;
}

interface TranscriptProps {
  entries: TranscriptEntry[];
  /** Pre-turn hint shown when the transcript is empty. Accepts any
   *  React node so the play page can render a form + location
   *  summary instead of the placeholder. */
  emptyHint?: React.ReactNode;
}

export function Transcript({ entries, emptyHint }: TranscriptProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div
      ref={ref}
      className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-stone-200"
      data-testid="transcript"
    >
      {entries.length === 0
        ? (emptyHint ?? <p className="text-stone-600 italic">awaiting first impression…</p>)
        : entries.map((e, i) => (
            <div key={i} className="space-y-1">
              {e.roll && <DiceRollDisplay roll={e.roll} />}
              <div
                className={
                  e.kind === "narration"
                    ? "leading-7 text-stone-100"
                    : e.kind === "input"
                      ? "leading-7 text-stone-500 italic before:content-['>_']"
                      : "text-xs leading-6 text-stone-600 italic"
                }
                aria-live={e.kind === "narration" && !e.text.trim() ? "polite" : undefined}
              >
                {e.kind === "narration" && !e.text.trim() ? (
                  <span className="inline-flex items-center gap-2 text-xs text-stone-500 italic">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full"
                      style={{ background: "var(--form-accent)" }}
                    />
                    turn resolving...
                  </span>
                ) : (
                  e.text
                )}
              </div>
            </div>
          ))}
    </div>
  );
}
