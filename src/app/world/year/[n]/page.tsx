"use client";

/**
 * /world/year/[n] — Year archive page.
 * Phase 7 Day 62.
 */
import Link from "next/link";
import { use, useEffect, useState } from "react";

interface Resp {
  year: number;
  ending: {
    id: string;
    label: string;
    resolvedAtMs: number;
    resolutionData: unknown;
  } | null;
  branches: Array<{
    id: number;
    chapterId: number;
    question: string;
    resolvedPath: string | null;
  }>;
  votes: Array<{
    id: number;
    chapterId: number;
    question: string;
    winningOption: string | null;
  }>;
}

export default function YearArchivePage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n } = use(params);
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/world/year/${n}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as Resp);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [n]);

  if (!data) {
    return (
      <main className="p-8 text-stone-500 font-mono">
        loading year {n}…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl text-stone-100">Year {data.year}</h1>
          {data.ending ? (
            <p className="text-amber-300 italic mt-1">{data.ending.label}</p>
          ) : (
            <p className="text-stone-600 italic mt-1">unfinished</p>
          )}
          <Link
            href="/world/codex"
            className="text-stone-600 text-xs underline mt-2 inline-block"
          >
            ← codex
          </Link>
        </header>

        {data.branches.some((b) => b.resolvedPath) && (
          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-widest text-stone-500">
              branches
            </h2>
            <ul className="space-y-1 text-sm">
              {data.branches
                .filter((b) => b.resolvedPath)
                .map((b) => (
                  <li key={b.id} className="text-stone-300 leading-5">
                    Branch {b.id}:{" "}
                    <span className="italic">{b.question}</span> →{" "}
                    <span className="text-amber-300">{b.resolvedPath}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {data.votes.some((v) => v.winningOption) && (
          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-widest text-stone-500">
              votes
            </h2>
            <ul className="space-y-1 text-sm">
              {data.votes
                .filter((v) => v.winningOption)
                .map((v) => (
                  <li key={v.id} className="text-stone-300 leading-5">
                    <span className="italic">{v.question}</span> →{" "}
                    <span className="text-amber-300">{v.winningOption}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
