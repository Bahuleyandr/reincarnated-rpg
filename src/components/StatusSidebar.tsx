"use client";

import type { Projection } from "@/lib/game/types";

interface Props {
  projection: Projection | null;
}

export function StatusSidebar({ projection }: Props) {
  if (!projection) {
    return (
      <aside
        className="border-r border-stone-800 bg-stone-900/40 px-4 py-4 text-stone-600 text-xs"
        data-testid="status-sidebar"
      >
        loading…
      </aside>
    );
  }
  const vitals = Object.entries(projection.form.vitals);
  const stats = Object.entries(projection.form.stats);
  const formState = Object.entries(projection.form.state);

  return (
    <aside
      className="border-r border-stone-800 bg-stone-900/40 px-4 py-4 text-xs space-y-5 overflow-y-auto"
      data-testid="status-sidebar"
    >
      <section className="space-y-1">
        <h3 className="text-stone-100 text-sm tracking-wide">
          {projection.form.id}
        </h3>
        <p className="text-stone-500">turn {projection.turn} · {projection.location.roomId}</p>
        <p
          className={
            projection.status === "active"
              ? "text-emerald-400"
              : projection.status === "won"
                ? "text-amber-300"
                : "text-red-400"
          }
        >
          {projection.status}
        </p>
      </section>

      <section className="space-y-1">
        <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
          vitals
        </h4>
        <ul className="space-y-1">
          {vitals.map(([name, v]) => {
            const max = projection.form.vitalsMax[name] ?? 0;
            const ratio = max > 0 ? v / max : 0;
            return (
              <li key={name}>
                <div className="flex justify-between">
                  <span className="text-stone-500">{name}</span>
                  <span
                    className="text-stone-200"
                    data-testid={`vital-${name}`}
                  >
                    {v}/{max}
                  </span>
                </div>
                <div
                  className="h-0.5 bg-stone-800 mt-1"
                  aria-hidden
                >
                  <div
                    className={
                      ratio < 0.25
                        ? "h-full bg-red-500"
                        : ratio < 0.5
                          ? "h-full bg-amber-400"
                          : "h-full bg-emerald-500"
                    }
                    style={{ width: `${Math.max(0, ratio * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-1">
        <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
          stats
        </h4>
        <ul className="space-y-0.5">
          {stats.map(([name, v]) => (
            <li key={name} className="flex justify-between">
              <span className="text-stone-500">{name}</span>
              <span className="text-stone-200">
                {v >= 0 ? "+" : ""}
                {v}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {formState.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
            form state
          </h4>
          <ul className="space-y-0.5">
            {formState.map(([name, v]) => (
              <li key={name} className="flex justify-between">
                <span className="text-stone-500">{name}</span>
                <span className="text-stone-200">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1">
        <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
          discovered
        </h4>
        <ul className="space-y-0.5 text-stone-300">
          {projection.location.discovered.map((id) => (
            <li
              key={id}
              className={
                id === projection.location.roomId
                  ? "text-stone-100"
                  : "text-stone-500"
              }
            >
              {id === projection.location.roomId ? "→ " : "  "}
              {id}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
