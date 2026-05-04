"use client";

/**
 * /world — the atlas. ASCII map + spoke-by-spoke regional summary
 * with race callouts. Public (no auth required).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { WorldMap } from "@/components/WorldMap";

interface LocationSummary {
  id: string;
  displayName: string;
  tagline: string;
  rooms: number;
  availableResources: string[];
}

interface RaceSummary {
  id: string;
  displayName: string;
  homelandId: string;
  lifespanMedian: number | null;
  racialFeatures: Array<{ label: string; description: string }>;
  subPopulations: Array<{ id: string; label: string; summary: string }>;
}

interface AtlasResp {
  metropolis: LocationSummary;
  metropolisShortName: string;
  spokes: Array<{
    direction: string;
    biome: string;
    homeland: LocationSummary;
    raceId: string;
    towns: LocationSummary[];
  }>;
  asciiMap: string[];
  rivers: Array<{ name: string; summary: string }>;
  races: RaceSummary[];
}

export default function WorldAtlasPage() {
  const [data, setData] = useState<AtlasResp | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch("/api/world/atlas");
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        no atlas
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">the world</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          five racial homelands radiate from a central estuary metropolis.
          two named towns line each spoke. the genre defaults are
          inverted: the elves are not wise, the dwarves are not
          stout, the halflings are not peaceful, the orcs are not
          violent, and the humans are brittle specialists who die young.
        </p>

        <section className="space-y-3">
          <h2 className="text-sm text-stone-100">map</h2>
          <WorldMap />
          <details className="text-[10px] text-stone-500">
            <summary className="cursor-pointer hover:text-stone-300">
              show ASCII map (terminal-friendly)
            </summary>
            <pre className="text-[10px] leading-tight text-stone-400 bg-stone-900/60 border border-stone-800 p-4 overflow-x-auto mt-2">
              {data.asciiMap.join("\n")}
            </pre>
          </details>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm text-stone-100">
            <Link
              href={`/world/${data.metropolis.id}`}
              className="hover:text-amber-300 underline underline-offset-2"
            >
              {data.metropolis.displayName}
            </Link>{" "}
            <span className="text-[10px] font-normal text-stone-500">
              (the metropolis)
            </span>
          </h2>
          <p className="text-xs text-stone-400 italic">{data.metropolis.tagline}</p>
        </section>

        {data.spokes.map((s) => {
          const race = data.races.find((r) => r.homelandId === s.homeland.id);
          return (
            <section
              key={s.direction}
              className="border border-stone-800 bg-stone-900/40 p-4 space-y-3"
            >
              <h2 className="text-sm text-stone-100 flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-widest text-stone-600">
                  {s.direction}
                </span>
                <Link
                  href={`/world/${s.homeland.id}`}
                  className="hover:text-amber-300 underline underline-offset-2"
                >
                  {s.homeland.displayName}
                </Link>
                <span className="text-[10px] text-stone-500 font-normal">
                  ({race?.displayName ?? s.raceId})
                </span>
              </h2>
              <p className="text-xs text-stone-400 italic">{s.homeland.tagline}</p>
              <p className="text-[10px] text-stone-600">biome: {s.biome}</p>
              {race && (
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] text-stone-500">
                    median lifespan: {race.lifespanMedian} yrs · sub-populations:{" "}
                    {race.subPopulations.map((sp) => sp.label).join(", ")}
                  </p>
                  {race.racialFeatures.length > 0 && (
                    <p className="text-[10px] text-amber-400/70 italic">
                      {race.racialFeatures[0].label}:{" "}
                      {race.racialFeatures[0].description.slice(0, 140)}
                      {race.racialFeatures[0].description.length > 140 ? "…" : ""}
                    </p>
                  )}
                </div>
              )}
              <ul className="space-y-1 pt-2 border-t border-stone-800">
                <li className="text-[11px] text-stone-500">towns on this road:</li>
                {s.towns.map((t) => (
                  <li key={t.id} className="text-xs flex items-baseline gap-2">
                    <Link
                      href={`/world/${t.id}`}
                      className="text-stone-300 hover:text-amber-300 underline underline-offset-2"
                    >
                      {t.displayName}
                    </Link>
                    <span className="text-[10px] text-stone-600 italic">
                      {t.tagline}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="space-y-2">
          <h2 className="text-sm text-stone-100">rivers</h2>
          <ul className="space-y-1 text-xs text-stone-400">
            {data.rivers.map((r) => (
              <li key={r.name}>
                <span className="text-stone-200">{r.name}</span> — {r.summary}
              </li>
            ))}
          </ul>
        </section>

        <div className="text-xs text-stone-500">
          <Link
            href="/world/races"
            className="underline underline-offset-2 hover:text-stone-300"
          >
            the five races →
          </Link>
        </div>
      </div>
    </main>
  );
}
