"use client";

/**
 * In-run companions roster — Roadmap 64.
 *
 * Polls /api/play/companions every few seconds; renders the
 * party state (level, hp bars, dead/alive). When the player
 * has bonded NPCs that aren't yet in the run, those are NOT
 * shown here — summoning happens via the model's narration
 * tools (future) or via /api/play/companions POST.
 */
import { useCallback, useEffect, useState } from "react";

interface Companion {
  worldNpcId: string;
  slug: string;
  displayName: string;
  level: number;
  currentHp: number;
  maxHp: number;
  status: "alive" | "dead" | "left";
  joinedAtTurn: number;
}

const STATUS_COLOR: Record<string, string> = {
  alive: "text-emerald-400",
  dead: "text-red-400",
  left: "text-stone-500",
};

export function InRunCompanions() {
  const [rows, setRows] = useState<Companion[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/play/companions");
      if (!r.ok) return;
      const d = (await r.json()) as { companions: Companion[] };
      setRows(d.companions);
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const id = setInterval(load, 8_000);
    return () => clearInterval(id);
  }, [load]);

  // Don't show anything until the first load completes — avoids
  // flashing an empty box during first paint. After load, hide
  // entirely if the party is empty (most runs).
  if (!loaded || rows.length === 0) return null;

  return (
    <section className="border border-stone-800 bg-stone-900/40 px-3 py-2 space-y-1">
      <h2 className="text-[10px] uppercase tracking-widest text-stone-500">
        with you
      </h2>
      <ul className="space-y-1">
        {rows.map((c) => {
          const pct =
            c.maxHp > 0
              ? Math.max(0, Math.min(100, (c.currentHp / c.maxHp) * 100))
              : 0;
          return (
            <li
              key={c.worldNpcId}
              className="text-xs flex items-center gap-2"
            >
              <span className="flex-1 truncate text-stone-200">
                {c.displayName}
              </span>
              <span className="text-[10px] text-stone-600">L{c.level}</span>
              <div className="w-16 h-1.5 border border-stone-800 bg-stone-950 relative">
                <div
                  className={`absolute inset-y-0 left-0 ${
                    c.status === "dead"
                      ? "bg-red-700"
                      : pct < 33
                        ? "bg-amber-700"
                        : "bg-emerald-700"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-stone-500 w-10 text-right">
                {c.currentHp}/{c.maxHp}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wide ${STATUS_COLOR[c.status] ?? "text-stone-500"}`}
              >
                {c.status}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
