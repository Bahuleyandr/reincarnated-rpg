"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { InputBox } from "@/components/InputBox";
import { InventoryPanel } from "@/components/InventoryPanel";
import { QuestLog } from "@/components/QuestLog";
import { StatusSidebar } from "@/components/StatusSidebar";
import { Transcript, type TranscriptEntry } from "@/components/Transcript";
import type { Projection, RollResult } from "@/lib/game/types";

export default function Play() {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [hasAccount, setHasAccount] = useState(false);
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
        setHasAccount(!!data.hasAccount);
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
      const data = (await res.json()) as {
        narration: string;
        projection: Projection;
        roll?: RollResult | null;
      };
      setProjection(data.projection);
      setEntries((prev) => [
        ...prev,
        { kind: "narration", text: data.narration, roll: data.roll ?? null },
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
      window.location.reload();
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  const ended = projection && projection.status !== "active";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono grid md:grid-cols-[260px_1fr_260px] grid-rows-[1fr]">
      <StatusSidebar projection={projection} />

      <section className="flex flex-col min-h-screen md:min-h-0">
        <Transcript entries={entries} />
        {error && (
          <p className="px-4 py-1 text-red-400 text-xs">{error}</p>
        )}
        {ended ? (
          <Recap
            projection={projection!}
            onRestart={restart}
            busy={busy}
            hasAccount={hasAccount}
          />
        ) : (
          <InputBox onSubmit={handleInput} disabled={busy} />
        )}
      </section>

      <aside className="border-l border-stone-800 bg-stone-900/40 flex flex-col overflow-y-auto">
        <QuestLog projection={projection} />
        <InventoryPanel projection={projection} />
      </aside>
    </main>
  );
}

function Recap({
  projection,
  onRestart,
  busy,
  hasAccount,
}: {
  projection: Projection;
  onRestart(): void;
  busy: boolean;
  hasAccount: boolean;
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
      className="border-t border-stone-800 px-4 py-4 space-y-3"
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
      <div className="flex items-baseline gap-4 flex-wrap">
        <button
          type="button"
          onClick={onRestart}
          disabled={busy}
          className="text-stone-400 hover:text-stone-100 underline underline-offset-2 text-sm disabled:opacity-50"
          data-testid="restart"
        >
          begin again
        </button>
        {!hasAccount && (
          <Link
            href="/register"
            className="text-amber-300 hover:text-amber-200 underline underline-offset-2 text-sm"
            data-testid="claim-link"
          >
            save this run to your library →
          </Link>
        )}
      </div>
    </section>
  );
}
