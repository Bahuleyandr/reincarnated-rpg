"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Row {
  presetId: string | null;
  model: string;
  calls: number;
  avgLatencyMs: number;
  successRate: number;
  avgCostUsd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}
interface Resp {
  days: number;
  callType: string;
  totalCalls: number;
  distinctModels: number;
  leaderboard: Row[];
}

export default function LeaderboardPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [days, setDays] = useState(30);
  const [callType, setCallType] = useState("narrator");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const r = await fetch(
        `/api/leaderboard?days=${days}&callType=${callType}`,
      );
      if (r.ok && !cancelled) {
        setData(await r.json());
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [days, callType]);

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">model leaderboard</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <section className="border border-stone-800 p-4 bg-stone-900/40 text-xs text-stone-400 leading-5 space-y-2">
          <p>
            How each (preset, model) combination is performing on real
            turns from real players. Aggregated from the{" "}
            <code className="text-stone-300">ai_calls</code> telemetry
            table — no PII, just per-model success/latency/cost.
          </p>
          <p className="text-stone-500">
            Ranking: success rate first, then speed. Models with fewer
            than 3 calls in the window are hidden as noise. Cost is
            accurate for Anthropic models; other providers have
            provider-dependent pricing — check your dashboard.
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <label className="text-stone-400">window:</label>
          <div className="flex gap-2 flex-wrap">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 border ${
                  days === d
                    ? "border-stone-300 text-stone-100"
                    : "border-stone-800 text-stone-500 hover:border-stone-600"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <span className="text-stone-400 sm:ml-4">call type:</span>
          <div className="flex gap-2 flex-wrap">
            {["narrator", "classifier", "tone_judge"].map((ct) => (
              <button
                key={ct}
                onClick={() => setCallType(ct)}
                className={`px-3 py-1 border ${
                  callType === ct
                    ? "border-stone-300 text-stone-100"
                    : "border-stone-800 text-stone-500 hover:border-stone-600"
                }`}
              >
                {ct}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-stone-500 text-sm">loading…</p>
        ) : !data || data.leaderboard.length === 0 ? (
          <p className="text-stone-500 text-sm italic">
            no calls yet in this window. play some turns and come back.
          </p>
        ) : (
          <>
            <p className="text-xs text-stone-500">
              {data.totalCalls} {data.callType} calls across{" "}
              {data.distinctModels} model{data.distinctModels === 1 ? "" : "s"}{" "}
              in the last {data.days}d.
            </p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-stone-800 text-stone-500 text-left">
                  <th className="py-2 pr-3">rank</th>
                  <th className="py-2 pr-3">preset</th>
                  <th className="py-2 pr-3">model</th>
                  <th className="py-2 pr-3 text-right">calls</th>
                  <th className="py-2 pr-3 text-right">success</th>
                  <th className="py-2 pr-3 text-right">avg latency</th>
                  <th className="py-2 pr-3 text-right">avg cost</th>
                  <th className="py-2 pr-3 text-right">avg in/out tok</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((r, i) => (
                  <tr
                    key={`${r.presetId}-${r.model}`}
                    className="border-b border-stone-900 hover:bg-stone-900/40"
                  >
                    <td className="py-2 pr-3 text-stone-500">{i + 1}</td>
                    <td className="py-2 pr-3 text-stone-300">
                      {r.presetId ?? "env-default"}
                    </td>
                    <td className="py-2 pr-3 text-stone-100">{r.model}</td>
                    <td className="py-2 pr-3 text-right text-stone-300">
                      {r.calls}
                    </td>
                    <td className="py-2 pr-3 text-right text-stone-300">
                      {(r.successRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 pr-3 text-right text-stone-300">
                      {r.avgLatencyMs.toLocaleString()}ms
                    </td>
                    <td className="py-2 pr-3 text-right text-stone-500">
                      {r.avgCostUsd > 0
                        ? `$${r.avgCostUsd.toFixed(4)}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-stone-500">
                      {r.avgInputTokens}/{r.avgOutputTokens}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </main>
  );
}
