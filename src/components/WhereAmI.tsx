"use client";

/**
 * WhereAmI — small in-play panel showing the current location's
 * region + race + signature local goods. Hidden when the
 * session is in a race-agnostic location (the original 6).
 *
 * Polls /api/state for projection.location.id, then fetches
 * /api/world/locations/[id] for the regional flavor.
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

export function WhereAmI() {
  const [loc, setLoc] = useState<RegionInfo | null>(null);
  const [hidden, setHidden] = useState(false);

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

  if (hidden || !loc || !loc.region || !loc.region.raceId) return null;

  return (
    <section className="border border-amber-800/40 bg-amber-950/10 px-3 py-2 space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-widest text-amber-500">
          where you are
        </span>
        <Link
          href={`/world/${loc.locationId}`}
          className="text-xs text-stone-200 hover:text-amber-300 underline underline-offset-2"
        >
          {loc.displayName}
        </Link>
        <span className="text-[10px] text-stone-500 ml-auto">
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="hover:text-stone-300"
            aria-label="hide where-am-I"
          >
            hide
          </button>
        </span>
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
    </section>
  );
}
