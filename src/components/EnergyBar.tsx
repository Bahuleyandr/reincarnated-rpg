"use client";

import { useEffect, useRef, useState } from "react";

import { ManualHelpButton } from "./InstructionManual";

interface DailyGrant {
  streakBefore: number;
  streakAfter: number;
  bonusEnergy: number;
  reachedCap: boolean;
}

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
  streak: {
    count: number;
    max: number;
  };
  dailyGrant: DailyGrant | null;
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
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days >= 1) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

export function EnergyBar() {
  const [view, setView] = useState<EnergyView | null>(null);
  // Tick every second to keep the countdown live without
  // re-fetching every second. `now` is also stored as state so we
  // can pass it into render-side time math without calling
  // Date.now() during render (react-hooks/purity violation under
  // React 19's strict purity rules).
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Daily-grant flash. When a `dailyGrant` arrives we latch the value
  // for ~6s, then drop it. Multiple grants in quick succession (e.g.
  // page mount + first turn at 00:00 UTC) collapse into one flash —
  // the second grant fires `null` so we don't overwrite an active
  // celebration with nothing.
  const [grantFlash, setGrantFlash] = useState<DailyGrant | null>(null);
  const flashedKeyRef = useRef<string | null>(null);

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

  // When a fresh dailyGrant lands, latch it for 6s. Use the
  // streakAfter value as a dedup key so re-fetches that re-deliver
  // the same grant don't keep re-flashing it.
  useEffect(() => {
    if (!view?.dailyGrant) return;
    const key = `${view.dailyGrant.streakAfter}:${view.dailyGrant.bonusEnergy}`;
    if (flashedKeyRef.current === key) return;
    flashedKeyRef.current = key;
    setGrantFlash(view.dailyGrant);
    const id = setTimeout(() => setGrantFlash(null), 6000);
    return () => clearTimeout(id);
  }, [view?.dailyGrant]);

  if (!view) return null;

  // Locally-decremented countdown driven by `tick`; gives the
  // illusion of a live timer between server refreshes.
  const localNextRegen = Math.max(0, view.nextRegenMs - tick * 1000);
  const pct = (view.energy / view.max) * 100;
  const low = view.energy <= Math.max(2, Math.floor(view.max * 0.2));
  const empty = view.energy <= 0;
  const atMax = view.energy >= view.max;

  const streakCount = view.streak?.count ?? 0;
  const streakMax = view.streak?.max ?? 5;

  return (
    <section className="space-y-1 border-b border-stone-800 bg-stone-900/40 px-4 py-2 text-xs">
      {grantFlash && (
        <div
          className="mb-1 animate-pulse border-b border-orange-900/40 pb-1 text-[10px] leading-4 text-orange-300"
          title="Daily streak bonus"
        >
          🔥 Day {grantFlash.streakAfter} streak — +{grantFlash.bonusEnergy} energy
          {grantFlash.reachedCap && (
            <span className="ml-1 text-orange-200/80">· max streak reached!</span>
          )}
        </div>
      )}
      {view.blessing && (
        <div
          className="mb-1 border-b border-amber-900/40 pb-1 text-[10px] leading-4 text-amber-300"
          title={view.blessing.description}
        >
          ✦ {view.blessing.label}
          {view.blessing.expiresAtMs && (
            <span className="ml-1 text-amber-500/70">
              · {formatBlessingTime(view.blessing.expiresAtMs, now)} left
            </span>
          )}
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-stone-100">⚡ {view.energy}</span>
        <span className="text-stone-600">/ {view.max}</span>
        {streakCount > 0 && (
          <span
            className="ml-1 text-[10px] text-orange-400/80"
            title={`${streakCount}-day login streak (max ${streakMax}). +${streakCount} energy each new UTC day.`}
          >
            🔥 {streakCount}
            <span className="text-orange-700/60">/{streakMax}</span>
          </span>
        )}
        <span
          className={`ml-auto text-[10px] tracking-widest uppercase ${
            view.blessing ? "text-amber-400" : "text-stone-600"
          }`}
          title={`${view.turnsPerDay} turns/day${view.blessing ? " (blessed)" : ""}`}
        >
          {view.tierLabel}
          {view.blessing && " +"}
        </span>
        <ManualHelpButton topicId="energy" compact />
      </div>
      <div className="relative h-1 overflow-hidden border border-stone-800 bg-stone-900">
        <div
          className={`absolute inset-y-0 left-0 transition-all ${
            empty ? "bg-red-700" : low ? "bg-amber-700" : atMax ? "bg-emerald-600" : "bg-stone-500"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-[10px] leading-3 text-stone-600">
        {atMax ? (
          "full"
        ) : empty ? (
          <span className="text-red-400">out of energy — refill in {formatMs(localNextRegen)}</span>
        ) : (
          <>
            +1 in {formatMs(localNextRegen)} · full in{" "}
            {formatMs(Math.max(0, (view.fullAtMs ?? now) - now - tick * 1000))}
          </>
        )}
      </div>
    </section>
  );
}
