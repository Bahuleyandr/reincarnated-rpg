/**
 * Public read-only lore feed. No auth — anyone with the URL can
 * read the world's accumulated history, but only for entries old
 * enough (>24h) to have crossed the public-delay window.
 *
 * Server component: renders fresh on each request, cached upstream
 * by /api/lore/public's 5-min in-memory cache.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "world lore" };

interface LoreEntry {
  id: string;
  summary: string;
  prose: string | null;
  category: string | null;
  salience: number;
  tags: string[];
  createdAtMs: number;
  publicAtMs: number;
  sourceLocationId: string | null;
  sourceFormId: string | null;
  sourcePhase: string | null;
}

interface Resp {
  entries: LoreEntry[];
  pulse: { recentCount: number; priorCount: number };
  delayHours: number;
  nextCursor: string | null;
}

const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN ?? "http://localhost:3000";

async function fetchLore(): Promise<Resp | null> {
  try {
    const r = await fetch(`${ORIGIN}/api/lore/public`, {
      next: { revalidate: 300 },
    });
    if (!r.ok) return null;
    return (await r.json()) as Resp;
  } catch {
    return null;
  }
}

export default async function LorePage() {
  const data = await fetchLore();

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-stone-600">
            world lore — delayed 24h
          </p>
          <h1 className="text-xl text-stone-100">the world remembers</h1>
          {data && (
            <PulseLine
              recent={data.pulse.recentCount}
              prior={data.pulse.priorCount}
            />
          )}
          <p className="text-stone-500 text-xs leading-5">
            entries appear here once they&rsquo;re a day old. what
            happened in the last twenty-four hours is still settling.
          </p>
        </header>

        {!data || data.entries.length === 0 ? (
          <p className="text-stone-600 italic text-sm">
            the world is still gathering its memory. come back tomorrow.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.entries.map((e) => (
              <li
                key={e.id}
                className="border border-stone-800 bg-stone-900/40 p-3 leading-6 space-y-1"
              >
                <p className="text-stone-200 text-sm">{e.summary}</p>
                {e.prose && (
                  <p className="text-stone-400 italic text-xs leading-5">
                    {e.prose}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-[10px] text-stone-600 pt-1">
                  {e.category && (
                    <span className="text-stone-500">{e.category}</span>
                  )}
                  {e.sourceLocationId && (
                    <span>at {e.sourceLocationId}</span>
                  )}
                  {e.sourcePhase && (
                    <span>phase: {e.sourcePhase}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="border-t border-stone-900 pt-4 text-[10px] text-stone-600">
          <Link
            href="/"
            className="hover:text-stone-400 underline underline-offset-2"
          >
            ← back home
          </Link>
        </footer>
      </div>
    </main>
  );
}

function PulseLine({ recent, prior }: { recent: number; prior: number }) {
  if (recent === 0 && prior === 0) return null;
  const direction =
    recent > prior * 1.2
      ? "stirred more than usual"
      : recent < prior * 0.8
        ? "gone quieter than usual"
        : "settled at its normal pace";
  return (
    <p className="text-[11px] text-amber-300/80 italic">
      yesterday the world {direction} ({recent} entries vs {prior} the day before).
    </p>
  );
}
