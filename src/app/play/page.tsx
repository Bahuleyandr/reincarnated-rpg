"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChatPanel } from "@/components/ChatPanel";
import { CoinBadge } from "@/components/CoinBadge";
import { EnergyBar } from "@/components/EnergyBar";
import { LocationNotes } from "@/components/LocationNotes";
import { ObjectiveRibbon } from "@/components/ObjectiveRibbon";
import { InputBox } from "@/components/InputBox";
import { InventoryPanel } from "@/components/InventoryPanel";
import { NearbyBox } from "@/components/NearbyBox";
import { QuestLog } from "@/components/QuestLog";
import { NarrationVoice } from "@/components/NarrationVoice";
import { StateDiffToast } from "@/components/StateDiffToast";
import { StatusSidebar } from "@/components/StatusSidebar";
import { InRunCompanions } from "@/components/InRunCompanions";
import { Transcript, type TranscriptEntry } from "@/components/Transcript";
import { TutorialHint } from "@/components/TutorialHint";
import { WhereAmI } from "@/components/WhereAmI";
import {
  diffProjection,
  EMPTY_DIFF,
  type ProjectionDiff,
} from "@/lib/game/diff-projection";
import type { Projection, RollResult } from "@/lib/game/types";

export default function Play() {
  const [projection, setProjection] = useState<Projection | null>(null);
  // Per-turn diff for the state-change toast. We keep the last
  // committed projection in a ref-like state so we can diff in-flight
  // updates against it without flickering on every re-render.
  const [stateDiff, setStateDiff] = useState<ProjectionDiff>(EMPTY_DIFF);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [hasAccount, setHasAccount] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isTutorial, setIsTutorial] = useState(false);
  const [tutorialDraft, setTutorialDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // When non-null, a 409 turn-lock conflict triggered an auto-retry.
  // The InputBox uses this to show "settling..." instead of the
  // generic disabled state, so the user knows it's recoverable.
  const [settling, setSettling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [llmBanner, setLlmBanner] = useState<string | null>(null);
  const [arcTagline, setArcTagline] = useState<string | null>(null);
  const [formOpening, setFormOpening] = useState<string | null>(null);
  const [formDisplayName, setFormDisplayName] = useState<string | null>(null);
  const [firstGoal, setFirstGoal] = useState<{
    id: string;
    label: string;
    description: string;
    current: number;
    target: number;
    completed: boolean;
  } | null>(null);
  const [wyrmRunning, setWyrmRunning] = useState<{
    delta: number;
    prose: string;
  } | null>(null);
  const [metaArc, setMetaArc] = useState<{
    phaseLabel: string;
    phase: string;
  } | null>(null);
  const [theme, setTheme] = useState<{
    label: string;
    overrideActive: boolean;
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
        setCampaignId(data.campaignId ?? null);
        setIsTutorial(!!data.isTutorial);
        setArcTagline(data.arcTagline ?? null);
        setFormOpening(data.formOpening ?? null);
        setFormDisplayName(data.formDisplayName ?? null);
        setFirstGoal(data.firstGoal ?? null);
        setWyrmRunning(data.wyrmRunning ?? null);
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
    // Active weekly theme.
    fetch("/api/world")
      .then((r) => r.json())
      .then(
        (d: {
          activeTheme?: { label: string };
          overrideActive?: boolean;
        }) => {
          if (!cancelled && d.activeTheme) {
            setTheme({
              label: d.activeTheme.label,
              overrideActive: !!d.overrideActive,
            });
          }
        },
      )
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
          wyrmRunning?: { delta: number; prose: string };
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
        // Energy 429 carries an `energy` view we surface to the bar.
        if (res.status === 429) {
          try {
            const j = (await res.json()) as {
              error?: string;
              energy?: unknown;
            };
            if (j.energy) {
              window.dispatchEvent(
                new CustomEvent("energy:update", { detail: j.energy }),
              );
            }
            errorMsg =
              j.error ?? "out of energy — wait for the next refill";
          } catch {
            errorMsg = "out of energy";
          }
        } else if (res.status === 409) {
          // Turn-lock conflict — a previous turn is still settling.
          // Show "settling..." in the UI + auto-retry once the lock
          // expires (with a small jitter so multiple competing
          // browsers don't all retry at the same instant).
          try {
            const j = (await res.json()) as {
              error?: string;
              currentLockExpiresAtMs?: number | null;
            };
            const remaining = j.currentLockExpiresAtMs
              ? Math.max(0, j.currentLockExpiresAtMs - Date.now())
              : 5_000;
            const jitter = Math.random() * 750;
            setEntries((prev) => prev.filter((_, i) => i !== streamIdx));
            setSettling(true);
            setTimeout(() => {
              setSettling(false);
              setBusy(false);
              handleInput(text); // retry once
            }, remaining + 250 + jitter);
            return;
          } catch {
            errorMsg = "previous turn is still settling — try again";
          }
        } else {
          errorMsg = `turn failed (${res.status})`;
        }
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
                      wyrmRunning?: { delta: number; prose: string };
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
                    wyrmRunning: ev.wyrmRunning,
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
      // Compute the state diff against the previous projection so
      // the StateDiffToast can pulse the per-turn changes (-4 mana,
      // +1 inventory, room discovered).
      setStateDiff(diffProjection(projection, final.projection));
      setProjection(final.projection);
      if (final.wyrmRunning) setWyrmRunning(final.wyrmRunning);
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
    <main
      // P7.A — per-form theming. The form id flows through to a
      // CSS attribute selector in globals.css so the goal ribbon,
      // meta-arc strip, and dice display can read --form-accent.
      data-form={projection?.form.id ?? null}
      className="min-h-screen bg-stone-950 text-stone-200 font-mono grid md:grid-cols-[260px_1fr_260px] grid-rows-[1fr] md:min-h-0"
    >
      <aside
        className="border-r border-stone-800 flex flex-col overflow-y-auto md:order-1 order-2"
        data-testid="left-sidebar"
      >
        <EnergyBar />
        <div className="px-4 py-1 border-b border-stone-800 bg-stone-900/40 flex items-center gap-2 min-h-[28px]">
          <CoinBadge />
        </div>
        <ObjectiveRibbon />
        <StatusSidebar projection={projection} />
      </aside>

      <section className="flex flex-col min-h-screen md:min-h-0 md:order-2 order-1">
        {projection && (
          <div className="md:hidden px-4 py-2 border-b border-stone-800 bg-stone-900/60 text-[11px] text-stone-400 flex items-baseline gap-3 flex-wrap">
            <span>
              <span className="text-stone-600">form </span>
              <span className="text-stone-200">{projection.form.id}</span>
            </span>
            {Object.entries(projection.form.vitals).map(([k, v]) => {
              const max = projection.form.vitalsMax[k];
              return (
                <span key={k}>
                  <span className="text-stone-600">{k} </span>
                  <span className="text-stone-200">
                    {v}
                    {max !== undefined && max !== null ? `/${max}` : ""}
                  </span>
                </span>
              );
            })}
            <span className="ml-auto text-stone-600">
              ↓ inventory + presence below
            </span>
          </div>
        )}
        {metaArc && (
          <Link
            href="/meta"
            className="px-6 py-1.5 border-b border-stone-800 bg-stone-900/60 text-[10px] flex items-center justify-between text-stone-500 hover:text-stone-300 hover:bg-stone-900"
          >
            <span>
              the long wyrm:{" "}
              <span className="text-amber-400">{metaArc.phaseLabel}</span>
              {wyrmRunning && wyrmRunning.delta !== 0 && (
                <span
                  className="ml-2"
                  title={wyrmRunning.prose}
                >
                  · this run:{" "}
                  <span
                    className={
                      wyrmRunning.delta > 0
                        ? "text-red-400"
                        : "text-emerald-400"
                    }
                  >
                    {wyrmRunning.delta > 0 ? "+" : ""}
                    {wyrmRunning.delta} {wyrmRunning.delta > 0 ? "feed" : "starve"}
                  </span>
                </span>
              )}
              {theme && (
                <>
                  <span className="text-stone-700 mx-2">·</span>
                  this week:{" "}
                  <span className="text-emerald-400">{theme.label}</span>
                  {theme.overrideActive && (
                    <span
                      className="ml-1 text-stone-600"
                      title="An admin pinned this week's theme."
                    >
                      (pinned)
                    </span>
                  )}
                </>
              )}
            </span>
            <span className="text-stone-600 group-hover:text-stone-400">
              meta →
            </span>
          </Link>
        )}
        {/* P7.B — opt-in narration voice. Toggle persists in
         *  localStorage; the component is a no-op when the browser
         *  doesn't expose SpeechSynthesis. */}
        <div className="px-6 py-1 border-b border-stone-800 bg-stone-900/30 flex justify-end">
          <NarrationVoice
            latestNarration={(() => {
              const last = entries[entries.length - 1];
              return last?.kind === "narration" ? last.text : null;
            })()}
            resetKey={projection?.upToSeq ?? 0}
          />
        </div>
        {arcTagline && entries.length === 0 && (
          <div className="px-6 py-3 border-b border-stone-800 bg-stone-900/40">
            <div className="text-[10px] uppercase tracking-widest text-stone-600 mb-1">
              your arc
            </div>
            <div className="text-sm text-stone-300 leading-6">{arcTagline}</div>
          </div>
        )}
        {firstGoal && projection && projection.status === "active" && (
          <div
            className={`px-6 py-2.5 border-b border-stone-800 text-xs flex items-baseline gap-3 ${
              firstGoal.completed ? "animate-goal-pulse" : ""
            }`}
            style={{
              background: firstGoal.completed
                ? "var(--form-accent-bg)"
                : "rgba(28, 25, 23, 0.3)",
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-widest text-stone-600">
                  first goal
                </span>
                <span className="text-stone-200 truncate">
                  {firstGoal.label}
                </span>
                {firstGoal.completed ? (
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--form-accent)" }}
                  >
                    ✓ complete
                  </span>
                ) : (
                  <span className="text-stone-500 text-[10px]">
                    {firstGoal.current}/{firstGoal.target}
                  </span>
                )}
              </div>
              <p className="text-stone-500 italic text-[11px] leading-5 mt-0.5">
                {firstGoal.description}
              </p>
            </div>
            <div className="w-24 h-1 bg-stone-800 rounded overflow-hidden shrink-0">
              <div
                className="h-full transition-all"
                style={{
                  background: firstGoal.completed
                    ? "var(--form-accent)"
                    : "var(--form-accent-soft)",
                  width: `${
                    Math.min(
                      100,
                      (firstGoal.current / firstGoal.target) * 100,
                    )
                  }%`,
                }}
              />
            </div>
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
        <Transcript
          entries={entries}
          emptyHint={
            projection && (
              <div className="space-y-3 text-stone-300 leading-7">
                {formOpening ? (
                  <>
                    <div className="text-[10px] uppercase tracking-widest text-stone-600">
                      {formDisplayName ?? projection.form.id} ·{" "}
                      {projection.location.id}
                    </div>
                    <p className="text-stone-100 italic leading-7">
                      {formOpening}
                    </p>
                  </>
                ) : (
                  <p className="text-stone-100">
                    you wake as{" "}
                    <span className="text-amber-300">
                      {formDisplayName ?? projection.form.id}
                    </span>{" "}
                    in{" "}
                    <span className="text-amber-300">
                      {projection.location.id}
                    </span>
                    .
                  </p>
                )}
                <p className="text-stone-500 text-sm italic">
                  describe what you do — anything from a single verb to a
                  whole sentence. the dice will be rolled against your
                  intent.
                </p>
              </div>
            )
          }
        />
        <div className="px-4 py-1 space-y-2">
          <WhereAmI />
          <InRunCompanions />
        </div>
        {error && (
          <p className="px-4 py-1 text-red-400 text-xs">{error}</p>
        )}
        {ended ? (
          <Recap
            projection={projection!}
            onRestart={restart}
            busy={busy}
            hasAccount={hasAccount}
            campaignId={campaignId}
          />
        ) : (
          <>
            {projection && (
              <StateDiffToast
                diff={stateDiff}
                resetKey={projection.upToSeq}
              />
            )}
            {isTutorial && projection && (
              <TutorialHint
                turn={projection.turn + 1}
                onUseExample={(text) => setTutorialDraft(text)}
                onSkip={() => setIsTutorial(false)}
              />
            )}
            <InputBox
              onSubmit={handleInput}
              disabled={busy}
              settling={settling}
              draft={tutorialDraft}
            />
          </>
        )}
      </section>

      <aside className="border-l border-stone-800 bg-stone-900/40 flex flex-col overflow-y-auto md:order-3 order-3">
        <QuestLog projection={projection} />
        {projection && (
          <LocationNotes
            locationId={projection.location.id}
            formId={projection.form.id}
            canLeave={hasAccount}
          />
        )}
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

/**
 * EpitaphForm — Phase 5.5 Day 30. Shown inside Recap on death for
 * logged-in players. Submits a 280-char last-words to
 * POST /api/campaigns/[id]/epitaph; on success the entry surfaces
 * in the same location's lore 24h later.
 */
function EpitaphForm({ campaignId }: { campaignId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = 280;

  if (submitted) {
    return (
      <p className="text-stone-500 text-xs italic leading-5 border-t border-stone-800/60 pt-3">
        ✦ your last words have been carved into the stone here. another
        soul will read them tomorrow.
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/campaigns/${campaignId}/epitaph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `submit failed (${r.status})`);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 border-t border-stone-800/60 pt-3"
    >
      <label className="block text-stone-400 text-xs leading-5">
        ✦ your last words?{" "}
        <span className="text-stone-600 italic">
          (visible to others passing through here, in 24h)
        </span>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, max))}
        rows={3}
        maxLength={max}
        disabled={busy}
        placeholder="i was almost something"
        className="w-full bg-stone-950 border border-stone-800 px-3 py-2 text-sm text-stone-200 placeholder-stone-700 focus:outline-none focus:border-stone-600"
      />
      <div className="flex items-center justify-between text-[10px] text-stone-600">
        <span className="tabular-nums">
          {text.length}/{max}
        </span>
        <button
          type="submit"
          disabled={busy || text.trim().length === 0}
          className="text-stone-300 hover:text-stone-100 underline underline-offset-4 text-xs disabled:opacity-50"
        >
          carve it
        </button>
      </div>
      {error && (
        <p className="text-red-400 text-[10px]">{error.replace(/_/g, " ")}</p>
      )}
    </form>
  );
}

function Recap({
  projection,
  onRestart,
  busy,
  hasAccount,
  campaignId,
}: {
  projection: Projection;
  onRestart(): void;
  busy: boolean;
  hasAccount: boolean;
  campaignId: string | null;
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
        ? "the dark closes."
        : "the night ends without verdict — ten turns are spent.";

  // Match scrim color to the verdict so death feels like a moment,
  // not a state change. Subtle radial gradient — strong enough to
  // signal the shift in tone, soft enough not to fight the prose.
  const scrim =
    status === "won"
      ? "bg-gradient-to-b from-amber-950/40 via-amber-950/10 to-transparent"
      : status === "dead"
        ? "bg-gradient-to-b from-red-950/40 via-red-950/10 to-transparent"
        : "bg-gradient-to-b from-blue-950/30 via-blue-950/10 to-transparent";

  // Final dice roll source — last roll.resolved isn't kept on
  // projection, but the form's hard-move outcome is implied by the
  // status. We surface what we have; the dice animation
  // (Phase 0c.1) lives at the per-turn site, not here.

  return (
    <section
      className={`border-t border-stone-800 px-4 py-6 space-y-4 ${scrim}`}
      data-testid="recap"
    >
      <div
        className={`${tone} text-base tracking-widest uppercase font-light`}
        data-testid="end-banner"
      >
        {status === "won" ? "✦ survived" : status === "dead" ? "✦ ended" : "✦ silence"}
      </div>
      <p className={`${tone} text-base leading-7 italic`}>{verdict}</p>
      <ul className="text-xs text-stone-500 space-y-1 grid grid-cols-2 sm:grid-cols-3 gap-x-4">
        <li>
          <span className="text-stone-600">turns</span>{" "}
          <span className="text-stone-300">{turn}</span>
        </li>
        <li>
          <span className="text-stone-600">final room</span>{" "}
          <span className="text-stone-300">{room}</span>
        </li>
        <li>
          <span className="text-stone-600">xp</span>{" "}
          <span className="text-stone-300">{projection.xp}</span>
        </li>
        <li className="col-span-2 sm:col-span-3">
          <span className="text-stone-600">vitals</span>{" "}
          <span className="text-stone-300">
            {Object.entries(projection.form.vitals)
              .map(([k, v]) => `${k}=${v}/${projection.form.vitalsMax[k] ?? "?"}`)
              .join(", ")}
          </span>
        </li>
        <li className="col-span-2 sm:col-span-3">
          <span className="text-stone-600">discovered</span>{" "}
          <span className="text-stone-400">
            {projection.location.discovered.join(", ")}
          </span>
        </li>
      </ul>
      {status === "dead" && hasAccount && campaignId && (
        <EpitaphForm campaignId={campaignId} />
      )}
      <div className="flex items-baseline gap-4 flex-wrap pt-1">
        <button
          type="button"
          onClick={onRestart}
          disabled={busy}
          className="text-stone-300 hover:text-stone-100 underline underline-offset-4 text-sm disabled:opacity-50"
          data-testid="restart"
        >
          begin again
        </button>
        {!hasAccount && (
          <Link
            href="/register"
            className="text-amber-300 hover:text-amber-200 underline underline-offset-4 text-sm"
            data-testid="claim-link"
          >
            save this run to your library →
          </Link>
        )}
        {hasAccount && (
          <Link
            href="/character"
            className="text-stone-500 hover:text-stone-300 underline underline-offset-4 text-sm"
          >
            view your character →
          </Link>
        )}
      </div>
    </section>
  );
}
