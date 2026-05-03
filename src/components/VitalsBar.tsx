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
