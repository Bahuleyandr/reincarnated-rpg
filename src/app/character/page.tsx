"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface CharacterResp {
  totalCampaigns: number;
  campaignsByStatus: Record<string, number>;
  formDistribution: Array<{ formId: string; n: number }>;
  legacyTraits?: Array<{
    id: string;
    label: string;
    description: string;
    mechanicalEffect: string;
    count: number;
  }>;
  energy: {
    energy: number;
    max: number;
    tierId: string;
    effectiveTierId: string;
    tierLabel: string;
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
  } | null;
  contributions: {
    total: number;
    totalDelta: number;
    feeds: number;
    starves: number;
  };
  npcs: {
    total: number;
    timesHelped: number;
    timesHarmed: number;
    top: Array<{
      slug: string;
      name: string;
      relationshipScore: number;
      timesMet: number;
      timesHelped: number;
      timesHarmed: number;
    }>;
  };
  lore: {
    total: number;
    recent: Array<{
      id: string;
      summary: string;
      category: string | null;
      salience: number;
      createdAt: string;
    }>;
  };
  ai: {
    lifetimeCalls: number;
    lifetimeTurnCalls: number;
    lifetimeInputTokens: number;
    lifetimeOutputTokens: number;
    lifetimeCostUsd: number;
  };
}

