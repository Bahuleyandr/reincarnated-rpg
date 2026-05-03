"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface PickerOption {
  id: string;
  label: string;
  description: string;
  typedFormHint: string;
  tier: "common" | "uncommon" | "rare";
  weight: number;
  starterBonus: { field: string; value: number } | null;
  effectiveWeight: number;
  saturated: boolean;
}

interface OfferResp {
  options: PickerOption[];
  totalActive: number;
  byForm: Record<string, number>;
}

const TIER_BADGE: Record<PickerOption["tier"], string> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
};

export default function ReincarnatePage() {
  const router = useRouter();
  const [offer, setOffer] = useState<OfferResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  async function loadOffer() {
    setLoading(true);
    const r = await fetch("/api/reincarnate?n=6");
    if (r.ok) {
      const d = (await r.json()) as OfferResp;
      setOffer(d);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const me = await fetch("/api/auth/me");
      if (me.ok && !cancelled) {
        const { user } = (await me.json()) as { user: unknown };
        setHasAccount(!!user);
      }
      await loadOffer();
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(option: PickerOption) {
    setBusy(true);
    setError(null);
    setPicked(option.id);
    try {
      if (hasAccount) {
        // Create a campaign with the catalog optionId.
        const cRes = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ optionId: option.id }),
        });
        if (!cRes.ok) {
          setError(`create failed (${cRes.status})`);
          setBusy(false);
          setPicked(null);
          return;
        }
        const { campaign } = (await cRes.json()) as {
          campaign: { id: string };
        };
        const sRes = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaignId: campaign.id }),
        });
        if (!sRes.ok) {
          setError(`session failed (${sRes.status})`);
          setBusy(false);
          setPicked(null);
          return;
        }
        router.push("/play");
      } else {
        // Anon path — POST /api/session directly with reincarnatedAs.
        // (Anon doesn't use catalog optionId; the label becomes the
        // free-text declaration.)
        const sRes = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reincarnatedAs: option.label }),
        });
        if (!sRes.ok) {
          setError(`session failed (${sRes.status})`);
          setBusy(false);
          setPicked(null);
          return;
        }
        router.push("/play");
      }
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
      setPicked(null);
    }
  }

  if (loading || hasAccount === null) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        the God of the new world is composing the offer…
      </main>
    );
  }

  if (!offer) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        the God is silent.
      </main>
    );
  }

  // Find the highest-weight rare option in the offer (the nudge).
  const nudgeId = (() => {
    const rares = offer.options
      .filter((o) => o.tier === "rare" && o.starterBonus)
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight);
    return rares[0]?.id ?? null;
  })();

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl text-stone-100 tracking-tight">
            the God of the new world asks
          </h1>
          <p className="text-stone-400 text-sm leading-6 max-w-prose">
            What would you like to reincarnate as? Six possibilities are open
            to you today. The God is impartial, but the world is not — when
            many already walk one path, others open more easily.
          </p>
        </header>

        {error && (
          <p className="text-red-400 text-xs bg-red-950/40 border border-red-900 px-3 py-2">
            {error}
          </p>
        )}

        <ul className="space-y-3">
          {offer.options.map((o) => {
            const isNudge = o.id === nudgeId;
            const isPicked = picked === o.id;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(o)}
                  className={`w-full text-left border px-5 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                    ${
                      isNudge
                        ? "border-amber-700/60 bg-amber-950/30 hover:bg-amber-950/50"
                        : o.saturated
                          ? "border-stone-800 bg-stone-900/20 hover:bg-stone-900/40"
                          : "border-stone-800 bg-stone-900/40 hover:bg-stone-900"
                    }
                    ${isPicked ? "ring-1 ring-stone-400" : ""}
                  `}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="text-stone-100">{o.label}</span>
                    <span
                      className={`text-[10px] uppercase tracking-widest ${
                        o.tier === "rare"
                          ? "text-amber-400"
                          : o.tier === "uncommon"
                            ? "text-stone-400"
                            : "text-stone-600"
                      }`}
                    >
                      {TIER_BADGE[o.tier]}
                    </span>
                    {o.saturated && (
                      <span className="text-[10px] text-stone-500 italic">
                        many already walk this path
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-xs leading-5 mt-1 ${
                      isNudge ? "text-amber-200/80" : "text-stone-400"
                    }`}
                  >
                    {o.description}
                  </p>
                  {o.starterBonus && (
                    <p
                      className={`text-[11px] mt-2 ${
                        isNudge ? "text-amber-300" : "text-stone-500"
                      }`}
                    >
                      {isNudge ? "✦ " : "+ "}
                      starter: {o.starterBonus.field}{" "}
                      {o.starterBonus.value > 0
                        ? `+${o.starterBonus.value}`
                        : `${o.starterBonus.value}`}
                      {isNudge && (
                        <span className="ml-2 italic text-amber-400/70">
                          the God is nudging you here
                        </span>
                      )}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between text-xs text-stone-500 pt-2">
          <button
            type="button"
            onClick={loadOffer}
            disabled={busy}
            className="underline underline-offset-2 hover:text-stone-300 disabled:opacity-50"
          >
            ask the God again →
          </button>
          {hasAccount ? (
            <Link
              href="/dashboard"
              className="underline underline-offset-2 hover:text-stone-300"
            >
              ← back to my runs
            </Link>
          ) : (
            <Link
              href="/"
              className="underline underline-offset-2 hover:text-stone-300"
            >
              ← back to the door
            </Link>
          )}
        </div>

        <div className="text-[10px] text-stone-600 leading-5 border-t border-stone-800 pt-4">
          {offer.totalActive > 0 ? (
            <>
              {offer.totalActive} reincarnation
              {offer.totalActive === 1 ? " is" : "s are"} active in the world
              right now. The God's offer is shaped by their distribution; rare
              paths surface when one form gets crowded.
            </>
          ) : (
            <>The world is empty. All paths are open today.</>
          )}
        </div>
      </div>
    </main>
  );
}
