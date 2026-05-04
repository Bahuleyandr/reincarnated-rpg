"use client";

import { useEffect, useRef, useState } from "react";

import type { RollResult } from "@/lib/game/types";

interface Props {
  roll: RollResult;
  /** Disable the settling animation. Defaults to true (animate on
   *  first mount). Set false in static contexts (eval reports,
   *  Storybook). prefers-reduced-motion is also respected. */
  animate?: boolean;
}

const BAND_COLOR = {
  miss: "text-red-400",
  partial: "text-amber-300",
  success: "text-emerald-400",
} as const;

const TUMBLE_DURATION_MS = 900;
const TUMBLE_FRAME_MS = 60;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Render the dice for a 2d6 roll. On first mount the two die faces
 * "tumble" through random 1..6 values for ~900ms before settling on
 * the actual rolled values, giving the player a visible sense of
 * cause-and-effect ("this is why my action played out that way").
 *
 * Cheap: a single setInterval + setState driving CSS classes. No
 * external animation library. Honors prefers-reduced-motion.
 */
export function DiceRollDisplay({ roll, animate = true }: Props) {
  const sign = roll.mod >= 0 ? "+" : "";
  const [d1Display, setD1Display] = useState<number>(roll.d1);
  const [d2Display, setD2Display] = useState<number>(roll.d2);
  const [tumbling, setTumbling] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setD1Display(roll.d1);
      setD2Display(roll.d2);
      setTumbling(false);
      return;
    }
    setTumbling(true);
    intervalRef.current = setInterval(() => {
      setD1Display(1 + Math.floor(Math.random() * 6));
      setD2Display(1 + Math.floor(Math.random() * 6));
    }, TUMBLE_FRAME_MS);
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setD1Display(roll.d1);
      setD2Display(roll.d2);
      setTumbling(false);
    }, TUMBLE_DURATION_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // Re-run only when the roll's identity changes — represented by
    // the seed (deterministic per turn). Using band/total would also
    // re-run on tone-equivalent rolls; seed is the right key.
  }, [roll.seed, roll.d1, roll.d2, animate]);

  const tumbleClass = tumbling ? "text-stone-300 animate-pulse" : "text-stone-300";

  return (
    <div
      className="flex items-baseline gap-2 text-xs text-stone-500 select-none"
      data-testid="roll"
    >
      <span aria-hidden className={tumbling ? "inline-block animate-spin-slow" : ""}>
        🎲
      </span>
      <span>
        <span className={tumbleClass} data-testid="roll-d1">
          {d1Display}
        </span>
        <span className="text-stone-700"> + </span>
        <span className={tumbleClass} data-testid="roll-d2">
          {d2Display}
        </span>
        {roll.mod !== 0 && (
          <>
            <span className="text-stone-700"> {sign}</span>
            {roll.mod}
          </>
        )}
        <span className="text-stone-700"> = </span>
        <span className={tumbling ? "text-stone-600" : "text-stone-300"}>
          {tumbling ? "?" : roll.total}
        </span>
      </span>
      {!tumbling && (
        <span className={BAND_COLOR[roll.band]} data-testid="roll-band">
          {roll.band}
        </span>
      )}
    </div>
  );
}
