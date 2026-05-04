"use client";

/**
 * /god/economy — admin economy dashboard.
 *
 * Surface today's coin flow, recent days' roll, top sources, and
 * total coins in circulation. Admin-only — fetch returns 403 to
 * non-admins.
 *
 * Phase 5 Day 26.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface SourceRow {
  source: string;
  amount: number;
  count: number;
}

interface DayRow {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
}

interface EconomyView {
  admin: { username: string };
  today: {
    date: string;
    inflow: number;
    outflow: number;
    net: number;
    topSources: SourceRow[];
  };
  recent: DayRow[];
  circulation: {
    userTotal: number;
    sessionTotal: number;
    grandTotal: number;
  };
}

export default function GodEconomyPage() {
  const [data, setData] = useState<EconomyView | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch("/api/god/economy");
        if (r.status === 403) {
          setForbidden(true);
          return;
        }
        if (!r.ok) return;
        setData((await r.json()) as EconomyView);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (forbidden) {
    return (
      <main className="p-8 text-stone-300">
        <h1 className="text-xl">forbidden</h1>
        <p className="text-stone-500 text-sm mt-2">
          you must be an admin to view this page.
        </p>
      </main>
    );
  }
  if (loading || !data) {
    return <main className="p-8 text-stone-500">loading…</main>;
  }

  return (
    <main className="p-8 max-w-4xl mx-auto text-stone-200 space-y-8">
      <header>
        <h1 className="text-2xl">economy</h1>
        <p className="text-stone-500 text-xs mt-1">
          admin: {data.admin.username} · {data.today.date}
        </p>
        <Link
          href="/god"
          className="text-stone-600 text-xs underline"
        >
          ← back to /god
        </Link>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <div className="border border-stone-800 p-4">
          <div className="text-xs text-stone-500">today inflow</div>
          <div className="text-2xl text-emerald-400 tabular-nums">
            +{data.today.inflow.toLocaleString()}
          </div>
        </div>
        <div className="border border-stone-800 p-4">
          <div className="text-xs text-stone-500">today outflow</div>
          <div className="text-2xl text-red-400 tabular-nums">
            {data.today.outflow.toLocaleString()}
          </div>
        </div>
        <div className="border border-stone-800 p-4">
          <div className="text-xs text-stone-500">today net</div>
          <div
            className={`text-2xl tabular-nums ${
              data.today.net >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {data.today.net >= 0 ? "+" : ""}
            {data.today.net.toLocaleString()}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-stone-500 mb-2">
          top sources today
        </h2>
        {data.today.topSources.length === 0 ? (
          <p className="text-stone-600 text-sm">no coin movement yet today.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-600 border-b border-stone-800">
              <tr>
                <th className="text-left py-1">source</th>
                <th className="text-right py-1">amount</th>
                <th className="text-right py-1">txns</th>
              </tr>
            </thead>
            <tbody>
              {data.today.topSources.map((s) => (
                <tr key={s.source} className="border-b border-stone-900">
                  <td className="py-1 font-mono text-stone-300">{s.source}</td>
                  <td
                    className={`text-right tabular-nums ${
                      s.amount >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {s.amount >= 0 ? "+" : ""}
                    {s.amount.toLocaleString()}
                  </td>
                  <td className="text-right text-stone-500 tabular-nums">
                    {s.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-stone-500 mb-2">
          last 7 days
        </h2>
        <table className="w-full text-sm">
          <thead className="text-xs text-stone-600 border-b border-stone-800">
            <tr>
              <th className="text-left py-1">date</th>
              <th className="text-right py-1">inflow</th>
              <th className="text-right py-1">outflow</th>
              <th className="text-right py-1">net</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.date} className="border-b border-stone-900">
                <td className="py-1 font-mono text-stone-300">{r.date}</td>
                <td className="text-right tabular-nums text-emerald-400">
                  +{r.inflow.toLocaleString()}
                </td>
                <td className="text-right tabular-nums text-red-400">
                  {r.outflow.toLocaleString()}
                </td>
                <td
                  className={`text-right tabular-nums ${
                    r.net >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {r.net >= 0 ? "+" : ""}
                  {r.net.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-stone-500 mb-2">
          coins in circulation
        </h2>
        <div className="space-y-1 text-sm font-mono">
          <div>
            users:{" "}
            <span className="text-amber-300 tabular-nums">
              {data.circulation.userTotal.toLocaleString()}
            </span>
          </div>
          <div>
            anon sessions:{" "}
            <span className="text-amber-300 tabular-nums">
              {data.circulation.sessionTotal.toLocaleString()}
            </span>
          </div>
          <div className="text-stone-300">
            total:{" "}
            <span className="text-amber-200 tabular-nums">
              {data.circulation.grandTotal.toLocaleString()}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
