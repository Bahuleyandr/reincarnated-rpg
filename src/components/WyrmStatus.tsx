"use client";

import { useEffect, useState } from "react";

interface Wyrm {
  hp: number;
  hpMax: number;
  phase: string;
  phaseLabel: string;
  progress: number;
  progressMax: number;
  contributorCount: number;
  fellCount: number;
  lastFellAt: string | null;
}

/**
 * Live status of the Long Wyrm — the raid HP boss every player's
 * actions chip away at. Polls /api/world every 60s; HP bar is
 * inverted (fuller bar = more damage done = closer to fall).
 *
 * The "fellCount" subtitle tracks how many times this incarnation
 * of the Wyrm has fallen and re-emerged across the world's history,
 * giving the cycle texture: "you are damaging the 4th Wyrm."
 */
export function WyrmStatus() {
  const [wyrm, setWyrm] = useState<Wyrm | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/world");
        if (!r.ok) return;
        const d = (await r.json()) as { wyrm?: Wyrm };
        if (!cancelled && d.wyrm) setWyrm(d.wyrm);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!wyrm) return null;

  // Damage already dealt = hpMax - hp. Bar fills as the world hurts
  // it. Color tone shifts from indifferent stone → amber → red as
  // the Wyrm approaches falling.
  const damagePct = ((wyrm.hpMax - wyrm.hp) / wyrm.hpMax) * 100;
  const tone =
    damagePct >= 80
      ? "bg-red-700"
      : damagePct >= 50
        ? "bg-amber-700"
        : "bg-stone-600";

  return (
    <section
      className="border border-stone-800 bg-stone-900/40 p-4 space-y-2 text-xs"
      title="The Long Wyrm — the raid boss every contribution chips away at."
    >
      <div className="flex items-baseline justify-between">
        <span className="text-stone-100 text-sm">
          the Long Wyrm
          {wyrm.fellCount > 0 && (
            <span className="text-stone-500 text-[10px] ml-2">
              · {wyrm.fellCount === 1 ? "fallen once" : `fallen ${wyrm.fellCount} times`}
            </span>
          )}
        </span>
        <span className="text-stone-600 text-[10px] uppercase tracking-widest">
          {wyrm.phaseLabel}
        </span>
      </div>
      <div className="h-2 bg-stone-950 border border-stone-800 relative overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 transition-all ${tone}`}
          style={{ width: `${damagePct}%` }}
          aria-label={`damage dealt: ${damagePct.toFixed(1)}%`}
        />
      </div>
      <div className="text-[10px] text-stone-600 leading-4 flex justify-between">
        <span>
          HP {wyrm.hp.toLocaleString()} / {wyrm.hpMax.toLocaleString()}
        </span>
        <span>
          {wyrm.contributorCount.toLocaleString()} souls contributing
        </span>
      </div>
    </section>
  );
}
