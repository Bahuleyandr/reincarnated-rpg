"use client";

/**
 * TutorialHint — Phase 5.5 Day 36-37.
 *
 * Renders above the input box during the new-user tutorial. Per-turn
 * hints come from `lib/tutorial/script.ts`. After 3 turns there's no
 * hint to show; the orchestrator graduates the player on the next
 * session.ended.
 */
import { useState } from "react";

import { getTutorialHint } from "@/lib/tutorial/script";

interface Props {
  turn: number;
  /** Pre-fill the input with the example. The play page passes a
   *  setter so the click-to-fill UX hands the prompt to InputBox. */
  onUseExample?(text: string): void;
  /** Called when the player clicks "skip tutorial". */
  onSkip?(): void;
}

export function TutorialHint({ turn, onUseExample, onSkip }: Props) {
  const hint = getTutorialHint(turn);
  const [skipBusy, setSkipBusy] = useState(false);
  if (!hint) return null;

  async function handleSkip() {
    if (skipBusy) return;
    setSkipBusy(true);
    try {
      await fetch("/api/tutorial/skip", { method: "POST" });
      onSkip?.();
    } finally {
      setSkipBusy(false);
    }
  }

  return (
    <section
      className="mx-4 my-2 border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs space-y-1"
      data-testid="tutorial-hint"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-amber-300">✦ tutorial · turn {turn}</span>
        <button
          type="button"
          onClick={handleSkip}
          disabled={skipBusy}
          className="text-stone-500 hover:text-stone-300 underline underline-offset-2 text-[10px]"
        >
          {skipBusy ? "…" : "skip"}
        </button>
      </div>
      <p className="text-stone-300 leading-5 italic">{hint.hint}</p>
      <button
        type="button"
        onClick={() => onUseExample?.(hint.example)}
        className="text-stone-400 hover:text-stone-200 italic text-[11px] underline-offset-2 hover:underline"
      >
        try: <span className="font-mono">{hint.example}</span>
      </button>
    </section>
  );
}
