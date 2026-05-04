"use client";

/**
 * CoinBadge — small global indicator next to EnergyBar showing the
 * player's current coin balance. Logged-in users see /api/character's
 * `coins` field; anon sessions see /api/coins (session-scoped).
 *
 * Phase 5 Day 18-19.
 */
import { useEffect, useState } from "react";

interface CoinView {
  coins: number;
  /** "user" = logged-in (cross-session); "session" = anon purse. */
  scope: "user" | "session";
}

export function CoinBadge() {
  const [view, setView] = useState<CoinView | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/coins");
        if (!r.ok) return;
        const d = (await r.json()) as CoinView;
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

  // Listen for /api/turn responses to refresh immediately on trade.
  useEffect(() => {
    function onUpdate(e: Event) {
      const d = (e as CustomEvent<CoinView>).detail;
      if (d) setView(d);
    }
    window.addEventListener("coins:update", onUpdate);
    return () => window.removeEventListener("coins:update", onUpdate);
  }, []);

  if (!view) return null;

  return (
    <span
      className="text-xs text-amber-300/90 inline-flex items-baseline gap-1"
      title={
        view.scope === "user"
          ? "Coins (cross-run, persists across reincarnations)"
          : "Coins (this session — log in to keep them across runs)"
      }
    >
      <span aria-hidden="true">⊙</span>
      <span className="tabular-nums">{view.coins}</span>
    </span>
  );
}
