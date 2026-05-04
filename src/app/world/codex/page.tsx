"use client";

/**
 * /world/codex — Catch-Up Codex.
 *
 * Phase 7 Day 58. Public year-to-date read for new players
 * arriving mid-year + returning veterans wanting context. Lists
 * the current chapter, resolved branches, vote outcomes, faction
 * standings, year endings (history).
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface CodexResp {
  currentChapter: {
    book: number;
    chapter: number;
    chapterInBook: number;
    year: number;
    title: string;
    theme: string;
  };
  branches: Array<{
    id: number;
    chapterId: number;
    question: string;
    resolvedPath: string | null;
    resolvedAtMs: number | null;
  }>;
  votes: Array<{
    id: number;
    chapterId: number;
    question: string;
    winningOption: string | null;
    resolvedAtMs: number | null;
  }>;
  factions: Array<{
    id: string;
    label: string;
    memberCount: number;
    cumulativeContribution: number;
    active: boolean;
  }>;
  yearHistory: Array<{
    year: number;
    endingId: string;
    endingLabel: string;
    resolvedAt: string;
  }>;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export default function CodexPage() {
  const [data, setData] = useState<CodexResp | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/world/codex")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as CodexResp);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return (
      <main className="p-8 text-stone-500 font-mono">loading the codex…</main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl text-stone-100">the codex</h1>
          <p className="text-stone-500 text-xs mt-1">
            What has happened in the world so far. Catch up before you
            wake up here.
          </p>
          <Link
            href="/"
            className="text-stone-600 text-xs underline mt-2 inline-block"
          >
            ← home
          </Link>
        </header>

        <section className="border border-stone-800 bg-stone-900/40 p-4 space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-stone-500">
            now
          </div>
          <div className="text-lg text-stone-200">
            {data.currentChapter.title}
          </div>
          <div className="text-xs text-stone-500">
            Year {data.currentChapter.year} · Book{" "}
            {ROMAN[data.currentChapter.book] ?? data.currentChapter.book} ·
            Chapter {data.currentChapter.chapterInBook} of 4
          </div>
          <div className="text-xs italic text-stone-400 leading-5">
            {data.currentChapter.theme}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm uppercase tracking-widest text-stone-500">
            factions
          </h2>
          <ul className="space-y-1 text-sm">
            {data.factions.map((f) => (
              <li
                key={f.id}
                className={`flex justify-between ${
                  f.active ? "text-stone-300" : "text-stone-600"
                }`}
              >
                <span>{f.label}</span>
                <span className="text-stone-500 tabular-nums">
                  {f.memberCount} pledges · {f.cumulativeContribution}
                  &nbsp;influence
                  {!f.active && (
                    <span className="text-stone-700 ml-2">(locked)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {data.branches.some((b) => b.resolvedPath) && (
          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-widest text-stone-500">
              branches resolved
            </h2>
            <ul className="space-y-1 text-sm">
              {data.branches
                .filter((b) => b.resolvedPath)
                .map((b) => (
                  <li key={b.id} className="text-stone-300 leading-5">
                    Branch {b.id} (Chapter {b.chapterId}):{" "}
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

        {data.yearHistory.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm uppercase tracking-widest text-stone-500">
              year endings
            </h2>
            <ul className="space-y-1 text-sm">
              {data.yearHistory.map((y) => (
                <li key={y.year} className="text-stone-300 leading-5">
                  Year {y.year}:{" "}
                  <span className="text-amber-300">{y.endingLabel}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
