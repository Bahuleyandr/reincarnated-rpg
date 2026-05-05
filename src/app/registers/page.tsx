"use client";

/**
 * /registers — the world's records.
 *
 * Five "registers" surfaced in NPC voice: who has fed the Wyrm
 * most, who has starved it, who has been chronicled, who has
 * refused, and which players the recurring NPCs remember best.
 *
 * Reads /api/registers (cached 30s server-side). No auth required.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface RegisterEntry {
  rank: number;
  username: string;
  value: number;
  formattedValue: string;
  context?: string;
}

interface NpcRecurringRegister {
  npcSlug: string;
  npcName: string;
  topPlayers: RegisterEntry[];
}

interface RegistersResp {
  wyrmFed: RegisterEntry[];
  wyrmStarved: RegisterEntry[];
  chronicle: RegisterEntry[];
  refused: RegisterEntry[];
  recurring: NpcRecurringRegister[];
}

export default function RegistersPage() {
  const [data, setData] = useState<RegistersResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/registers");
      if (!r.ok) {
        setError(`load failed (${r.status})`);
        return;
      }
      setData((await r.json()) as RegistersResp);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">the registers</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          the world keeps its own books. the bell-keepers count tides;
          the wyrm-watchers count contributions; the lore-judge writes
          names down. these are the records visible from outside —
          who has fed the long wyrm, who has refused, who the recurring
          characters remember best. nothing on these pages is owed.
          they are simply what the world has noticed.
        </p>

        {error && (
          <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/30 px-3 py-2 rounded">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="text-xs text-stone-600 italic">
            the bell-keepers are tallying…
          </div>
        )}

        {data && (
          <>
            <RegisterCard
              title="the wyrm-fed"
              flavor="players whose runs have most fed the Long Wyrm. their names are written in the loyalists' ledger."
              entries={data.wyrmFed}
              valueAccent="text-red-400"
            />

            <RegisterCard
              title="the wyrm-starved"
              flavor="players whose runs have most starved the Long Wyrm. their names are remembered favorably by those who would rather it never wake."
              entries={data.wyrmStarved}
              valueAccent="text-emerald-400"
            />

            <RegisterCard
              title="the chronicle"
              flavor="players whose runs the lore-judge has written down most. the chronicle is curated; the count is small on purpose."
              entries={data.chronicle}
              valueAccent="text-amber-300"
            />

            <RegisterCard
              title="the refused"
              flavor="players who reached the end of a run as forsaken-revenant or the-still-one. they did not pledge. the world records them anyway."
              entries={data.refused}
              valueAccent="text-stone-300"
            />

            <RecurringRegisterCard
              entries={data.recurring}
            />
          </>
        )}
      </div>
    </main>
  );
}

function RegisterCard({
  title,
  flavor,
  entries,
  valueAccent,
}: {
  title: string;
  flavor: string;
  entries: RegisterEntry[];
  valueAccent: string;
}) {
  return (
    <section className="border border-stone-800 bg-stone-900/40 px-4 py-3 space-y-3">
      <div className="space-y-1">
        <h2 className="text-stone-100 text-sm">{title}</h2>
        <p className="text-[11px] text-stone-500 italic leading-5">
          {flavor}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-stone-600 italic">
          the register is empty.
        </p>
      ) : (
        <ol className="space-y-1 text-xs">
          {entries.map((e) => (
            <li
              key={`${e.rank}-${e.username}`}
              className="flex items-baseline gap-3"
            >
              <span className="text-stone-600 w-5 text-right">
                {e.rank}.
              </span>
              <span className="text-stone-200 flex-1 truncate">
                {e.username}
              </span>
              {e.context && (
                <span className="text-[10px] text-stone-600 italic truncate">
                  {e.context}
                </span>
              )}
              <span className={`${valueAccent} text-[11px]`}>
                {e.formattedValue}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecurringRegisterCard({
  entries,
}: {
  entries: NpcRecurringRegister[];
}) {
  return (
    <section className="border border-stone-800 bg-stone-900/40 px-4 py-3 space-y-3">
      <div className="space-y-1">
        <h2 className="text-stone-100 text-sm">the recurring</h2>
        <p className="text-[11px] text-stone-500 italic leading-5">
          for each recurring NPC, the players they have met most.
          recurring NPCs keep their own books. these are excerpts.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-stone-600 italic">
          no recurring NPCs have been met yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li
              key={e.npcSlug}
              className="border-l-2 border-stone-800 pl-3 space-y-1"
            >
              <div className="text-[11px] uppercase tracking-widest text-stone-500">
                {e.npcName}
              </div>
              <ol className="space-y-0.5 text-xs">
                {e.topPlayers.map((p) => (
                  <li
                    key={`${e.npcSlug}-${p.rank}-${p.username}`}
                    className="flex items-baseline gap-3"
                  >
                    <span className="text-stone-600 w-5 text-right">
                      {p.rank}.
                    </span>
                    <span className="text-stone-200 flex-1 truncate">
                      {p.username}
                    </span>
                    {p.context && (
                      <span className="text-[10px] text-stone-600 italic truncate">
                        {p.context}
                      </span>
                    )}
                    <span className="text-amber-400 text-[11px]">
                      {p.formattedValue}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
