"use client";

import { useEffect, useRef, useState } from "react";

import type { RollResult } from "@/lib/game/types";

import { ManualHelpButton } from "./InstructionManual";

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
    // Defer the synchronous-setState branch to a microtask so
    // React 19's react-hooks/set-state-in-effect rule passes.
    // The interval / timeout callbacks below already run async,
    // so they're fine.
    if (!animate || prefersReducedMotion()) {
      void Promise.resolve().then(() => {
        setD1Display(roll.d1);
        setD2Display(roll.d2);
        setTumbling(false);
      });
      return;
    }
    void Promise.resolve().then(() => setTumbling(true));
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

  // Form-specific dice variants: render either as "d1 + d2" or
  // (for 1d12) as the single die's value. Variant label appears
  // before the dice when the form opted out of plain 2d6.
  const isSingleDie = roll.variant === "1d12";
  const variantLabel = roll.variant && roll.variant !== "2d6" ? roll.variant : null;

  return (
    <div
      className="flex items-baseline gap-2 text-xs text-stone-500 select-none"
      data-testid="roll"
    >
      <span aria-hidden className={tumbling ? "animate-spin-slow inline-block" : ""}>
        🎲
      </span>
      {variantLabel && (
        <span
          className="text-[10px] tracking-widest text-stone-600 uppercase"
          data-testid="roll-variant"
        >
          {variantLabel}
        </span>
      )}
      <span>
        <span className={tumbleClass} data-testid="roll-d1">
          {d1Display}
        </span>
        {!isSingleDie && (
          <>
            <span className="text-stone-700"> + </span>
            <span className={tumbleClass} data-testid="roll-d2">
              {d2Display}
            </span>
          </>
        )}
        {roll.mod !== 0 && (
          <>
            <span className="text-stone-700"> {sign}</span>
            <span
              title={modSourcesTitle(roll.modSources, roll.mod)}
              className={
                roll.modSources && roll.modSources.length > 0
                  ? "cursor-help underline decoration-stone-700 decoration-dotted underline-offset-2"
                  : ""
              }
              data-testid="roll-mod"
            >
              {roll.mod}
            </span>
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
      {!tumbling && roll.modSources && roll.modSources.length > 0 && (
        <span className="text-[10px] text-stone-600" data-testid="roll-mod-breakdown">
          (
          {roll.modSources
            .map((s) => `${s.delta >= 0 ? "+" : ""}${s.delta} ${s.source}`)
            .join(", ")}
          )
        </span>
      )}
      {!tumbling && <ManualHelpButton topicId="dice" compact testId="dice-help" />}
    </div>
  );
}

/** Tooltip text for the mod number — same content as the inline
 *  breakdown, but available even when the breakdown is hidden by
 *  width constraints. */
function modSourcesTitle(sources: RollResult["modSources"], total: number): string | undefined {
  if (!sources || sources.length === 0) return undefined;
  return sources
    .map((s) => `${s.delta >= 0 ? "+" : ""}${s.delta} ${s.source}`)
    .concat(
      total !== sources.reduce((a, s) => a + s.delta, 0)
        ? [`(net ${total >= 0 ? "+" : ""}${total})`]
        : [],
    )
    .join(", ");
}
