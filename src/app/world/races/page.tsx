"use client";

/**
 * /world/races — the five races. Sub-populations + racial features
 * + the subverted-default callout.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface RaceSummary {
  id: string;
  displayName: string;
  homelandId: string;
  lifespanMedian: number | null;
  racialFeatures: Array<{ label: string; description: string }>;
  subPopulations: Array<{ id: string; label: string; summary: string }>;
}

export default function RacesPage() {
  const [races, setRaces] = useState<RaceSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/world/atlas");
    if (r.ok) {
      const d = (await r.json()) as { races: RaceSummary[] };
      setRaces(d.races);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  if (!loaded) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">the five races</h1>
          <Link
            href="/world"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← world
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          every default is inverted. the lore here drives both the
          narrator&apos;s voice when you wake in a racial homeland and the
          mechanics that scale by sub-population (some shipped, some
          coming).
        </p>

        {races.map((r) => (
          <section
            key={r.id}
            className="border border-stone-800 bg-stone-900/40 p-4 space-y-3"
          >
            <header className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-sm text-stone-100">{r.displayName}</h2>
              <Link
                href={`/world/${r.homelandId}`}
                className="text-[10px] text-amber-400/80 underline underline-offset-2 hover:text-amber-300"
              >
                {r.homelandId} →
              </Link>
              {r.lifespanMedian && (
                <span className="text-[10px] text-stone-500 ml-auto">
                  median lifespan {r.lifespanMedian} yrs
                </span>
              )}
            </header>

            {r.racialFeatures.length > 0 && (
              <ul className="space-y-2">
                {r.racialFeatures.map((rf) => (
                  <li
                    key={rf.label}
                    className="text-xs border-l-2 border-amber-700/60 pl-2"
                  >
                    <div className="text-stone-200 font-semibold">
                      {rf.label}
                    </div>
                    <div className="text-stone-400 leading-5">
                      {rf.description}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {r.subPopulations.length > 0 && (
              <div className="pt-2 border-t border-stone-800 space-y-1">
                <h3 className="text-[10px] uppercase tracking-widest text-stone-600">
                  sub-populations
                </h3>
                <ul className="space-y-1">
                  {r.subPopulations.map((sp) => (
                    <li key={sp.id} className="text-xs">
                      <span className="text-stone-300 font-semibold">
                        {sp.label}
                      </span>{" "}
                      <span className="text-stone-500">— {sp.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
