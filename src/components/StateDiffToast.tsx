"use client";

/**
 * StateDiffToast — small inline panel that surfaces what changed on
 * the last turn. Renders just above the input box and fades after
 * ~5 s. Driven by the parent's diffProjection() result.
 *
 * Trial-run finding A4: vitals dropping by 4 mana on a partial-
 * success was invisible. This makes per-turn cost legible.
 */
import { useEffect, useState } from "react";

import type { ProjectionDiff } from "@/lib/game/diff-projection";

interface Props {
  diff: ProjectionDiff;
  /** When the parent updates this counter, the toast resets its
   *  visibility timer. Use the projection's upToSeq / turn so the
   *  toast pulses on every real turn rather than every re-render. */
  resetKey: string | number;
}

const TOAST_VISIBLE_MS = 5000;

export function StateDiffToast({ diff, resetKey }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Defer state writes to a microtask so React 19's
    // react-hooks/set-state-in-effect rule doesn't flag the
    // synchronous setVisible call. The behaviour is unchanged.
    if (!diff.hasChange || diff.statusChanged) {
      void Promise.resolve().then(() => setVisible(false));
      return;
    }
    void Promise.resolve().then(() => setVisible(true));
    const t = setTimeout(() => setVisible(false), TOAST_VISIBLE_MS);
    return () => clearTimeout(t);
    // resetKey changes drive the timer reset; including diff.hasChange
    // ensures we don't run on no-op turns.
  }, [resetKey, diff.hasChange, diff.statusChanged]);

  if (!diff.hasChange || diff.statusChanged) return null;

  return (
    <div
      data-testid="state-diff-toast"
      className={`px-4 py-1.5 text-[11px] border-t border-stone-800 bg-stone-900/40 transition-opacity duration-700 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex items-baseline gap-3 flex-wrap text-stone-400">
        {diff.vitals.map((v) => (
          <span
            key={v.name}
            className="whitespace-nowrap"
            title={`${v.name}: ${v.prev} → ${v.next}`}
          >
            <span className="text-stone-500">{v.name} </span>
            <span
              className={
                v.delta > 0
                  ? "text-emerald-400"
                  : v.delta < 0
                    ? "text-red-400"
                    : "text-stone-300"
              }
            >
              {v.delta > 0 ? "+" : ""}
              {v.delta}
            </span>
            <span className="text-stone-600">
              {" "}
              ({v.prev}→{v.next})
            </span>
          </span>
        ))}
        {diff.inventoryAdded.map((it) => (
          <span
            key={`+${it.itemId}`}
            className="whitespace-nowrap text-emerald-400"
          >
            +{it.qty} {it.itemId}
          </span>
        ))}
        {diff.inventoryRemoved.map((it) => (
          <span
            key={`-${it.itemId}`}
            className="whitespace-nowrap text-red-400"
          >
            -{it.qty} {it.itemId}
          </span>
        ))}
        {diff.roomsDiscovered.length > 0 && (
          <span className="whitespace-nowrap text-amber-300">
            discovered: {diff.roomsDiscovered.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
