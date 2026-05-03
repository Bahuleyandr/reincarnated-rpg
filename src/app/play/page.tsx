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

  const ended = projection && projection.status !== "active";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono flex flex-col">
      <VitalsBar projection={projection} />
      <Transcript entries={entries} />
      {error && <p className="px-2 py-1 text-red-400 text-xs">{error}</p>}
      {ended ? (
        <Recap projection={projection!} onRestart={restart} busy={busy} />
      ) : (
        <InputBox onSubmit={handleInput} disabled={busy} />
      )}
    </main>
  );
}

function Recap({
  projection,
  onRestart,
  busy,
}: {
  projection: Projection;
  onRestart(): void;
  busy: boolean;
}) {
  const status = projection.status;
  const turn = projection.turn;
  const room = projection.location.roomId;
  const tone =
    status === "won"
      ? "text-amber-300"
      : status === "dead"
        ? "text-red-400"
        : "text-stone-300";
  const verdict =
    status === "won"
      ? "the night ends. you survived."
      : status === "dead"
        ? "the dark closes. cohesion = 0."
        : "the cap falls. ten turns are spent.";

  return (
    <section
      className="border-t border-stone-800 px-3 py-4 space-y-3"
      data-testid="recap"
    >
      <div className={`${tone} text-sm tracking-wide`} data-testid="end-banner">
        session.ended ({status})
      </div>
      <p className="text-stone-200 text-sm leading-6">{verdict}</p>
      <ul className="text-xs text-stone-500 space-y-1">
        <li>turns: {turn}</li>
        <li>final room: {room}</li>
        <li>
          vitals:{" "}
          {Object.entries(projection.form.vitals)
            .map(([k, v]) => `${k}=${v}/${projection.form.vitalsMax[k] ?? "?"}`)
            .join(", ")}
        </li>
        <li>discovered: {projection.location.discovered.join(", ")}</li>
        <li>xp: {projection.xp}</li>
      </ul>
      <button
        type="button"
        onClick={onRestart}
        disabled={busy}
        className="text-stone-400 hover:text-stone-100 underline underline-offset-2 text-sm disabled:opacity-50"
        data-testid="restart"
      >
        begin again
      </button>
    </section>
  );
}
