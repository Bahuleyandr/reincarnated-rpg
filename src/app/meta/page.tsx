"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface MetaArcResp {
  arc: {
    id: string;
    progress: number;
    progressMax: number;
    phase: string;
    phaseLabel: string;
    flavor: string;
    totalFeeds: number;
    totalStarves: number;
    contributorCount: number;
    meta: { cycle?: number; lastBrokenAt?: string } | null;
    updatedAt: string;
  };
  phases: Array<{
    phase: string;
    label: string;
    min: number;
    max: number;
    flavor: string;
  }>;
  recentContributions: Array<{
    id: string;
    delta: number;
    reason: string;
    prose: string | null;
    formId: string | null;
    locationId: string | null;
    phaseAtContribution: string | null;
    createdAt: string;
  }>;
}

export default function MetaPage() {
  const [data, setData] = useState<MetaArcResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetch("/api/meta");
      if (r.ok && !cancelled) setData(await r.json());
      setLoading(false);
    }
    load();
    const id = setInterval(load, 30_000); // refresh every 30s
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading)
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  if (!data)
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        no data
      </main>
    );

  const { arc, phases, recentContributions } = data;
  const pct = (arc.progress / arc.progressMax) * 100;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">the Long Wyrm</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <section className="border border-stone-800 p-5 bg-stone-900/40 space-y-4">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-stone-600">
                phase
              </div>
              <div className="text-2xl text-amber-300">{arc.phaseLabel}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-stone-600">
                progress
              </div>
              <div className="text-stone-300">
                {arc.progress} <span className="text-stone-600">/</span>{" "}
                {arc.progressMax}
              </div>
            </div>
          </div>
          {/* phase bar */}
          <div className="h-2 bg-stone-900 border border-stone-800 relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-amber-700"
              style={{ width: `${pct}%` }}
            />
            {phases.slice(1).map((p) => (
              <div
                key={p.phase}
                className="absolute inset-y-0 w-px bg-stone-700"
                style={{ left: `${(p.min / arc.progressMax) * 100}%` }}
                title={p.label}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] text-stone-600">
            {phases.map((p) => (
              <span
                key={p.phase}
                className={
                  p.phase === arc.phase ? "text-amber-400" : "text-stone-600"
                }
              >
                {p.label.toLowerCase()}
              </span>
            ))}
          </div>
          <p className="text-stone-300 text-sm leading-6 italic">
            {arc.flavor}
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-stone-800">
            <Stat label="contributors" value={arc.contributorCount} />
            <Stat label="feeds" value={arc.totalFeeds} accent="text-red-400" />
            <Stat
              label="starves"
              value={arc.totalStarves}
              accent="text-emerald-400"
            />
          </div>
          {arc.meta?.cycle && arc.meta.cycle > 1 && (
            <p className="text-[11px] text-stone-500 italic">
              cycle {arc.meta.cycle} — the wyrm has broken{" "}
              {arc.meta.cycle - 1} time{arc.meta.cycle === 2 ? "" : "s"} before.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-stone-100 text-sm">recent contributions</h2>
          {recentContributions.length === 0 ? (
            <p className="text-stone-500 text-sm italic">
              the wyrm waits. no contributions yet.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {recentContributions.map((c) => (
                <li
                  key={c.id}
                  className="border border-stone-800 px-4 py-3 bg-stone-900/40 flex gap-4 items-start"
                >
                  <span
                    className={`text-sm whitespace-nowrap ${
                      c.delta > 0
                        ? "text-red-400"
                        : c.delta < 0
                          ? "text-emerald-400"
                          : "text-stone-500"
                    }`}
                  >
                    {c.delta > 0 ? `+${c.delta}` : c.delta}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-stone-300">{c.prose ?? c.reason}</div>
                    <div className="text-[10px] text-stone-600 mt-1">
                      {c.formId ?? "?"} · {c.locationId ?? "?"} ·{" "}
                      {c.phaseAtContribution ?? "?"} ·{" "}
                      {new Date(c.createdAt).toLocaleString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="text-[11px] text-stone-500 leading-5 border-t border-stone-800 pt-4">
          <p>
            The Long Wyrm is a meta-arc that lives above every individual
            run. Every player's outcome contributes a small delta — deaths
            and absorbs feed it; wins and heals starve it. When progress
            crosses a phase boundary, every player's next turn lands in a
            transformed world. When it crosses 1000, the wyrm breaks
            through and the cycle begins again — but the world remembers.
          </p>
        </section>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent = "text-stone-100",
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="border border-stone-800 p-3 bg-stone-950">
      <div className="text-[10px] uppercase tracking-widest text-stone-600">
        {label}
      </div>
      <div className={accent}>{value}</div>
    </div>
  );
}
