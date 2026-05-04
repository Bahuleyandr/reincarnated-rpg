"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TodayTicker } from "@/components/TodayTicker";

/** Mirror of the dashboard's pool — anon players get the same surprises. */
const SURPRISE_POOL: string[] = [
  "a lesser slime",
  "a cursed book left on an altar",
  "a dragon egg, still warm",
  "a dungeon core newly awakened",
  "a knight's discarded helmet, sentient",
  "a cartographer's ghost",
  "a coin that has changed hands too many times",
  "a wolf, wounded and hungry",
  "a cellar door that should not have opened",
  "a candle still burning at the bottom of a well",
  "a memory of a name no one will say aloud",
  "an apprentice who fell into the wrong puddle",
];

function pickSurprise(): string {
  return SURPRISE_POOL[Math.floor(Math.random() * SURPRISE_POOL.length)];
}

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAccount, setHasAccount] = useState(false);
  const [reincarnatedAs, setReincarnatedAs] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: { user: unknown }) => setHasAccount(!!d.user))
      .catch(() => {});
  }, []);

  async function begin(declaration?: string) {
    setBusy(true);
    setError(null);
    try {
      const body = declaration?.trim()
        ? JSON.stringify({ reincarnatedAs: declaration.trim() })
        : undefined;
      const res = await fetch("/api/session", {
        method: "POST",
        ...(body
          ? { headers: { "content-type": "application/json" }, body }
          : {}),
      });
      if (!res.ok) {
        setError(`session create failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/play");
    } catch (e) {
      setError(`network error: ${e instanceof Error ? e.message : "unknown"}`);
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void begin(reincarnatedAs);
  }

  function onSurprise() {
    const pick = pickSurprise();
    setReincarnatedAs(pick);
    void begin(pick);
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono flex items-center justify-center px-6 py-10">
      <div className="max-w-2xl w-full space-y-10">
        <TodayTicker />
        <header className="space-y-3">
          <h1 className="text-3xl tracking-tight text-stone-100">
            Reincarnated in Another World as…
          </h1>
          <p className="text-stone-400 text-sm leading-6">
            A persistent text RPG where every reincarnation form &mdash; slime,
            cursed book, dungeon core &mdash; plays as a fundamentally different
            game. The world remembers what you did.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="border border-stone-800 p-6 space-y-3 bg-stone-900/40"
        >
          <label className="block space-y-1">
            <span className="text-stone-100 text-sm">
              what do you wake up as?
            </span>
            <input
              type="text"
              value={reincarnatedAs}
              onChange={(e) => setReincarnatedAs(e.target.value)}
              placeholder="a cursed book · a dragon egg · a lesser slime"
              className="w-full bg-stone-950 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:border-stone-500 mt-1"
            />
            <span className="block text-[10px] text-stone-600 leading-4">
              free text. leave blank to default to a lesser slime. say "slime"
              for the typed form; anything else uses the generic shape and
              the narrator flavors the prose. the location is rolled randomly.
            </span>
          </label>
          <p className="text-stone-500 text-xs leading-5">
            10-turn cap. Anonymous session in a signed cookie. CC BY-NC 4.0.
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="border border-stone-300 text-stone-100 py-2 px-6 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {busy ? "starting…" : hasAccount ? "Begin (anon run)" : "Begin"}
            </button>
            <button
              type="button"
              onClick={onSurprise}
              disabled={busy}
              className="border border-stone-700 text-stone-300 py-2 px-6 hover:border-stone-500 hover:text-stone-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              surprise me
            </button>
            <Link
              href="/reincarnate"
              className="border border-amber-800 text-amber-300 py-2 px-6 hover:bg-amber-950 hover:text-amber-100 transition-colors text-sm"
            >
              ask the God
            </Link>
          </div>
        </form>

        <div className="flex items-center justify-between text-xs text-stone-500">
          {hasAccount ? (
            <Link
              href="/dashboard"
              className="underline underline-offset-2 hover:text-stone-300"
            >
              go to my runs →
            </Link>
          ) : (
            <Link
              href="/login"
              className="underline underline-offset-2 hover:text-stone-300"
            >
              already have an account? sign in
            </Link>
          )}
          {!hasAccount && (
            <Link
              href="/register"
              className="underline underline-offset-2 hover:text-stone-300"
            >
              register to save your run
            </Link>
          )}
        </div>

        <div className="text-[10px] text-stone-600 flex items-center gap-4 flex-wrap">
          <Link
            href="/meta"
            className="underline underline-offset-2 hover:text-amber-400"
          >
            the long wyrm →
          </Link>
          <Link
            href="/leaderboard"
            className="underline underline-offset-2 hover:text-stone-400"
          >
            model leaderboard →
          </Link>
          <Link
            href="/god"
            className="underline underline-offset-2 hover:text-stone-400"
          >
            god-mod →
          </Link>
        </div>
      </div>
    </main>
  );
}
