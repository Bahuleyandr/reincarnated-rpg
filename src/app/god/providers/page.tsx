"use client";

/**
 * /god/providers — admin view of provider health + manual override.
 * Phase 7 Day 40-41.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Row {
  providerId: string;
  status: "healthy" | "degraded" | "down" | "manual_down";
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  consecutiveFailures: number;
}

interface Resp {
  admin: { username: string };
  providers: Row[];
}

const STATUS_OPTIONS: Row["status"][] = [
  "healthy",
  "degraded",
  "down",
  "manual_down",
];

function tone(status: Row["status"]): string {
  if (status === "healthy") return "text-emerald-400";
  if (status === "degraded") return "text-amber-400";
  return "text-red-400";
}

function formatAge(ms: number | null, now: number): string {
  if (ms === null) return "—";
  const delta = now - ms;
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function GodProvidersPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/god/providers");
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
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function override(providerId: string, status: Row["status"]) {
    if (busy) return;
    setBusy(providerId);
    try {
      await fetch("/api/god/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, status }),
      });
      await load();
    } finally {
      setBusy(null);
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
    <main className="p-8 max-w-3xl mx-auto text-stone-200 space-y-6">
      <header>
        <h1 className="text-2xl">providers</h1>
        <p className="text-stone-500 text-xs mt-1">
          admin: {data.admin.username}
        </p>
        <Link href="/god" className="text-stone-600 text-xs underline">
          ← back to /god
        </Link>
      </header>

      <table className="w-full text-sm">
        <thead className="text-xs text-stone-600 border-b border-stone-800">
          <tr>
            <th className="text-left py-1">provider</th>
            <th className="text-left py-1">status</th>
            <th className="text-right py-1">consec failures</th>
            <th className="text-right py-1">last success</th>
            <th className="text-right py-1">last failure</th>
            <th className="text-right py-1">override</th>
          </tr>
        </thead>
        <tbody>
          {data.providers.map((p) => (
            <tr key={p.providerId} className="border-b border-stone-900">
              <td className="py-2 font-mono">{p.providerId}</td>
              <td className={`${tone(p.status)} py-2`}>{p.status}</td>
              <td className="text-right text-stone-500 tabular-nums">
                {p.consecutiveFailures}
              </td>
              <td className="text-right text-stone-500">
                {formatAge(p.lastSuccessAtMs, now)}
              </td>
              <td className="text-right text-stone-500">
                {formatAge(p.lastFailureAtMs, now)}
              </td>
              <td className="text-right">
                <select
                  value={p.status}
                  disabled={busy === p.providerId}
                  onChange={(e) =>
                    override(p.providerId, e.target.value as Row["status"])
                  }
                  className="bg-stone-950 border border-stone-800 text-xs px-1 py-0.5"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
