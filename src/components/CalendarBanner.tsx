"use client";

/**
 * CalendarBanner — Phase 7 Day 38.
 * Shows the current chapter title + theme on the homepage.
 */
import { useEffect, useState } from "react";

interface View {
  book: number;
  chapter: number;
  chapterInBook: number;
  year: number;
  title: string;
  theme: string;
  worldEvent: string;
  chapterStartedAtMs: number;
  nextAdvanceInMs: number;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function CalendarBanner() {
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/world/calendar");
        if (!r.ok) return;
        const d = (await r.json()) as View;
        if (!cancelled) setView(d);
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

  if (!view) return null;

  const bookRoman = ROMAN[view.book] ?? `${view.book}`;
  return (
    <section className="w-full max-w-2xl mx-auto border border-stone-800 bg-stone-900/40 px-4 py-3 space-y-1 text-stone-300">
      <div className="text-[10px] uppercase tracking-widest text-stone-500">
        Year {view.year} · Book {bookRoman} · Chapter {view.chapterInBook} of 4
      </div>
      <div className="text-sm">{view.title}</div>
      <div className="text-xs italic text-stone-500 leading-5">
        {view.theme}
      </div>
    </section>
  );
}
