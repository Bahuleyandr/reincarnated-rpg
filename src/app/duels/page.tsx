"use client";

/**
 * /duels — challenge another player or recurring NPC; respond
 * to incoming challenges; see outgoing history.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface IncomingDuel {
  id: string;
  challengerUsername: string | null;
  status: string;
  contextFaction: string | null;
  contextVenue: string | null;
  contextQuote: string | null;
  challengedAtMs: number;
}

interface OutgoingDuel {
  id: string;
  targetUsername: string | null;
  targetNpcTemplateId: string | null;
  status: string;
  challengedAtMs: number;
  challengerRoll: number | null;
  targetRoll: number | null;
  winnerSide: "challenger" | "target" | "tied" | null;
}

type Folder = "incoming" | "outgoing" | "challenge";

/** Maps the ChallengeResult / RespondResult error enums (defined in
 *  src/lib/duels/lobby.ts) to player-friendly copy. Anything we don't
 *  recognise falls through to the raw enum so it's still surfaced. */
function humaniseDuelError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "no_target":
      return "pick a target first.";
    case "self_challenge":
      return "you can't duel yourself.";
    case "target_not_found":
      return "no player with that name.";
    case "already_pending":
      return "you already have a pending challenge against them.";
    case "duel_not_found":
      return "that duel no longer exists.";
    case "not_target":
      return "this challenge isn't yours to answer.";
    case "wrong_status":
      return "this challenge has already been answered.";
    default:
      return code ? `${code} — ${fallback}` : fallback;
  }
}

