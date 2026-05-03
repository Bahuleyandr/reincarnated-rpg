"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChatPanel } from "@/components/ChatPanel";
import { InputBox } from "@/components/InputBox";
import { InventoryPanel } from "@/components/InventoryPanel";
import { NearbyBox } from "@/components/NearbyBox";
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
  const [llmBanner, setLlmBanner] = useState<string | null>(null);
  const [arcTagline, setArcTagline] = useState<string | null>(null);
  const [metaArc, setMetaArc] = useState<{
    phaseLabel: string;
    phase: string;
  } | null>(null);
  const [nearby, setNearby] = useState<{
    room: { locationId: string; roomId: string | null };
    pcs: Array<{
      sessionId: string;
      username: string | null;
      displayName: string;
      formId: string;
      isSelf: boolean;
    }>;
  } | null>(null);
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
        setArcTagline(data.arcTagline ?? null);
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
    // Lightweight meta-arc poll for the indicator (no auth needed).
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { arc?: { phaseLabel: string; phase: string } }) => {
        if (!cancelled && d.arc) {
          setMetaArc({ phaseLabel: d.arc.phaseLabel, phase: d.arc.phase });
        }
      })
      .catch(() => {});

    // Presence: bump heartbeat every 30s; refresh nearby every 10s.
    async function bumpHeartbeat() {
      try {
        await fetch("/api/presence/heartbeat", { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    async function refreshNearby() {
      try {
        const r = await fetch("/api/presence/nearby");
        if (!r.ok) return;
        const d = (await r.json()) as {
          room: { locationId: string; roomId: string | null };
          nearby: Array<{
            sessionId: string;
            username: string | null;
            displayName: string;
            formId: string;
            isSelf: boolean;
          }>;
        };
        if (!cancelled) setNearby({ room: d.room, pcs: d.nearby });
      } catch {
        /* ignore */
      }
    }
    bumpHeartbeat();
    refreshNearby();
    const heartbeatId = setInterval(bumpHeartbeat, 30_000);
    const nearbyId = setInterval(refreshNearby, 10_000);
    return () => {
      cancelled = true;
      clearInterval(heartbeatId);
      clearInterval(nearbyId);
    };
  }, [router]);

  async function handleInput(text: string) {
    setBusy(true);
    setError(null);
    setEntries((prev) => [...prev, { kind: "input", text }]);
    // Reserve a streaming-narration entry that we update in place as
    // text deltas arrive. We push it now (empty) and replace its text
    // on each delta.
    let streamIdx = -1;
    setEntries((prev) => {
      streamIdx = prev.length;
      return [...prev, { kind: "narration", text: "", roll: null }];
    });

    let streamedText = "";
    let final:
      | {
          narration: string;
          projection: Projection;
          roll: RollResult | null;
          narratorFallback?: boolean;
          narratorFallbackReason?: string;
        }
      | null = null;
    let errorMsg: string | null = null;

    try {
      const res = await fetch("/api/turn/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ input: text }),
      });
      if (!res.ok || !res.body) {
        errorMsg = `turn failed (${res.status})`;
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6)) as
                  | { type: "text"; delta: string }
                  | {
                      type: "done";
                      narration: string;
                      projection: Projection;
                      roll: RollResult | null;
                      narratorFallback?: boolean;
                      narratorFallbackReason?: string;
                    }
                  | { type: "error"; error: string };
                if (ev.type === "text") {
                  streamedText += ev.delta;
                  setEntries((prev) => {
                    const next = [...prev];
                    if (next[streamIdx]?.kind === "narration") {
                      next[streamIdx] = {
                        ...next[streamIdx],
                        text: streamedText,
                      };
                    }
                    return next;
                  });
                } else if (ev.type === "done") {
                  final = {
                    narration: ev.narration,
                    projection: ev.projection,
                    roll: ev.roll ?? null,
                    narratorFallback: ev.narratorFallback,
                    narratorFallbackReason: ev.narratorFallbackReason,
                  };
                } else if (ev.type === "error") {
                  errorMsg = ev.error;
                }
              } catch {
                /* drop malformed line */
              }
            }
          }
        }
      }
    } catch (e) {
      errorMsg = `network: ${e instanceof Error ? e.message : "?"}`;
    }

    if (errorMsg && !final) {
      setError(errorMsg);
      setEntries((prev) => prev.filter((_, i) => i !== streamIdx));
      setBusy(false);
      return;
    }
    if (final) {
      setProjection(final.projection);
      // Replace the streamed entry with the canonical final text +
      // attach the roll. The narration text from `final` may differ
      // slightly from the streamed accumulation (e.g. trimming) so
      // we use the canonical version.
      setEntries((prev) => {
        const next = [...prev];
        if (next[streamIdx]?.kind === "narration") {
          next[streamIdx] = {
            kind: "narration",
            text: final!.narration,
            roll: final!.roll ?? null,
          };
        }
        return next;
      });
      if (final.narratorFallback) {
        setLlmBanner(
          `your llm had trouble (${final.narratorFallbackReason ?? "unknown"}). this turn used the offline narrator. open settings to test or switch.`,
        );
      } else if (llmBanner) {
        setLlmBanner(null);
      }
    }
    setBusy(false);
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
        {metaArc && (
          <Link
            href="/meta"
            className="px-6 py-1.5 border-b border-stone-800 bg-stone-900/60 text-[10px] flex items-center justify-between text-stone-500 hover:text-stone-300 hover:bg-stone-900"
          >
            <span>
              the long wyrm:{" "}
              <span className="text-amber-400">{metaArc.phaseLabel}</span>
            </span>
            <span className="text-stone-600 group-hover:text-stone-400">
              meta →
            </span>
          </Link>
        )}
        {arcTagline && entries.length === 0 && (
          <div className="px-6 py-3 border-b border-stone-800 bg-stone-900/40">
            <div className="text-[10px] uppercase tracking-widest text-stone-600 mb-1">
              your arc
            </div>
            <div className="text-sm text-stone-300 leading-6">{arcTagline}</div>
          </div>
        )}
        {llmBanner && (
          <div className="px-4 py-2 border-b border-amber-900/60 bg-amber-950/40 text-amber-300 text-xs flex items-center gap-3">
            <span className="flex-1">{llmBanner}</span>
            <Link
              href="/settings"
              className="underline underline-offset-2 hover:text-amber-200"
            >
              open settings →
            </Link>
            <button
              type="button"
              onClick={() => setLlmBanner(null)}
              className="text-amber-700 hover:text-amber-200"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
        )}
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
        {nearby && projection && (
          <NearbyBox
            room={nearby.room}
            pcs={nearby.pcs}
            npcs={Object.entries(projection.npcs).map(([slug, n]) => ({
              slug,
              name: n.name,
              relationship: n.relationship,
            }))}
          />
        )}
        {nearby?.room.roomId && projection && (
          <ChatPanel
            room={nearby.room}
            canSpeak={projection.status === "active"}
          />
        )}
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
