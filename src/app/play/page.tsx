"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { InputBox } from "@/components/InputBox";
import { Transcript } from "@/components/Transcript";
import { VitalsBar } from "@/components/VitalsBar";
import type { Projection } from "@/lib/game/types";

interface Entry {
  kind: "narration" | "input";
  text: string;
}

export default function Play() {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/state");
        if (res.status === 401) {
          router.push("/");
          return;
        }
        if (!res.ok) {
          setError(`load failed (${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setProjection(data.projection);
        setEntries(
          (data.narrations as string[]).map((text) => ({
            kind: "narration" as const,
            text,
          })),
        );
      } catch (e) {
        if (!cancelled)
          setError(`network: ${e instanceof Error ? e.message : "?"}`);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleInput(text: string) {
    setBusy(true);
    setError(null);
    setEntries((prev) => [...prev, { kind: "input", text }]);
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: text }),
      });
      if (!res.ok) {
        setError(`turn failed (${res.status})`);
        setBusy(false);
        return;
      }
      const data = await res.json();
      setProjection(data.projection);
      setEntries((prev) => [
        ...prev,
        { kind: "narration", text: data.narration },
      ]);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) {
        setError(`restart failed (${res.status})`);
        setBusy(false);
        return;
      }
      // Refresh state.
      window.location.reload();
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  const ended =
    projection && projection.status !== "active";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono flex flex-col">
      <VitalsBar projection={projection} />
      <Transcript entries={entries} />
      {error && (
        <p className="px-2 py-1 text-red-400 text-xs">{error}</p>
      )}
      {ended ? (
        <div className="border-t border-stone-800 px-2 py-3 flex items-center gap-3">
          <span
            className={
              projection!.status === "won"
                ? "text-amber-300"
                : "text-red-400"
            }
            data-testid="end-banner"
          >
            session.ended ({projection!.status})
          </span>
          <button
            type="button"
            onClick={restart}
            disabled={busy}
            className="text-stone-400 hover:text-stone-100 underline underline-offset-2"
            data-testid="restart"
          >
            begin again
          </button>
        </div>
      ) : (
        <InputBox onSubmit={handleInput} disabled={busy} />
      )}
    </main>
  );
}
