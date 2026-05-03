"use client";

import type { Projection } from "@/lib/game/types";

interface Props {
  projection: Projection | null;
}

const STATUS_GLYPH: Record<string, string> = {
  open: "·",
  done: "✓",
  failed: "✗",
};

const STATUS_COLOR: Record<string, string> = {
  open: "text-stone-300",
  done: "text-emerald-400",
  failed: "text-red-400",
};

export function QuestLog({ projection }: Props) {
  if (!projection) return null;
  const objectives = Object.entries(projection.quest.objectives);
  const xp = projection.xp;

  if (objectives.length === 0 && xp === 0) {
    return (
      <section
        className="border-b border-stone-800 px-4 py-3 text-stone-600 text-xs italic"
        data-testid="quest-log"
      >
        no objectives yet.
      </section>
    );
  }

  return (
    <section
      className="border-b border-stone-800 px-4 py-3 space-y-2"
      data-testid="quest-log"
    >
      <div className="flex items-baseline justify-between">
        <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
          {projection.quest.id ?? "objectives"}
        </h4>
        <span className="text-xs text-stone-500">xp {xp}</span>
      </div>
      <ul className="space-y-1 text-xs">
        {objectives.map(([name, status]) => (
          <li
            key={name}
            className={`flex items-baseline gap-2 ${
              STATUS_COLOR[status] ?? "text-stone-300"
            }`}
            data-testid={`objective-${name}`}
          >
            <span className="text-stone-600 select-none">
              {STATUS_GLYPH[status] ?? "·"}
            </span>
            <span
              className={status === "done" ? "line-through opacity-60" : ""}
            >
              {name}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
