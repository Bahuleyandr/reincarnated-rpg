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

  // Weekly theme override
  const [worldTheme, setWorldTheme] = useState<{
    activeId: string;
    overrideActive: boolean;
    catalog: Array<{ id: string; label: string; description: string }>;
  } | null>(null);
  const [pinTheme, setPinTheme] = useState<string>("");

  // Lore admin
  interface AdminLoreRow {
    id: string;
    summary: string;
    prose: string | null;
    salience: number;
    category: string | null;
    tags: string[];
    sourceUserId: string | null;
    sourceFormId: string | null;
    sourceLocationId: string | null;
    sourcePhase: string | null;
    createdAt: string;
    updatedAt: string;
    lastEditedByUserId: string | null;
    expiresAt: string | null;
    isRedacted: boolean;
    isEdited: boolean;
  }
  const [loreList, setLoreList] = useState<AdminLoreRow[]>([]);
  const [loreShowRedacted, setLoreShowRedacted] = useState(false);
  const [editingLore, setEditingLore] = useState<AdminLoreRow | null>(null);
  const [newLoreSummary, setNewLoreSummary] = useState("");
  const [newLoreProse, setNewLoreProse] = useState("");
  const [newLoreCategory, setNewLoreCategory] = useState("city-event");
  const [newLoreTags, setNewLoreTags] = useState("");
  const [newLoreSalience, setNewLoreSalience] = useState(0.85);

  // Energy admin
  interface TierMeta {
    id: string;
    label: string;
    max: number;
    description: string;
    turnsPerDay: number;
  }
  const [tiers, setTiers] = useState<TierMeta[]>([]);
  const [energyUsername, setEnergyUsername] = useState("");
  const [energyLookup, setEnergyLookup] = useState<{
    user: { id: string; username: string };
    energy: {
      energy: number;
      max: number;
      tierId: string;
      tierLabel: string;
      turnsPerDay: number;
    } | null;
  } | null>(null);
  const [energyTier, setEnergyTier] = useState<string>("");

  async function load() {
    setLoading(true);
    const [r, w, l, e] = await Promise.all([
      fetch("/api/god"),
      fetch("/api/world"),
      fetch("/api/god/lore?limit=50"),
      fetch("/api/god/energy"),
    ]);
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
    if (w.ok) {
      const wd = (await w.json()) as {
        activeTheme: { id: string };
        overrideActive: boolean;
        catalog: Array<{ id: string; label: string; description: string }>;
      };
      setWorldTheme({
        activeId: wd.activeTheme.id,
        overrideActive: wd.overrideActive,
        catalog: wd.catalog,
      });
      setPinTheme(wd.overrideActive ? wd.activeTheme.id : "");
    }
    if (l.ok) {
      const ld = (await l.json()) as { lore: AdminLoreRow[] };
      setLoreList(ld.lore);
    }
    if (e.ok) {
      const ed = (await e.json()) as { tiers: TierMeta[] };
      setTiers(ed.tiers);
    }
    setLoading(false);
  }

  async function lookupEnergy() {
    if (!energyUsername.trim()) return;
    setError(null);
    try {
      const r = await fetch(
        `/api/god/energy?username=${encodeURIComponent(energyUsername.trim())}`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `lookup failed (${r.status})`);
        setEnergyLookup(null);
        return;
      }
      const d = await r.json();
      setEnergyLookup(d);
      setEnergyTier(d.energy?.tierId ?? "");
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
    }
  }

  async function applyEnergyChange(args: {
    tier?: string;
    refillToMax?: boolean;
    setEnergy?: number;
  }) {
    if (!energyLookup) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/god/energy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: energyLookup.user.username,
          ...args,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `update failed (${r.status})`);
        setBusy(false);
        return;
      }
      setSuccess(
        `${energyLookup.user.username} updated${args.tier ? ` (tier=${args.tier})` : ""}${args.refillToMax ? ` (refilled)` : ""}`,
      );
      await lookupEnergy();
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function writeLore() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/god/lore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: newLoreSummary,
          prose: newLoreProse || undefined,
          salience: newLoreSalience,
          category: newLoreCategory,
          tags: newLoreTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `lore write failed (${r.status})`);
        setBusy(false);
        return;
      }
      setSuccess("lore entry written.");
      setNewLoreSummary("");
      setNewLoreProse("");
      setNewLoreTags("");
      await load();
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function saveEdit(row: AdminLoreRow) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch(`/api/god/lore/${row.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: row.summary,
          prose: row.prose,
          salience: row.salience,
          category: row.category,
          tags: row.tags,
          expiresAt: row.expiresAt,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `edit failed (${r.status})`);
        setBusy(false);
        return;
      }
      setSuccess(`edited ${row.id.slice(0, 8)}…`);
      setEditingLore(null);
      await load();
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function redact(id: string) {
    if (
      !confirm(
        "Redact this lore entry? It will fall out of recall immediately. The row stays for audit; redactions are recoverable by setting expiresAt to null in /god lore-edit.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch(`/api/god/lore/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `redact failed (${r.status})`);
        setBusy(false);
        return;
      }
      setSuccess(`redacted ${id.slice(0, 8)}…`);
      await load();
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  async function pinThemeId(themeId: string | null) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/god/theme", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId, reason: "manual" }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `theme set failed (${r.status})`);
        setBusy(false);
        return;
      }
      setSuccess(themeId ? `theme pinned to ${themeId}` : "theme override cleared");
      await load();
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
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

        {worldTheme && (
          <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
            <h2 className="text-stone-100 text-sm">
              weekly theme{" "}
              <span className="text-[10px] text-stone-500 font-normal">
                active:{" "}
                <span className="text-emerald-400">{worldTheme.activeId}</span>
                {worldTheme.overrideActive ? " (admin-pinned)" : " (rotation)"}
              </span>
            </h2>
            <p className="text-[11px] text-stone-500 leading-5">
              The theme rotates by ISO week deterministically. Pinning
              overrides the rotation until you clear it. Affects arc
              picker weights, reincarnation option weights, meta-arc
              feed/starve multipliers, and the turn cap.
            </p>
            <div className="flex items-center gap-3">
              <select
                value={pinTheme}
                onChange={(e) => setPinTheme(e.target.value)}
                className="bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 text-xs flex-1"
              >
                <option value="">(rotation)</option>
                {worldTheme.catalog.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => pinThemeId(pinTheme || null)}
                disabled={busy}
                className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 text-xs"
              >
                {pinTheme ? "pin theme" : "clear override"}
              </button>
            </div>
          </section>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}
        {success && <p className="text-emerald-400 text-xs">{success}</p>}

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">energy + tiers</h2>
          <p className="text-[11px] text-stone-500 leading-5">
            Look up a user by username, change their tier, or refill
            their energy. Free tier ~32 turns/day, supporter ~72,
            patron ~144.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={energyUsername}
              onChange={(e) => setEnergyUsername(e.target.value)}
              placeholder="username"
              className="bg-stone-950 border border-stone-700 px-3 py-1.5 text-stone-100 text-xs flex-1"
            />
            <button
              type="button"
              onClick={lookupEnergy}
              disabled={busy}
              className="border border-stone-300 text-stone-100 py-1 px-4 hover:bg-stone-100 hover:text-stone-950 text-xs"
            >
              look up
            </button>
          </div>
          {energyLookup && (
            <div className="border border-stone-800 p-3 bg-stone-950 space-y-3">
              <div className="text-xs">
                <span className="text-stone-100">
                  {energyLookup.user.username}
                </span>
                {" — "}
                {energyLookup.energy ? (
                  <span className="text-stone-400">
                    tier{" "}
                    <span className="text-amber-400">
                      {energyLookup.energy.tierLabel}
                    </span>
                    , energy{" "}
                    <span className="text-stone-100">
                      {energyLookup.energy.energy} /{" "}
                      {energyLookup.energy.max}
                    </span>
                  </span>
                ) : (
                  <span className="text-stone-500 italic">no energy state</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={energyTier}
                  onChange={(e) => setEnergyTier(e.target.value)}
                  className="bg-stone-950 border border-stone-700 px-3 py-1.5 text-stone-100 text-xs"
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.max} max, ~{t.turnsPerDay}/day)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => applyEnergyChange({ tier: energyTier })}
                  disabled={busy}
                  className="border border-stone-300 text-stone-100 py-1 px-3 hover:bg-stone-100 hover:text-stone-950 text-xs"
                >
                  set tier
                </button>
                <button
                  type="button"
                  onClick={() => applyEnergyChange({ refillToMax: true })}
                  disabled={busy}
                  className="border border-emerald-700 text-emerald-300 py-1 px-3 hover:bg-emerald-950 text-xs"
                >
                  refill to max
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm flex items-baseline justify-between">
            <span>chronicle (the central lore)</span>
            <label className="text-[10px] text-stone-500 font-normal flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={loreShowRedacted}
                onChange={(e) => setLoreShowRedacted(e.target.checked)}
              />
              show redacted
            </label>
          </h2>
          <p className="text-[11px] text-stone-500 leading-5">
            Salience decays with a 30-day half-life so old entries
            don't crowd out recent ones. Redact to drop an entry from
            recall immediately (audit-preserving). Edit to fix the
            judge's regrettable wording.
          </p>

          <details className="border border-stone-800 bg-stone-950/50">
            <summary className="px-3 py-2 text-xs text-stone-400 cursor-pointer hover:text-stone-200">
              + write lore entry directly (bypass the judge)
            </summary>
            <div className="p-3 space-y-3 border-t border-stone-800">
              <textarea
                value={newLoreSummary}
                onChange={(e) => setNewLoreSummary(e.target.value)}
                rows={2}
                placeholder="canonical summary (1-2 sentences, past tense, third person)"
                maxLength={500}
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 text-xs"
              />
              <textarea
                value={newLoreProse}
                onChange={(e) => setNewLoreProse(e.target.value)}
                rows={3}
                placeholder="optional richer prose for the public feed"
                maxLength={1500}
                className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 text-xs"
              />
              <div className="grid grid-cols-3 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-stone-600">
                    category
                  </span>
                  <select
                    value={newLoreCategory}
                    onChange={(e) => setNewLoreCategory(e.target.value)}
                    className="w-full bg-stone-950 border border-stone-700 px-3 py-1.5 text-stone-100 text-xs"
                  >
                    {[
                      "city-event",
                      "artifact",
                      "npc-fate",
                      "cult",
                      "plague",
                      "wyrm-event",
                      "natural-disaster",
                      "discovery",
                      "other",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-stone-600">
                    salience (0-1)
                  </span>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={newLoreSalience}
                    onChange={(e) =>
                      setNewLoreSalience(Number(e.target.value))
                    }
                    className="w-full bg-stone-950 border border-stone-700 px-3 py-1.5 text-stone-100 text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-stone-600">
                    tags (comma-sep)
                  </span>
                  <input
                    type="text"
                    value={newLoreTags}
                    onChange={(e) => setNewLoreTags(e.target.value)}
                    placeholder="tower-fell, salt"
                    className="w-full bg-stone-950 border border-stone-700 px-3 py-1.5 text-stone-100 text-xs"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={writeLore}
                disabled={busy || !newLoreSummary.trim()}
                className="border border-amber-700 text-amber-300 py-1 px-4 hover:bg-amber-950 transition-colors disabled:opacity-50 text-xs"
              >
                write to the chronicle
              </button>
            </div>
          </details>

          <ul className="space-y-2 text-xs">
            {loreList
              .filter((l) => loreShowRedacted || !l.isRedacted)
              .slice(0, 30)
              .map((l) => {
                const isEditing = editingLore?.id === l.id;
                const display = isEditing ? editingLore : l;
                return (
                  <li
                    key={l.id}
                    className={`border px-3 py-2 ${
                      l.isRedacted
                        ? "border-stone-900 bg-stone-950/40 opacity-60"
                        : "border-stone-800 bg-stone-950"
                    }`}
                  >
                    <div className="flex items-baseline gap-2 mb-1">
                      {l.category && (
                        <span className="text-[10px] uppercase tracking-widest text-amber-500">
                          {l.category}
                        </span>
                      )}
                      <span className="text-[10px] text-stone-600">
                        {(l.salience * 100).toFixed(0)} ·{" "}
                        {new Date(l.createdAt).toLocaleDateString()}
                      </span>
                      {l.isEdited && (
                        <span
                          className="text-[10px] text-stone-500 italic"
                          title={`updated ${new Date(l.updatedAt).toLocaleString()}`}
                        >
                          edited
                        </span>
                      )}
                      {l.isRedacted && (
                        <span className="text-[10px] text-red-400">
                          redacted
                        </span>
                      )}
                      <span className="text-[10px] text-stone-700 ml-auto">
                        {l.id.slice(0, 8)}…
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={display.summary}
                          onChange={(e) =>
                            setEditingLore({
                              ...display,
                              summary: e.target.value,
                            })
                          }
                          rows={2}
                          className="w-full bg-stone-900 border border-stone-700 px-2 py-1 text-stone-100 text-[11px]"
                        />
                        <textarea
                          value={display.prose ?? ""}
                          onChange={(e) =>
                            setEditingLore({
                              ...display,
                              prose: e.target.value || null,
                            })
                          }
                          rows={3}
                          placeholder="(optional prose)"
                          className="w-full bg-stone-900 border border-stone-700 px-2 py-1 text-stone-100 text-[11px]"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            max={1}
                            value={display.salience}
                            onChange={(e) =>
                              setEditingLore({
                                ...display,
                                salience: Number(e.target.value),
                              })
                            }
                            className="bg-stone-900 border border-stone-700 px-2 py-1 text-stone-100 text-[11px] w-20"
                          />
                          <input
                            type="text"
                            value={display.tags.join(", ")}
                            onChange={(e) =>
                              setEditingLore({
                                ...display,
                                tags: e.target.value
                                  .split(",")
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="flex-1 bg-stone-900 border border-stone-700 px-2 py-1 text-stone-100 text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => saveEdit(display)}
                            disabled={busy}
                            className="border border-stone-300 text-stone-100 py-0.5 px-2 hover:bg-stone-100 hover:text-stone-950 text-[11px]"
                          >
                            save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingLore(null)}
                            className="border border-stone-700 text-stone-400 py-0.5 px-2 hover:border-stone-500 text-[11px]"
                          >
                            cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-stone-300">{l.summary}</div>
                        {l.prose && (
                          <div className="text-stone-500 text-[11px] mt-1 italic">
                            {l.prose}
                          </div>
                        )}
                        <div className="text-[10px] text-stone-700 mt-1 flex items-center gap-2">
                          <span>
                            {l.sourceFormId ?? "?"} ·{" "}
                            {l.sourceLocationId ?? "?"} ·{" "}
                            {l.sourcePhase ?? "?"}
                          </span>
                          {l.tags.length > 0 && (
                            <span>{l.tags.join(" · ")}</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditingLore(l)}
                            className="ml-auto text-stone-500 hover:text-stone-300 underline underline-offset-2"
                          >
                            edit
                          </button>
                          {!l.isRedacted && (
                            <button
                              type="button"
                              onClick={() => redact(l.id)}
                              className="text-red-500 hover:text-red-300 underline underline-offset-2"
                            >
                              redact
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>

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
