"use client";

import { useEffect, useState } from "react";

interface EnergyView {
  energy: number;
  max: number;
  tierId: string;
  tierLabel: string;
  regenIntervalMs: number;
  nextRegenMs: number;
  fullAtMs: number | null;
  turnsPerDay: number;
  blessing: {
    id: string;
    label: string;
    description: string;
    expiresAtMs: number | null;
  } | null;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatBlessingTime(expiresAtMs: number, now: number): string {
  const remaining = expiresAtMs - now;
  if (remaining <= 0) return "ending now";
  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor(
    (remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000),
  );
  if (days >= 1) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

export function EnergyBar() {
  const [view, setView] = useState<EnergyView | null>(null);
  // Tick every second to keep the countdown live without
  // re-fetching every second.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch on mount + every 30s. Refilled state computes server-side.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/energy");
        if (!r.ok) return;
        const d = (await r.json()) as EnergyView;
        if (!cancelled) setView(d);
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

  // Listen for /api/turn responses that include energy info
  // (out-of-energy 429s) so the bar updates immediately when the
  // turn endpoint refuses. Lightweight global event.
  useEffect(() => {
    function onUpdate(e: Event) {
      const d = (e as CustomEvent<EnergyView>).detail;
      if (d) setView(d);
    }
    window.addEventListener("energy:update", onUpdate);
    return () => window.removeEventListener("energy:update", onUpdate);
  }, []);

  if (!view) return null;

  // Locally-decremented countdown driven by `tick`; gives the
  // illusion of a live timer between server refreshes.
  const localNextRegen = Math.max(0, view.nextRegenMs - tick * 1000);
  const pct = (view.energy / view.max) * 100;
  const low = view.energy <= Math.max(2, Math.floor(view.max * 0.2));
  const empty = view.energy <= 0;
  const atMax = view.energy >= view.max;

  return (
    <section className="px-4 py-2 border-b border-stone-800 bg-stone-900/40 text-xs space-y-1">
      {view.blessing && (
        <div
          className="text-[10px] text-amber-300 leading-4 pb-1 border-b border-amber-900/40 mb-1"
          title={view.blessing.description}
        >
          ✦ {view.blessing.label}
          {view.blessing.expiresAtMs && (
            <span className="text-amber-500/70 ml-1">
              · {formatBlessingTime(view.blessing.expiresAtMs, Date.now())} left
            </span>
          )}
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-stone-100">⚡ {view.energy}</span>
        <span className="text-stone-600">/ {view.max}</span>
        <span
          className={`ml-auto text-[10px] uppercase tracking-widest ${
            view.blessing ? "text-amber-400" : "text-stone-600"
          }`}
          title={`${view.turnsPerDay} turns/day${view.blessing ? " (blessed)" : ""}`}
        >
          {view.tierLabel}
          {view.blessing && " +"}
        </span>
      </div>
      <div className="h-1 bg-stone-900 border border-stone-800 relative overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 transition-all ${
            empty
              ? "bg-red-700"
              : low
                ? "bg-amber-700"
                : atMax
                  ? "bg-emerald-600"
                  : "bg-stone-500"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-[10px] text-stone-600 leading-3">
        {atMax ? (
          "full"
        ) : empty ? (
          <span className="text-red-400">
            out of energy — refill in {formatMs(localNextRegen)}
          </span>
        ) : (
          <>
            +1 in {formatMs(localNextRegen)} · full in{" "}
            {formatMs(
              Math.max(
                0,
                (view.fullAtMs ?? Date.now()) - Date.now() - tick * 1000,
              ),
            )}
          </>
        )}
      </div>
    </section>
  );
}
