"use client";

/**
 * /god/metrics — admin SLO board.
 * Phase 8 Day 63.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface Resp {
  admin: { username: string };
  asOfMs: number;
  dau: number;
  retention7d: { retained: number; cohort: number; pct: number };
  runCompletion: Record<string, number>;
  factionBalance: Array<{
    id: string;
    member_count: number;
    cumulative_contribution: number;
  }>;
  economy: { todayInflow: number; todayOutflow: number };
}

export default function GodMetricsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/god/metrics");
        if (r.status === 403) {
          setForbidden(true);
          return;
        }
        if (!r.ok) return;
        if (!cancelled) setData((await r.json()) as Resp);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (forbidden) {
    return <main className="p-8 text-stone-300">forbidden</main>;
  }
  if (!data) {
    return <main className="p-8 text-stone-500">loading…</main>;
  }

  const completionTotal = Object.values(data.runCompletion).reduce(
    (a, b) => a + b,
    0,
  );
  const won = data.runCompletion.won ?? 0;
  const winPct = completionTotal > 0 ? (won / completionTotal) * 100 : 0;

  return (
    <main className="p-8 max-w-4xl mx-auto text-stone-200 font-mono space-y-6">
      <header>
        <h1 className="text-2xl">metrics</h1>
        <p className="text-stone-500 text-xs mt-1">
          admin: {data.admin.username} · refreshed{" "}
          {new Date(data.asOfMs).toISOString().slice(11, 19)}
        </p>
        <Link href="/god" className="text-stone-600 text-xs underline">
          ← /god
        </Link>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <div className="border border-stone-800 p-4">
          <div className="text-xs text-stone-500">DAU</div>
          <div className="text-2xl text-stone-200 tabular-nums">
            {data.dau.toLocaleString()}
          </div>
        </div>
        <div className="border border-stone-800 p-4">
          <div className="text-xs text-stone-500">7d retention</div>
          <div className="text-2xl text-amber-300 tabular-nums">
            {data.retention7d.pct}%
          </div>
          <div className="text-[10px] text-stone-600">
            {data.retention7d.retained}/{data.retention7d.cohort}
          </div>
        </div>
        <div className="border border-stone-800 p-4">
          <div className="text-xs text-stone-500">7d win rate</div>
          <div className="text-2xl text-emerald-400 tabular-nums">
            {winPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-stone-600">
            {won}/{completionTotal} ended
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-stone-500 mb-2">
          factions
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {data.factionBalance.map((f) => (
              <tr key={f.id} className="border-b border-stone-900">
                <td className="py-1 font-mono text-stone-300">{f.id}</td>
                <td className="text-right text-stone-500 tabular-nums">
                  {f.member_count} pledges
                </td>
                <td className="text-right text-stone-500 tabular-nums">
                  {f.cumulative_contribution} influence
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-stone-500 mb-2">
          today's economy
        </h2>
        <div className="text-sm space-y-1">
          <div>
            inflow:{" "}
            <span className="text-emerald-400 tabular-nums">
              +{data.economy.todayInflow.toLocaleString()}
            </span>
          </div>
          <div>
            outflow:{" "}
            <span className="text-red-400 tabular-nums">
              {data.economy.todayOutflow.toLocaleString()}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
