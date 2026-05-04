"use client";

/**
 * In-run companions roster + summon panel.
 *
 * Polls /api/play/companions every few seconds.
 *   - Top section: who's currently with you (HP bars, level, status)
 *   - Bottom section: bonded NPCs you can call into the run
 *
 * Hidden entirely when both lists are empty (most anon runs).
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

interface Summonable {
  slug: string;
  name: string;
  timesMet: number;
  relationshipScore: number;
}

const STATUS_COLOR: Record<string, string> = {
  alive: "text-emerald-400",
  dead: "text-red-400",
  left: "text-stone-500",
};

export function InRunCompanions() {
  const [rows, setRows] = useState<Companion[]>([]);
  const [summonable, setSummonable] = useState<Summonable[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/play/companions");
      if (!r.ok) return;
      const d = (await r.json()) as {
        companions: Companion[];
        summonable: Summonable[];
      };
      setRows(d.companions);
      setSummonable(d.summonable ?? []);
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

  async function summon(slug: string) {
    if (busy) return;
    setBusy(slug);
    setMsg(null);
    try {
      const r = await fetch("/api/play/companions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "summon", slug }),
      });
      const d = (await r.json()) as
        | { ok: true; row: { displayName: string } }
        | { ok: false; error: string };
      if ("ok" in d && d.ok) {
        setMsg(`${d.row.displayName} joined.`);
        await load();
      } else if ("error" in d) {
        setMsg(`error: ${d.error}`);
      }
    } finally {
      setBusy(null);
    }
  }

  // Don't show anything until first load completes — avoids flashing
  // empty box at first paint. After load, hide entirely if there's
  // no party AND no summonable companions.
  if (!loaded || (rows.length === 0 && summonable.length === 0)) return null;

  return (
    <section className="border border-stone-800 bg-stone-900/40 px-3 py-2 space-y-2">
      {rows.length > 0 && (
        <div className="space-y-1">
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
        </div>
      )}

      {summonable.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-stone-800">
          <h2 className="text-[10px] uppercase tracking-widest text-stone-500">
            bonded — call into the run
          </h2>
          <ul className="space-y-1">
            {summonable.map((s) => (
              <li key={s.slug} className="text-xs flex items-center gap-2">
                <span className="flex-1 truncate text-stone-300">
                  {s.name}
                </span>
                <span className="text-[10px] text-stone-600">
                  met×{s.timesMet} · ♥{s.relationshipScore}
                </span>
                <button
                  type="button"
                  onClick={() => summon(s.slug)}
                  disabled={busy === s.slug}
                  className="text-[10px] px-2 py-0.5 border border-stone-700 rounded text-stone-300 hover:bg-stone-800 disabled:opacity-50"
                >
                  {busy === s.slug ? "summoning…" : "summon"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="text-[10px] text-stone-400 italic">{msg}</p>}
    </section>
  );
}
