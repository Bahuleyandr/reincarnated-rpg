"use client";

import { useEffect, useState } from "react";

interface TickerEntry {
  id: string;
  text: string;
  at: string;
  kind: "death" | "win" | "cap" | "roll-success" | "roll-miss" | "lore";
}

interface Resp {
  entries: TickerEntry[];
  horizonHours: number;
}

const COLORS: Record<TickerEntry["kind"], string> = {
  death: "text-red-400/80",
  win: "text-amber-300/80",
  cap: "text-blue-400/70",
  "roll-success": "text-emerald-400/80",
  "roll-miss": "text-rose-400/70",
  lore: "text-stone-400",
};

/**
 * Homepage marquee showing the last 24h of noteworthy world events.
 * Auto-rotates through entries every 5s; pauses on hover. Empty
 * state shows in-character "the world is quiet" copy so a fresh
 * deployment doesn't render an awkward blank.
 */
export function TodayTicker() {
  const [data, setData] = useState<Resp | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/world/today")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Resp | null) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data || data.entries.length <= 1 || paused) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % data.entries.length);
    }, 5000);
    return () => clearInterval(t);
  }, [data, paused]);

  if (!data) return null;
  if (data.entries.length === 0) {
    return (
      <div
        className="text-[11px] italic text-stone-600 text-center py-1.5 border-y border-stone-900"
        title={`no notable events in the last ${data.horizonHours}h`}
      >
        no fresh news in the last {data.horizonHours}h.
      </div>
    );
  }

  const current = data.entries[idx];
  return (
    <div
      className="text-[11px] py-1.5 border-y border-stone-900 text-center select-none cursor-default"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      title={`world pulse · ${data.entries.length} events in the last ${data.horizonHours}h`}
    >
      <span className="text-stone-700 mr-2">›</span>
      <span className={COLORS[current.kind]}>{current.text}</span>
    </div>
  );
}