export default function DuelsPage() {
  const [folder, setFolder] = useState<Folder>("incoming");
  const [incoming, setIncoming] = useState<IncomingDuel[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingDuel[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{
    challengerRoll: number;
    targetRoll: number;
    winnerUserId: string | null;
    winnerNpcTemplateId?: string | null;
    tied: boolean;
    trashTalk?: string | null;
    refusalLine?: string | null;
  } | null>(null);
  // Challenge form
  const [targetKind, setTargetKind] = useState<"player" | "npc">("player");
  const [target, setTarget] = useState("");
  const [npcTemplateId, setNpcTemplateId] = useState("rhozell");
  const [contextFaction, setContextFaction] = useState("");
  const [contextVenue, setContextVenue] = useState("");
  const [contextQuote, setContextQuote] = useState("");

  const load = useCallback(async () => {
    const [i, o] = await Promise.all([
      fetch("/api/duels?folder=incoming"),
      fetch("/api/duels?folder=outgoing"),
    ]);
    if (i.ok) {
      const d = (await i.json()) as { duels: IncomingDuel[] };
      setIncoming(d.duels);
    }
    if (o.ok) {
      const d = (await o.json()) as { duels: OutgoingDuel[] };
      setOutgoing(d.duels);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  async function challenge(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setResolution(null);
    try {
      const body =
        targetKind === "npc"
          ? {
              action: "challenge",
              targetNpcTemplateId: npcTemplateId,
              contextFaction: contextFaction.trim() || undefined,
              contextVenue: contextVenue.trim() || undefined,
              contextQuote: contextQuote.trim() || undefined,
            }
          : {
              action: "challenge",
              targetUsername: target.trim() || undefined,
              contextFaction: contextFaction.trim() || undefined,
              contextVenue: contextVenue.trim() || undefined,
              contextQuote: contextQuote.trim() || undefined,
            };
      const r = await fetch("/api/duels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        error?: string;
        npcOutcome?:
          | {
              outcome: "refused";
              refusalLine: string | null;
            }
          | {
              outcome: "resolved";
              challengerRoll: number;
              targetRoll: number;
              winnerUserId: string | null;
              winnerNpcTemplateId: string | null;
              tied: boolean;
              trashTalk: string | null;
            };
      };
      if (r.ok && d.ok) {
        if (d.npcOutcome) {
          if (d.npcOutcome.outcome === "refused") {
            setMsg("the npc refused.");
            setResolution({
              challengerRoll: 0,
              targetRoll: 0,
              winnerUserId: null,
              winnerNpcTemplateId: null,
              tied: false,
              trashTalk: null,
              refusalLine: d.npcOutcome.refusalLine,
            });
          } else {
            setMsg("challenge resolved.");
            setResolution({
              challengerRoll: d.npcOutcome.challengerRoll,
              targetRoll: d.npcOutcome.targetRoll,
              winnerUserId: d.npcOutcome.winnerUserId,
              winnerNpcTemplateId: d.npcOutcome.winnerNpcTemplateId,
              tied: d.npcOutcome.tied,
              trashTalk: d.npcOutcome.trashTalk,
              refusalLine: null,
            });
          }
        } else {
          setMsg("challenge sent.");
        }
        setTarget("");
        setContextFaction("");
        setContextVenue("");
        setContextQuote("");
        await load();
      } else {
        setMsg(humaniseDuelError(d.error, r.statusText));
      }
    } finally {
      setBusy(false);
    }
  }

  async function respond(duelId: string, decision: "accept" | "refuse") {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setResolution(null);
    try {
      const r = await fetch("/api/duels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "respond", duelId, decision }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        error?: string;
        resolution?: {
          challengerRoll: number;
          targetRoll: number;
          winnerUserId: string | null;
          tied: boolean;
        };
      };
      if (r.ok && d.ok) {
        setMsg(`${decision}.`);
        if (d.resolution) {
          setResolution(d.resolution);
        }
        await load();
      } else {
        setMsg(humaniseDuelError(d.error, r.statusText));
      }
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (active: boolean) =>
    active
      ? "px-3 py-1 text-stone-100 border-b border-stone-300"
      : "px-3 py-1 text-stone-500 hover:text-stone-300";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">duels</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          opt-in 1v1. against another player, each side rolls 2d6 with a
          +1 if their race matches the duel&apos;s context faction; the
          target accepts or refuses, and an accept resolves instantly.
          against a recurring NPC, the duel auto-flows: the NPC rolls
          their own acceptance, and on accept rolls 2d6 + their dueling
          modifier in one round-trip. higher total wins; ties count as
          ties. anything beyond the roll (reputation, coin) is
          intentionally absent — duels are about the moment.
        </p>

        <nav className="flex gap-1 border-b border-stone-800">
          <button
            type="button"
            className={tabClass(folder === "incoming")}
            onClick={() => setFolder("incoming")}
          >
            incoming{incoming.filter((d) => d.status === "pending").length > 0 ? ` (${incoming.filter((d) => d.status === "pending").length})` : ""}
          </button>
          <button
            type="button"
            className={tabClass(folder === "outgoing")}
            onClick={() => setFolder("outgoing")}
          >
            outgoing
          </button>
          <button
            type="button"
            className={tabClass(folder === "challenge")}
            onClick={() => setFolder("challenge")}
          >
            challenge
          </button>
        </nav>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        {resolution && (
          <div className="text-xs text-stone-300 bg-amber-950/20 border border-amber-700/60 px-3 py-2 rounded space-y-1">
            {resolution.refusalLine ? (
              <>
                <div className="font-semibold">refused.</div>
                <div className="text-[11px] text-stone-400 italic">
                  &ldquo;{resolution.refusalLine}&rdquo;
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">
                  {resolution.tied
                    ? "tied."
                    : resolution.winnerNpcTemplateId
                      ? `${resolution.winnerNpcTemplateId} wins.`
                      : resolution.winnerUserId
                        ? "you win."
                        : "decided."}
                </div>
                <div className="text-[11px] text-stone-400">
                  challenger: {resolution.challengerRoll} · target:{" "}
                  {resolution.targetRoll}
                </div>
                {resolution.trashTalk && (
                  <div className="text-[11px] text-stone-400 italic pt-0.5">
                    &ldquo;{resolution.trashTalk}&rdquo;
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {folder === "incoming" && (
          <ul className="space-y-1">
            {incoming.length === 0 && (
              <li className="text-xs text-stone-600 italic">
                no incoming challenges.
              </li>
            )}
            {incoming.map((d) => (
              <li
                key={d.id}
                className="border border-stone-800 px-3 py-2 space-y-1"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-stone-200">
                    {d.challengerUsername ?? "(anon)"}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      d.status === "pending"
                        ? "text-amber-400"
                        : d.status === "resolved"
                          ? "text-emerald-400"
                          : "text-stone-500"
                    }`}
                  >
                    {d.status}
                  </span>
                  <span className="text-[10px] text-stone-600 ml-auto">
                    {new Date(d.challengedAtMs).toLocaleString()}
                  </span>
                </div>
                {(d.contextFaction || d.contextVenue || d.contextQuote) && (
                  <div className="text-[10px] text-stone-500">
                    {[d.contextFaction, d.contextVenue, d.contextQuote]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                {d.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => respond(d.id, "accept")}
                      disabled={busy}
                      className="text-[10px] px-2 py-0.5 border border-emerald-700 text-emerald-300 rounded hover:bg-emerald-950 disabled:opacity-50"
                    >
                      accept (auto-resolves)
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(d.id, "refuse")}
                      disabled={busy}
                      className="text-[10px] px-2 py-0.5 border border-red-700 text-red-300 rounded hover:bg-red-950 disabled:opacity-50"
                    >
                      refuse
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {folder === "outgoing" && (
          <ul className="space-y-1">
            {outgoing.length === 0 && (
              <li className="text-xs text-stone-600 italic">
                you have not challenged anyone.
              </li>
            )}
            {outgoing.map((d) => (
              <li
                key={d.id}
                className="border border-stone-800 px-3 py-2 space-y-1"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-stone-200">
                    {d.targetUsername ?? d.targetNpcTemplateId ?? "?"}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      d.status === "pending"
                        ? "text-amber-400"
                        : d.status === "resolved"
                          ? "text-emerald-400"
                          : d.status === "refused"
                            ? "text-red-400"
                            : "text-stone-500"
                    }`}
                  >
                    {d.status}
                  </span>
                  <span className="text-[10px] text-stone-600 ml-auto">
                    {new Date(d.challengedAtMs).toLocaleString()}
                  </span>
                </div>
                {d.status === "resolved" &&
                  d.challengerRoll !== null &&
                  d.targetRoll !== null && (
                    <div className="text-[10px] text-stone-500">
                      <span
                        className={
                          d.winnerSide === "challenger"
                            ? "text-emerald-400"
                            : d.winnerSide === "target"
                              ? "text-red-400"
                              : "text-stone-400"
                        }
                      >
                        {d.winnerSide === "challenger"
                          ? "you won"
                          : d.winnerSide === "target"
                            ? "you lost"
                            : "tied"}
                      </span>
                      <span className="ml-2">
                        you {d.challengerRoll} ·{" "}
                        {d.targetUsername ??
                          d.targetNpcTemplateId ??
                          "target"}{" "}
                        {d.targetRoll}
                      </span>
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}

        {folder === "challenge" && (
          <form onSubmit={challenge} className="space-y-3">
            <div className="flex gap-3 text-xs text-stone-400">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetKind"
                  value="player"
                  checked={targetKind === "player"}
                  onChange={() => setTargetKind("player")}
                />
                <span>player</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetKind"
                  value="npc"
                  checked={targetKind === "npc"}
                  onChange={() => setTargetKind("npc")}
                />
                <span>npc (auto-resolves)</span>
              </label>
            </div>
            {targetKind === "player" ? (
              <div>
                <label
                  htmlFor="tgt"
                  className="block text-xs text-stone-400 mb-1"
                >
                  target username
                </label>
                <input
                  id="tgt"
                  required
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full bg-stone-900 border border-stone-700 px-3 py-2 rounded text-stone-200 text-sm"
                />
              </div>
            ) : (
              <div>
                <label
                  htmlFor="npc"
                  className="block text-xs text-stone-400 mb-1"
                >
                  npc template
                </label>
                <select
                  id="npc"
                  value={npcTemplateId}
                  onChange={(e) => setNpcTemplateId(e.target.value)}
                  className="w-full bg-stone-900 border border-stone-700 px-3 py-2 rounded text-stone-200 text-sm"
                >
                  <option value="rhozell">
                    rhozell (acceptance 0.95, +2)
                  </option>
                  <option value="captain-mira-of-the-anchor">
                    captain mira (acceptance 0.4, +2)
                  </option>
                  <option value="the-binder">
                    the-binder (acceptance 0.25, +1)
                  </option>
                  <option value="wrong-reader">
                    wrong-reader (acceptance 0.7, +0)
                  </option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="cf" className="block text-[10px] text-stone-400 mb-1">
                  context faction (optional)
                </label>
                <select
                  id="cf"
                  value={contextFaction}
                  onChange={(e) => setContextFaction(e.target.value)}
                  className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 rounded text-stone-200 text-xs"
                >
                  <option value="">—</option>
                  <option value="human">human</option>
                  <option value="elven">elven</option>
                  <option value="dwarven">dwarven</option>
                  <option value="halfling">halfling</option>
                  <option value="orcish">orcish</option>
                </select>
              </div>
              <div>
                <label htmlFor="cv" className="block text-[10px] text-stone-400 mb-1">
                  context venue (optional)
                </label>
                <input
                  id="cv"
                  type="text"
                  value={contextVenue}
                  onChange={(e) => setContextVenue(e.target.value)}
                  placeholder="the-coral-anchorage"
                  className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 rounded text-stone-200 text-xs"
                />
              </div>
              <div>
                <label htmlFor="cq" className="block text-[10px] text-stone-400 mb-1">
                  context quote (optional)
                </label>
                <input
                  id="cq"
                  type="text"
                  value={contextQuote}
                  onChange={(e) => setContextQuote(e.target.value)}
                  placeholder="a single line."
                  className="w-full bg-stone-900 border border-stone-700 px-2 py-1.5 rounded text-stone-200 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 border border-amber-700 text-amber-300 rounded hover:bg-amber-950 disabled:opacity-50 text-xs"
              >
                {busy ? "challenging…" : "challenge"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
