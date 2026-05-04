"use client";

/**
 * /world/[id] — per-location detail page. Rooms, ambient pool,
 * available resources, regional flavor + sub-populations.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface LocationDetail {
  id: string;
  displayName: string;
  tagline: string;
  ambientPool: string[];
  entryRoomId: string;
  rooms: Array<{
    id: string;
    displayName: string;
    summary: string;
    ambientPool: string[];
    exitCount: number;
  }>;
  availableResources: Array<{
    id: string;
    name: string;
    description: string;
    rarity: string;
    baseValue: number;
    tags: string[];
  }>;
  region: {
    raceId: string | null;
    raceVoice: string | null;
    subPopulations: string[];
  } | null;
}

const RARITY_COLOR: Record<string, string> = {
  common: "text-stone-400",
  uncommon: "text-emerald-400",
  rare: "text-amber-400",
  epic: "text-fuchsia-400",
};

export default function CityPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<LocationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await fetch(`/api/world/locations/${id}`);
    if (r.status === 404) {
      setNotFound(true);
    } else if (r.ok) {
      setData(await r.json());
    }
    setLoading(false);
  }, [id]);

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
  if (notFound) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex flex-col items-center justify-center gap-3">
        <p>this place is not on the atlas.</p>
        <Link
          href="/world"
          className="text-xs underline underline-offset-2 hover:text-stone-300"
        >
          ← back to the world
        </Link>
      </main>
    );
  }
  if (!data) return null;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">{data.displayName}</h1>
          <Link
            href="/world"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← world
          </Link>
        </header>

        <p className="text-stone-400 italic text-sm leading-6">{data.tagline}</p>

        {data.region && data.region.raceId && (
          <section className="border border-amber-800/40 bg-amber-950/10 p-4 space-y-1">
            <h2 className="text-[10px] uppercase tracking-widest text-amber-500">
              regional flavor
            </h2>
            <p className="text-xs text-stone-300">
              <span className="text-amber-300">{data.region.raceId}</span>
              {data.region.raceVoice && (
                <span className="text-stone-400">
                  {" — "}
                  {data.region.raceVoice}
                </span>
              )}
            </p>
            {data.region.subPopulations.length > 0 && (
              <p className="text-[10px] text-stone-500 italic">
                sub-populations: {data.region.subPopulations.join(", ")}
              </p>
            )}
          </section>
        )}

        {data.ambientPool.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm text-stone-100">ambient detail</h2>
            <ul className="space-y-1">
              {data.ambientPool.map((line, i) => (
                <li
                  key={i}
                  className="text-xs text-stone-400 italic leading-5 border-l-2 border-stone-800 pl-3"
                >
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm text-stone-100">
            rooms ({data.rooms.length})
          </h2>
          <ul className="space-y-2">
            {data.rooms.map((r) => (
              <li
                key={r.id}
                className={`border ${
                  r.id === data.entryRoomId
                    ? "border-amber-700/60"
                    : "border-stone-800"
                } bg-stone-900/40 p-3 space-y-1`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-stone-200 text-sm">
                    {r.displayName}
                  </span>
                  {r.id === data.entryRoomId && (
                    <span className="text-[10px] uppercase tracking-widest text-amber-500">
                      entry
                    </span>
                  )}
                  <span className="text-[10px] text-stone-600 ml-auto">
                    {r.exitCount} exit{r.exitCount === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-xs text-stone-400 leading-5">{r.summary}</p>
              </li>
            ))}
          </ul>
        </section>

        {data.availableResources.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm text-stone-100">
              local resources ({data.availableResources.length})
            </h2>
            <ul className="space-y-1.5">
              {data.availableResources.map((r) => (
                <li
                  key={r.id}
                  className="text-xs flex items-baseline gap-2 border-b border-stone-900 pb-1"
                >
                  <span className="text-stone-200 font-semibold w-40 shrink-0 truncate">
                    {r.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide w-16 ${RARITY_COLOR[r.rarity] ?? "text-stone-500"}`}
                  >
                    {r.rarity}
                  </span>
                  <span className="text-stone-500 flex-1 truncate italic">
                    {r.description}
                  </span>
                  <span className="text-amber-400/70 tabular-nums w-10 text-right">
                    {r.baseValue}c
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
