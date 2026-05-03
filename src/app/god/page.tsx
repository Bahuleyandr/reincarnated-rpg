"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Phase {
  phase: string;
  label: string;
  min: number;
  max: number;
  ambientFlavor: string;
}

interface GodResp {
  admin: { username: string };
  arc: {
    id: string;
    progress: number;
    phase: string;
    phaseLabel: string;
    totalFeeds: number;
    totalStarves: number;
    contributorCount: number;
    meta: { cycle?: number } | null;
  };
  phases: Phase[];
  distribution: Record<string, number>;
  livePlayers: number;
  recentContributions: Array<{
    id: string;
    delta: number;
    reason: string;
    prose: string | null;
    formId: string | null;
    createdAt: string;
  }>;
}

export default function GodPage() {
  const router = useRouter();
  const [data, setData] = useState<GodResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // Nudge form state
  const [delta, setDelta] = useState<number>(0);
  const [setPhase, setSetPhase] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // World-event form state
  const [eventSummary, setEventSummary] = useState("");
  const [eventSalience, setEventSalience] = useState(0.95);
  const [eventTags, setEventTags] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/god");
    if (r.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (!r.ok) {
      setLoading(false);
      return;
    }
    setData(await r.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading)
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  if (forbidden) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-200 font-mono flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">forbidden — admin only.</p>
        <p className="text-stone-500 text-xs">
          Promote yourself by SQL:{" "}
          <code className="text-stone-300">
            UPDATE users SET is_admin = 'true' WHERE email = '...';
          </code>
        </p>
        <Link
          href="/"
          className="text-stone-500 hover:text-stone-300 underline underline-offset-2 text-xs"
        >
          ← home
        </Link>
      </main>
    );
  }
  if (!data)
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        no data
      </main>
    );

  async function nudge() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = {
        reason: reason.trim() || "manual",
      };
      if (setPhase) body.setPhase = setPhase;
      else body.delta = delta;
      const r = await fetch("/api/god/nudge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `nudge failed (${r.status})`);
        setBusy(false);
        return;
      }
      setSuccess("nudge applied.");
      await load();
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function injectEvent() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/god/world-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: eventSummary,
          salience: eventSalience,
          tags: eventTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `injection failed (${r.status})`);
        setBusy(false);
        return;
      }
      const d = (await r.json()) as { usersTouched: number };
      setSuccess(`world event injected — touched ${d.usersTouched} users.`);
      setEventSummary("");
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  const distEntries = Object.entries(data.distribution).sort(
    (a, b) => b[1] - a[1],
  );
  const totalDist = distEntries.reduce((s, [, n]) => s + n, 0);

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">
            god-mod console{" "}
            <span className="text-xs text-stone-500">
              ({data.admin.username})
            </span>
          </h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <section className="border border-stone-800 p-4 bg-stone-900/40 grid grid-cols-4 gap-3 text-xs">
          <Stat label="phase" value={data.arc.phaseLabel} accent="text-amber-300" />
          <Stat
            label="progress"
            value={`${data.arc.progress} / 1000`}
          />
          <Stat
            label="live players"
            value={data.livePlayers}
            accent="text-emerald-300"
          />
          <Stat label="cycle" value={data.arc.meta?.cycle ?? 1} />
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">nudge the wyrm</h2>
          <p className="text-[11px] text-stone-500 leading-5">
            Push progress up or down, or snap directly to a phase. Records
            an admin contribution row tagged{" "}
            <code className="text-stone-300">admin:&lt;reason&gt;</code> and
            updates the arc atomically.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-stone-600">
                delta
              </span>
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                disabled={!!setPhase}
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 disabled:opacity-50"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-stone-600">
                or set phase
              </span>
              <select
                value={setPhase}
                onChange={(e) => setSetPhase(e.target.value)}
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100"
              >
                <option value="">(use delta)</option>
                {data.phases.map((p) => (
                  <option key={p.phase} value={p.phase}>
                    {p.label} ({p.min}+)
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-stone-600">
                reason
              </span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. event-dampener"
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={nudge}
            disabled={busy}
            className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 text-sm"
          >
            apply nudge
          </button>
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">inject world event</h2>
          <p className="text-[11px] text-stone-500 leading-5">
            Writes a high-salience world memory under every active user.
            Their next campaign's first turn picks it up as ambient
            context. Use sparingly.
          </p>
          <textarea
            value={eventSummary}
            onChange={(e) => setEventSummary(e.target.value)}
            rows={3}
            placeholder='e.g. "Word reaches every road: a tower in the east has fallen overnight, and the wells around it taste of salt."'
            className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-stone-600">
                salience (0-1)
              </span>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={eventSalience}
                onChange={(e) => setEventSalience(Number(e.target.value))}
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-stone-600">
                tags (comma-sep)
              </span>
              <input
                type="text"
                value={eventTags}
                onChange={(e) => setEventTags(e.target.value)}
                placeholder="tower-fell, salt-water"
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={injectEvent}
            disabled={busy || !eventSummary.trim()}
            className="border border-amber-700 text-amber-300 py-1 px-4 hover:bg-amber-950 transition-colors disabled:opacity-50 text-sm"
          >
            inject across the world
          </button>
        </section>

        {error && <p className="text-red-400 text-xs">{error}</p>}
        {success && <p className="text-emerald-400 text-xs">{success}</p>}

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">
            current distribution ({totalDist} active campaigns last 7d)
          </h2>
          {distEntries.length === 0 ? (
            <p className="text-stone-500 text-xs italic">
              no active campaigns.
            </p>
          ) : (
            <ul className="text-xs space-y-1">
              {distEntries.map(([formId, n]) => {
                const pct = totalDist > 0 ? (n / totalDist) * 100 : 0;
                const saturated = pct >= 30;
                return (
                  <li
                    key={formId}
                    className="flex items-center gap-3"
                  >
                    <span className="text-stone-300 w-32">{formId}</span>
                    <div className="flex-1 h-2 bg-stone-900 border border-stone-800 relative">
                      <div
                        className={`absolute inset-y-0 left-0 ${
                          saturated ? "bg-amber-700" : "bg-stone-700"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-stone-500 w-20 text-right">
                      {n} ({pct.toFixed(0)}%)
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] text-stone-600 italic">
            Forms over 30% (amber) are saturated — the picker is
            de-weighting them automatically.
          </p>
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">recent contributions</h2>
          {data.recentContributions.length === 0 ? (
            <p className="text-stone-500 text-xs italic">none yet.</p>
          ) : (
            <ul className="space-y-1 text-[11px]">
              {data.recentContributions.slice(0, 12).map((c) => (
                <li
                  key={c.id}
                  className="flex items-baseline gap-3 border-b border-stone-900 pb-1"
                >
                  <span
                    className={`whitespace-nowrap ${
                      c.delta > 0
                        ? "text-red-400"
                        : c.delta < 0
                          ? "text-emerald-400"
                          : "text-stone-500"
                    }`}
                  >
                    {c.delta > 0 ? `+${c.delta}` : c.delta}
                  </span>
                  <span className="text-stone-300 flex-1 truncate">
                    {c.prose ?? c.reason}
                  </span>
                  <span className="text-stone-600 whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
  value: number | string;
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
