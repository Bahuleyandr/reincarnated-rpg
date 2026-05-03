"use client";

import type { RollResult } from "@/lib/game/types";

interface Props {
  roll: RollResult;
}

const BAND_COLOR = {
  miss: "text-red-400",
  partial: "text-amber-300",
  success: "text-emerald-400",
} as const;

export function DiceRollDisplay({ roll }: Props) {
  const sign = roll.mod >= 0 ? "+" : "";
  return (
    <div
      className="flex items-baseline gap-2 text-xs text-stone-500 select-none"
      data-testid="roll"
    >
      <span aria-hidden>🎲</span>
      <span>
        {roll.d1}
        <span className="text-stone-700"> + </span>
        {roll.d2}
        {roll.mod !== 0 && (
          <>
            <span className="text-stone-700"> {sign}</span>
            {roll.mod}
          </>
        )}
        <span className="text-stone-700"> = </span>
        <span className="text-stone-300">{roll.total}</span>
      </span>
      <span className={BAND_COLOR[roll.band]} data-testid="roll-band">
        {roll.band}
      </span>
    </div>
  );
}
