"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", { method: "POST" });
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

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono flex items-center justify-center px-6">
      <div className="max-w-2xl w-full space-y-10">
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

        <section className="border border-stone-800 p-6 space-y-3 bg-stone-900/40">
          <h2 className="text-stone-100">v0.1: Lesser Slime</h2>
          <p className="text-stone-400 text-sm leading-6">
            You will wake in the dark with no body that fits the word. The
            world is cold, and wet, and chemical. Survive the night.
          </p>
          <p className="text-stone-500 text-xs leading-5">
            10-turn cap. Anonymous session in a signed cookie. CC BY-NC 4.0.
          </p>
        </section>

        <button
          type="button"
          onClick={begin}
          disabled={busy}
          className="w-full border border-stone-300 text-stone-100 py-3 px-6 hover:bg-stone-100 hover:text-stone-950 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "starting…" : "Begin"}
        </button>

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
      </div>
    </main>
  );
}
