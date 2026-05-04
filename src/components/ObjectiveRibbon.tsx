"use client";

import { useEffect, useState } from "react";

interface ObjectiveRow {
  id: string;
  label: string;
  description: string;
  period: "daily" | "weekly";
  target: number;
  reward: { kind: "energy"; amount: number };
  progress: number;
  completed: boolean;
  claimed: boolean;
}

interface Resp {
  daily: ObjectiveRow[];
  weekly: ObjectiveRow[];
}

/**
 * Compact ribbon shown above the play view. Surfaces the player's
 * top unfinished objective for the day (or the top claimable one if
 * any are completed-but-unclaimed). Auto-refreshes after every
 * /api/turn round-trip via the existing `energy:update` event piggy-
 * back — for now it polls every 60s, which is fine until the volume
 * of turn-ends justifies a custom event.
 */
export function ObjectiveRibbon() {
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/objectives");
        if (r.ok && !cancelled) setData(await r.json());
      } catch {
        /* anon users / 401 — silently hide */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) return null;
  const all = [...data.daily, ...data.weekly];
  if (all.length === 0) return null;

  // Pick: claimable > in-progress > unstarted. Within each, the
  // closest-to-target.
  const claimable = all.filter((o) => o.completed && !o.claimed);
  const inProgress = all.filter((o) => !o.completed && o.progress > 0);
  const focus =
    claimable[0] ??
    inProgress.sort((a, b) => b.progress / b.target - a.progress / a.target)[0] ??
    all[0];
  if (!focus) return null;

  const pct = Math.min(100, Math.round((focus.progress / focus.target) * 100));

  async function onClaim() {
    if (!focus || !focus.completed || focus.claimed) return;
    await fetch("/api/objectives/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectiveId: focus.id }),
    });
    // Refetch.
    const r = await fetch("/api/objectives");
    if (r.ok) setData(await r.json());
  }

  return (
    <div className="border-b border-stone-800 px-4 py-2 bg-stone-900/30 text-xs flex items-center gap-3">
      <span className="text-stone-600 uppercase text-[9px] tracking-widest">
        {focus.period}
      </span>
      <span className="text-stone-300">{focus.label}</span>
      <span className="text-stone-600 ml-auto text-[10px]">
        {focus.progress} / {focus.target}
      </span>
      <div className="w-24 h-1 bg-stone-900 border border-stone-800 relative">
        <div
          className={`absolute inset-y-0 left-0 ${
            focus.completed
              ? focus.claimed
                ? "bg-stone-600"
                : "bg-amber-500"
              : "bg-stone-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {focus.completed && !focus.claimed && (
        <button
          type="button"
          onClick={onClaim}
          className="ml-2 text-amber-300 hover:text-amber-200 text-[11px] underline underline-offset-2"
        >
          claim +{focus.reward.amount} ⚡
        </button>
      )}
    </div>
  );
}
