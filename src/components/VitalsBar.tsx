"use client";

import type { Projection } from "@/lib/game/types";

interface VitalsBarProps {
  projection: Projection | null;
}

export function VitalsBar({ projection }: VitalsBarProps) {
  if (!projection) {
    return (
      <div className="border-b border-stone-800 px-2 py-2 text-stone-600 text-xs">
        loading&hellip;
      </div>
    );
  }
  const vitals = projection.form.vitals;
  const max = projection.form.vitalsMax;
  const status = projection.status;
  const turn = projection.turn;
  const room = projection.location.roomId;
  // Bad-luck stack from moderation curses. While > 0, rolls take a
  // -min(2, badLuck) penalty (see lib/moderation/badLuckRollPenalty).
  // Decays -1 each turn naturally.
  const badLuck =
    typeof projection.form.state["bad_luck"] === "number"
      ? (projection.form.state["bad_luck"] as number)
      : 0;
  const luckPenalty = Math.min(2, Math.max(0, Math.floor(badLuck)));

  return (
    <div className="border-b border-stone-800 px-2 py-2 text-xs flex items-center gap-4 text-stone-400">
      {Object.entries(vitals).map(([name, v]) => (
        <span key={name} className="flex items-center gap-1">
          <span className="text-stone-500">{name}</span>
          <span className="text-stone-200" data-testid={`vital-${name}`}>
            {v}/{max[name] ?? "?"}
          </span>
        </span>
      ))}
      {badLuck > 0 && (
        <span
          className="flex items-center gap-1 text-rose-400"
          data-testid="bad-luck"
          title={`Cursed: ${badLuck} stacks. Rolls take -${luckPenalty} until it decays. Each turn drops the stack by 1.`}
        >
          🩸 <span className="text-rose-300">−{luckPenalty}</span>
          <span className="text-rose-700/70 text-[10px]">({badLuck})</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        <span>
          <span className="text-stone-500">turn</span>{" "}
          <span className="text-stone-200" data-testid="turn">
            {turn}
          </span>
        </span>
        <span>
          <span className="text-stone-500">room</span>{" "}
          <span className="text-stone-200">{room}</span>
        </span>
        <span
          className={
            status === "active"
              ? "text-emerald-400"
              : status === "won"
                ? "text-amber-300"
                : "text-red-400"
          }
          data-testid="status"
        >
          {status}
        </span>
      </span>
    </div>
  );
}
