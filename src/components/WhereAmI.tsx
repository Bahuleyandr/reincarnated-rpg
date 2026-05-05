"use client";

/**
 * WhereAmI — small in-play panel showing the current location's
 * region + race + signature local goods. Hidden when the session
 * is in a race-agnostic location (the original 6) or the player
 * dismisses it.
 *
 * Phase 9 follow-up: also exposes a "travel" affordance — click
 * to open a destination picker; selecting routes the session to
 * a different city via /api/play/travel.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface RegionInfo {
  locationId: string;
  displayName: string;
  tagline: string;
  region: {
    raceId: string | null;
    raceVoice: string | null;
    subPopulations: string[];
  } | null;
  availableResources: Array<{ id: string; name: string }>;
}

const DESTINATIONS: Array<{ id: string; label: string; group: string }> = [
  { id: "caelum-by-the-wash", label: "Caelum (metropolis)", group: "cities" },
  { id: "threadwarden", label: "Threadwarden (humans)", group: "cities" },
  { id: "saltgale", label: "Saltgale (elves)", group: "cities" },
  { id: "highfield-ascending", label: "Highfield (dwarves)", group: "cities" },
  {
    id: "the-coral-anchorage",
    label: "Coral Anchorage (halflings)",
    group: "cities",
  },
  { id: "the-long-indices", label: "Long Indices (orcs)", group: "cities" },
  { id: "three-notches", label: "Three Notches", group: "towns" },
  { id: "coldspoon", label: "Coldspoon", group: "towns" },
  { id: "mudmoth", label: "Mudmoth", group: "towns" },
  { id: "tallowfen", label: "Tallowfen", group: "towns" },
  { id: "cataract-mile", label: "Cataract Mile", group: "towns" },
  { id: "quietmile", label: "Quietmile", group: "towns" },
  { id: "furrowmouth", label: "Furrowmouth", group: "towns" },
  { id: "knots-landing", label: "Knot's Landing", group: "towns" },
  { id: "briny-bell", label: "Briny Bell", group: "towns" },
  { id: "crab-by-crab", label: "Crab-by-Crab", group: "towns" },
];

export function WhereAmI() {
  const [loc, setLoc] = useState<RegionInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [travelOpen, setTravelOpen] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const [travelMsg, setTravelMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sr = await fetch("/api/state");
      if (!sr.ok) return;
      const sd = (await sr.json()) as {
        projection?: { location?: { id?: string } };
      };
      const id = sd.projection?.location?.id;
      if (!id) return;
      const lr = await fetch(`/api/world/locations/${id}`);
      if (!lr.ok) return;
      setLoc((await lr.json()) as RegionInfo);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function travel(toId: string) {
    if (traveling) return;
    setTraveling(true);
    setTravelMsg(null);
    try {
      const r = await fetch("/api/play/travel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toLocationId: toId }),
      });
      const d = (await r.json()) as
        | { ok: true; toLocation: string; toRoom: string }
        | { error: string };
      if ("ok" in d && d.ok) {
        setTravelMsg(`arrived at ${d.toLocation}`);
        setTravelOpen(false);
        await load();
      } else if ("error" in d) {
        setTravelMsg(`error: ${d.error}`);
      }
    } finally {
      setTraveling(false);
    }
  }

  if (hidden || !loc || !loc.region || !loc.region.raceId) return null;

  return (
    <section className="border border-amber-800/40 bg-amber-950/10 px-3 py-2 space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest text-amber-500">
          where you are
        </span>
        <Link
          href={`/world/${loc.locationId}`}
          className="text-xs text-stone-200 hover:text-amber-300 underline underline-offset-2"
        >
          {loc.displayName}
        </Link>
        <button
          type="button"
          onClick={() => setTravelOpen((v) => !v)}
          className="text-[10px] text-stone-500 hover:text-stone-300 underline underline-offset-2 ml-2"
        >
          travel
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="text-[10px] text-stone-500 hover:text-stone-300 ml-auto"
          aria-label="hide where-am-I"
        >
          hide
        </button>
      </div>
      <p className="text-[11px] text-stone-400 italic">{loc.tagline}</p>
      {loc.region.raceVoice && (
        <p className="text-[10px] text-stone-500">
          local voice: {loc.region.raceVoice}
        </p>
      )}
      {loc.availableResources.length > 0 && (
        <p className="text-[10px] text-stone-500">
          local goods:{" "}
          {loc.availableResources
            .slice(0, 4)
            .map((r) => r.name)
            .join(", ")}
        </p>
      )}
      {travelMsg && (
        <p className="text-[10px] text-amber-400 italic">{travelMsg}</p>
      )}
      {travelOpen && (
        <div className="pt-1 border-t border-amber-800/40">
          <p className="text-[10px] text-stone-500 mb-1">
            choose a destination — costs 3 turns of energy and resets your
            location
          </p>
          <div className="grid grid-cols-2 gap-1">
            {DESTINATIONS.filter((d) => d.id !== loc.locationId).map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={traveling}
                onClick={() => travel(d.id)}
                className="text-[10px] text-left px-2 py-0.5 border border-stone-700 rounded text-stone-300 hover:bg-stone-800 disabled:opacity-50 truncate"
                title={d.label}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
