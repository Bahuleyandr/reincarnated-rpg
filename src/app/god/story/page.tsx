"use client";

/**
 * /god/story — admin story dashboard.
 * Phase 7 Day 57.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Resp {
  admin: { username: string };
  calendar: {
    book: number;
    chapter: number;
    chapterInBook: number;
    year: number;
    title: string;
    chapterStartedAtMs: number;
    nextAdvanceInMs: number;
  };
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
  factions: Array<{
    id: string;
    label: string;
    memberCount: number;
    cumulativeContribution: number;
    active: boolean;
  }>;
  endings: Array<{
    year: number;
    endingId: string;
    endingLabel: string;
  }>;
  edicts: Array<{
    id: string;
    text: string;
    status: string;
    chapterId: number;
  }>;
  recentEvents: Array<{
    id: string;
    kind: string;
    payload: unknown;
    createdAtMs: number;
  }>;
}

export default function GodStoryPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/god/story");
      if (r.status === 403) {
        setForbidden(true);
        return;
      }
      if (!r.ok) return;
      setData((await r.json()) as Resp);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Defer setState calls inside load() to a microtask so React
    // 19's react-hooks/set-state-in-effect rule is satisfied.
    void Promise.resolve().then(() => load());
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function forceAdvance() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/god/story", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <main className="p-8 text-stone-300">
        <h1 className="text-xl">forbidden</h1>
      </main>
    );
  }
  if (!data) {
    return <main className="p-8 text-stone-500">loading…</main>;
  }

  return (
    <main className="p-8 max-w-4xl mx-auto text-stone-200 font-mono space-y-6">
      <header>
        <h1 className="text-2xl">story dashboard</h1>
        <p className="text-stone-500 text-xs mt-1">
          admin: {data.admin.username}
        </p>
        <Link href="/god" className="text-stone-600 text-xs underline">
          ← /god
        </Link>
      </header>

      <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm uppercase tracking-widest text-stone-500">
            calendar
          </h2>
          <button
            type="button"
            onClick={forceAdvance}
            disabled={busy}
            className="text-xs text-amber-300 hover:text-amber-200 underline underline-offset-4 disabled:opacity-50"
          >
            {busy ? "…" : "force advance"}
          </button>
        </div>
        <div className="text-sm">{data.calendar.title}</div>
        <div className="text-xs text-stone-500">
          Year {data.calendar.year} · Book {data.calendar.book} · Chapter{" "}
          {data.calendar.chapterInBook}
        </div>
        <div className="text-[10px] text-stone-600">
          next advance in {Math.max(0, Math.round(data.calendar.nextAdvanceInMs / 1000))}s
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-widest text-stone-500">
          factions
        </h2>
        <table className="w-full text-xs">
          <tbody>
            {data.factions.map((f) => (
              <tr key={f.id} className="border-b border-stone-900">
                <td className="py-1">{f.label}</td>
                <td className="text-right text-stone-500 tabular-nums">
                  {f.memberCount} pledges
                </td>
                <td className="text-right text-stone-500 tabular-nums">
                  {f.cumulativeContribution} influence
                </td>
                <td className="text-right text-stone-700">
                  {f.active ? "" : "locked"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-widest text-stone-500">
          recent world events
        </h2>
        <ul className="text-xs space-y-1">
          {data.recentEvents.length === 0 ? (
            <li className="text-stone-600">no events yet</li>
          ) : (
            data.recentEvents.map((e) => (
              <li key={e.id} className="text-stone-400 font-mono">
                <span className="text-stone-600 tabular-nums">
                  {new Date(e.createdAtMs).toISOString().slice(11, 19)}
                </span>{" "}
                <span className="text-stone-300">{e.kind}</span>{" "}
                <span className="text-stone-700 truncate">
                  {JSON.stringify(e.payload).slice(0, 80)}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      {data.endings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm uppercase tracking-widest text-stone-500">
            year endings
          </h2>
          <ul className="text-sm space-y-1">
            {data.endings.map((y) => (
              <li key={y.year} className="text-stone-300">
                Year {y.year}:{" "}
                <span className="text-amber-300">{y.endingLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
