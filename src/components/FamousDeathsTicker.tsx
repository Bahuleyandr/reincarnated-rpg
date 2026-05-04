"use client";

/**
 * FamousDeathsTicker — Phase 5.5 Day 28.
 *
 * Renders the most recent famous deaths from /api/lore/public
 * filtered to category=famous_death. Each entry surfaces 24h after
 * it happened (the public-lore delay rule). Empty state simply
 * doesn't render.
 */
import { useEffect, useState } from "react";

interface LoreEntry {
  id: string;
  summary: string;
  category: string | null;
  salience: number;
  tags: string[];
  createdAtMs: number;
  publicAtMs: number;
  sourceLocationId: string | null;
  sourceFormId: string | null;
  sourcePhase: string | null;
}

interface LoreFeedResp {
  entries: LoreEntry[];
}

function formatAge(now: number, createdAtMs: number): string {
  const ms = now - createdAtMs;
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function FamousDeathsTicker() {
  const [entries, setEntries] = useState<LoreEntry[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/lore/public?category=famous_death");
        if (!r.ok) return;
        const d = (await r.json()) as LoreFeedResp;
        if (!cancelled) setEntries(d.entries.slice(0, 5));
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className="w-full max-w-2xl mx-auto border border-stone-800 bg-stone-900/40 px-4 py-3 space-y-2">
      <header className="text-[10px] uppercase tracking-widest text-stone-500">
        the cycle remembers
      </header>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="text-xs leading-5 text-stone-300">
            <span className="text-stone-500 mr-2 tabular-nums">
              {formatAge(now, e.createdAtMs)}
            </span>
            <span>{e.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