export default function CharacterPage() {
  const router = useRouter();
  const [data, setData] = useState<CharacterResp | null>(null);
  const [loading, setLoading] = useState(true);
  // `now` is state-driven (not Date.now() in render) to satisfy
  // React 19's react-hooks/purity rule. Refreshes once a minute —
  // fine for the "days remaining" math the UI uses it for.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const me = await fetch("/api/auth/me");
      if (!me.ok) {
        router.push("/login");
        return;
      }
      const r = await fetch("/api/character");
      if (r.status === 401) {
        router.push("/login");
        return;
      }
      if (r.ok && !cancelled) setData(await r.json());
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading)
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  if (!data)
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        no data
      </main>
    );

  const fmtTok = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : `${n}`;
  const usd = (n: number) =>
    n < 0.01 ? "$<0.01" : `$${n.toFixed(2)}`;

  const helpedRatio =
    data.npcs.timesHelped + data.npcs.timesHarmed > 0
      ? (data.npcs.timesHelped /
          (data.npcs.timesHelped + data.npcs.timesHarmed)) *
        100
      : 0;

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">your character</h1>
          <Link
            href="/dashboard"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← runs
          </Link>
        </header>

        <p className="text-stone-400 text-xs leading-5">
          Across all your reincarnations. Each death, win, or cap
          changed something. Some changed nothing the world noticed —
          some changed enough to be written down.
        </p>

        <section className="grid grid-cols-4 gap-3">
          <Stat label="reincarnations" value={data.totalCampaigns} />
          <Stat
            label="won"
            value={data.campaignsByStatus.completed ?? 0}
            accent="text-emerald-400"
          />
          <Stat
            label="died"
            value={data.campaignsByStatus.abandoned ?? 0}
            accent="text-red-400"
          />
          <Stat
            label="active"
            value={data.campaignsByStatus.active ?? 0}
            accent="text-amber-300"
          />
        </section>

        {data.energy && (
          <section
            className={`border p-4 space-y-2 ${
              data.energy.blessing
                ? "border-amber-800/60 bg-amber-950/20"
                : "border-stone-800 bg-stone-900/40"
            }`}
          >
            <h2 className="text-stone-100 text-sm flex items-baseline justify-between">
              <span>
                tier
                {data.energy.blessing && (
                  <span className="text-amber-400 text-[11px] ml-2">
                    ✦ {data.energy.blessing.label}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-stone-500 font-normal">
                upgrade is admin-managed in v1
              </span>
            </h2>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <Stat
                label="tier"
                value={data.energy.tierLabel}
                accent={
                  data.energy.blessing
                    ? "text-amber-300"
                    : "text-amber-300"
                }
              />
              <Stat
                label="energy"
                value={`${data.energy.energy} / ${data.energy.max}`}
              />
              <Stat
                label="turns/day"
                value={`~${data.energy.turnsPerDay}`}
                accent="text-stone-400"
              />
              <Stat
                label="streak"
                value={
                  data.energy.streak.count > 0
                    ? `🔥 ${data.energy.streak.count} / ${data.energy.streak.max}`
                    : "—"
                }
                accent={
                  data.energy.streak.count > 0
                    ? "text-orange-300"
                    : "text-stone-500"
                }
              />
            </div>
            {data.energy.blessing ? (
              <div className="text-[11px] text-amber-200/80 leading-5 italic">
                {data.energy.blessing.description}
                {data.energy.blessing.expiresAtMs && (
                  <span className="block text-amber-400/70 not-italic mt-1">
                    The blessing fades on{" "}
                    {new Date(
                      data.energy.blessing.expiresAtMs,
                    ).toLocaleDateString()}{" "}
                    (
                    {Math.max(
                      0,
                      Math.ceil(
                        (data.energy.blessing.expiresAtMs - now) /
                          (24 * 60 * 60 * 1000),
                      ),
                    )}{" "}
                    days). After that, your free tier returns to its
                    normal pace.
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-stone-600 leading-4">
                Each turn costs 1 energy. Energy refills continuously up
                to your tier's max. Free tier resets at the rate that
                gives ~32 turns/day; supporter ~72; patron ~144.
              </p>
            )}
          </section>
        )}

        {data.legacyTraits && data.legacyTraits.length > 0 && (
          <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
            <h2 className="text-stone-100 text-sm">
              scars and gifts ({data.legacyTraits.length})
            </h2>
            <p className="text-[11px] text-stone-500 italic leading-5">
              what your last lives left you. each fresh reincarnation
              starts with these woven into the form&rsquo;s state.
            </p>
            <ul className="space-y-2 text-xs">
              {data.legacyTraits.map((t) => (
                <li
                  key={t.id}
                  className="border border-stone-900 bg-stone-950/40 p-2 leading-5"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-stone-200">{t.label}</span>
                    {t.count > 1 && (
                      <span className="text-stone-600 text-[10px]">
                        × {t.count}
                      </span>
                    )}
                  </div>
                  <div className="text-stone-400 italic text-[11px]">
                    {t.description}
                  </div>
                  <div className="text-amber-400/80 text-[10px] mt-1">
                    {t.mechanicalEffect}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-2">
          <h2 className="text-stone-100 text-sm">
            forms you've been ({data.formDistribution.length})
          </h2>
          {data.formDistribution.length === 0 ? (
            <p className="text-stone-500 text-xs italic">
              you have not yet been anything.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {data.formDistribution.map((f) => (
                <li key={f.formId} className="flex items-center gap-3">
                  <span className="text-stone-300 w-32">{f.formId}</span>
                  <div className="flex-1 h-2 bg-stone-900 border border-stone-800 relative">
                    <div
                      className="absolute inset-y-0 left-0 bg-stone-700"
                      style={{
                        width: `${(f.n / data.totalCampaigns) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-stone-500 w-10 text-right">
                    {f.n}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">
            you and the long wyrm
          </h2>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat
              label="contributions"
              value={data.contributions.total}
            />
            <Stat
              label="net delta"
              value={
                data.contributions.totalDelta >= 0
                  ? `+${data.contributions.totalDelta}`
                  : `${data.contributions.totalDelta}`
              }
              accent={
                data.contributions.totalDelta > 0
                  ? "text-red-400"
                  : data.contributions.totalDelta < 0
                    ? "text-emerald-400"
                    : "text-stone-300"
              }
            />
            <Stat
              label="feeds / starves"
              value={`${data.contributions.feeds} / ${data.contributions.starves}`}
            />
          </div>
          <p className="text-[10px] text-stone-600 italic">
            Negative net delta means you've starved the wyrm more than
            you've fed it. Both are real, depending on the world's
            current phase.
          </p>
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">
            the world remembers ({data.npcs.total} NPCs)
          </h2>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="helped" value={data.npcs.timesHelped} />
            <Stat label="harmed" value={data.npcs.timesHarmed} />
            <Stat
              label="kindness ratio"
              value={`${helpedRatio.toFixed(0)}%`}
              accent={
                helpedRatio >= 50 ? "text-emerald-400" : "text-red-400"
              }
            />
          </div>
          {data.npcs.top.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-stone-800">
              <div className="text-[10px] uppercase tracking-widest text-stone-600">
                most-met
              </div>
              <ul className="text-xs space-y-1">
                {data.npcs.top.map((n) => (
                  <li
                    key={n.slug}
                    className="flex items-baseline gap-3"
                  >
                    <span className="text-stone-300 flex-1 truncate">
                      {n.name}
                    </span>
                    <span className="text-[10px] text-stone-600">
                      met×{n.timesMet}
                    </span>
                    <span
                      className={
                        n.relationshipScore > 0
                          ? "text-emerald-400 text-xs"
                          : n.relationshipScore < 0
                            ? "text-red-400 text-xs"
                            : "text-stone-500 text-xs"
                      }
                    >
                      {n.relationshipScore >= 0 ? "+" : ""}
                      {n.relationshipScore}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm flex items-baseline justify-between">
            <span>your name in the chronicle</span>
            <span className="text-[10px] text-stone-600 font-normal">
              {data.lore.total} entr{data.lore.total === 1 ? "y" : "ies"}
            </span>
          </h2>
          {data.lore.recent.length === 0 ? (
            <p className="text-stone-500 text-xs italic">
              nothing you have done has been recorded in the world's
              chronicle yet. the lore judge has not yet chosen your
              run.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {data.lore.recent.map((l) => (
                <li
                  key={l.id}
                  className="border border-stone-800 px-3 py-2 bg-stone-950"
                >
                  <div className="flex items-baseline gap-3">
                    {l.category && (
                      <span className="text-[10px] uppercase tracking-widest text-amber-500">
                        {l.category}
                      </span>
                    )}
                    <span className="text-stone-300 flex-1">
                      {l.summary}
                    </span>
                    <span className="text-[10px] text-stone-600">
                      {(l.salience * 100).toFixed(0)}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone-600 mt-1">
                    {new Date(l.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-stone-800 p-4 bg-stone-900/40 space-y-3">
          <h2 className="text-stone-100 text-sm">lifetime cost</h2>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="turns played" value={data.ai.lifetimeTurnCalls} />
            <Stat
              label="tokens"
              value={`${fmtTok(data.ai.lifetimeInputTokens)} in / ${fmtTok(data.ai.lifetimeOutputTokens)} out`}
            />
            <Stat
              label="approx cost"
              value={usd(data.ai.lifetimeCostUsd)}
              accent="text-stone-400"
            />
          </div>
          <p className="text-[10px] text-stone-600 italic">
            Cost is accurate for Anthropic models. Other providers
            report tokens only — check your provider dashboard for
            exact dollars.
          </p>
        </section>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent = "text-stone-100",
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="border border-stone-800 p-3 bg-stone-950">
      <div className="text-[10px] uppercase tracking-widest text-stone-600">
        {label}
      </div>
      <div className={accent}>{value}</div>
    </div>
  );
}
