"use client";

/**
 * WorldBanner — small "what's happening in the world today"
 * panel for the home page. Pulls /api/world/state and surfaces
 * the active festival (if any), the current chapter, and the
 * wyrm phase.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface WorldState {
  utcDate: string;
  chapter: { book: number; chapter: number; title: string } | null;
  wyrmPhase: { phase: string; label: string } | null;
  activeCampaigns: number;
  festivalsToday: Array<{
    id: string;
    displayName: string;
    region: string;
    raceId: string;
    summary: string;
  }>;
}

export function WorldBanner() {
  const [state, setState] = useState<WorldState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/world/state");
      if (r.ok) setState(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  if (!state) return null;

  const fest = state.festivalsToday[0];

  return (
    <section className="border border-stone-800 bg-stone-900/40 px-3 py-2 space-y-1 text-xs">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest text-stone-600">
          today in the world
        </span>
        {state.chapter && (
          <span className="text-stone-400">
            book {state.chapter.book}, ch{" "}
            <span className="text-stone-200">
              {state.chapter.chapter}: {state.chapter.title}
            </span>
          </span>
        )}
        {state.wyrmPhase && (
          <span className="text-amber-400/80 ml-auto">
            wyrm: {state.wyrmPhase.label}
          </span>
        )}
      </div>
      {fest && (
        <Link
          href={`/world/${fest.region}`}
          className="block border-l-2 border-amber-700/60 pl-2 hover:bg-stone-900/60"
        >
          <div className="text-amber-300 text-[11px]">
            {fest.displayName} —{" "}
            <span className="text-stone-400">{fest.region}</span>
          </div>
          <div className="text-[10px] text-stone-500 italic">
            {fest.summary}
          </div>
        </Link>
      )}
      <div className="text-[10px] text-stone-600">
        {state.activeCampaigns === 0
          ? "no campaigns active right now"
          : `${state.activeCampaigns} campaign${
              state.activeCampaigns === 1 ? "" : "s"
            } in progress`}
      </div>
    </section>
  );
}
