"use client";

/**
 * /daily — Phase 9 daily shared-seed loop.
 *
 * Wordle-style. Every player on the same UTC date gets the same
 * (form, location, seed). One attempt per day. The leaderboard
 * ranks runs by status (won > capped > dead) then turn count.
 *
 * Logged-in: show today's challenge + a Begin button (or Resume
 * if you've already started). After play, show your result and
 * link to the leaderboard.
 *
 * Anon: read-only — show today's challenge + the leaderboard.
 * Sign-in CTA explains the one-attempt-per-day rule.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Challenge {
  formId: string;
  locationId: string;
  seedHash: number;
}

interface YourRun {
  sessionId: string;
  status: string;
  turnCount: number;
  score: number;
  endedAtMs: number | null;
  startedAtMs: number;
}

interface LeaderRow {
  userId: string;
  username: string;
  formId: string;
  locationId: string;
  status: string;
  turnCount: number;
  score: number;
  endedAtMs: number | null;
}

interface HistoryRow {
  utcDate: string;
  formId: string;
  status: string;
  turnCount: number;
  score: number;
}

interface Resp {
  utcDate: string;
  challenge: Challenge;
  yourRun: YourRun | null;
  history: HistoryRow[];
  leaderboard: LeaderRow[];
}

const STATUS_COLOR: Record<string, string> = {
  won: "text-emerald-400",
  capped: "text-amber-400",
  dead: "text-red-400",
  active: "text-stone-300",
};

export default function DailyPage() {
  const router = useRouter();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [me, daily] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/daily"),
    ]);
    if (me.ok) {
      const m = (await me.json()) as { user: unknown };
      setHasAccount(!!m.user);
    }
    if (daily.ok) {
      setData((await daily.json()) as Resp);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function startDaily() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/daily", { method: "POST" });
      const d = (await r.json()) as
        | { ok: true; sessionId: string; resumed: boolean }
        | { error: string };
      if ("ok" in d && d.ok) {
        // Cookie was reissued with the daily sessionId; /play
        // picks it up.
        router.push("/play");
      } else {
        const err = "error" in d ? d.error : "unknown";
        if (err === "login_required") {
          setMsg("sign in to play the daily.");
        } else {
          setMsg(`error: ${err}`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950 font-mono text-stone-500">
        loading…
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950 font-mono text-stone-500">
        no data
      </main>
    );
  }

  const isOver =
    data.yourRun &&
    (data.yourRun.status === "won" ||
      data.yourRun.status === "dead" ||
      data.yourRun.status === "capped");
  const isActive = data.yourRun && data.yourRun.status === "active";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">
            today&apos;s daily{" "}
            <span className="text-xs text-stone-500">{data.utcDate} UTC</span>
          </h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          every player on the same UTC date plays the same form in the
          same place with the same dice. one attempt per day. the
          leaderboard ranks by outcome (won → capped → dead) and then
          by turn count.
        </p>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        <section className="border border-amber-800/60 bg-amber-950/20 p-4 space-y-2">
          <h2 className="text-sm text-stone-100">the prompt for today</h2>
          <div className="text-base">
            <span className="text-stone-300">you wake up as</span>{" "}
            <span className="text-amber-300 font-semibold">
              {data.challenge.formId}
            </span>
            <span className="text-stone-300"> in</span>{" "}
            <span className="text-amber-300 font-semibold">
              {data.challenge.locationId}
            </span>
          </div>
          <p className="text-[10px] text-stone-600">
            seed-hash {data.challenge.seedHash} (everyone gets the same
            dice; the actual seed is hidden so prose isn&apos;t a spoiler)
          </p>

          {!hasAccount && (
            <div className="pt-2">
              <Link
                href="/login"
                className="inline-block text-xs border border-stone-300 text-stone-100 px-4 py-1.5 rounded hover:bg-stone-100 hover:text-stone-950"
              >
                sign in to play
              </Link>
            </div>
          )}

          {hasAccount && !data.yourRun && (
            <div className="pt-2">
              <button
                type="button"
                onClick={startDaily}
                disabled={busy}
                className="text-xs border border-amber-600 text-amber-200 px-4 py-1.5 rounded hover:bg-amber-900 disabled:opacity-50"
              >
                {busy ? "starting…" : "begin today's run"}
              </button>
            </div>
          )}

          {hasAccount && isActive && (
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={startDaily}
                disabled={busy}
                className="text-xs border border-stone-300 text-stone-100 px-4 py-1.5 rounded hover:bg-stone-100 hover:text-stone-950 disabled:opacity-50"
              >
                resume your run
              </button>
              <span className="text-[11px] text-stone-500">
                turn {data.yourRun!.turnCount}, in progress
              </span>
            </div>
          )}

          {hasAccount && isOver && data.yourRun && (
            <div className="pt-2">
              <p className="text-xs">
                <span className="text-stone-400">your result: </span>
                <span className={STATUS_COLOR[data.yourRun.status]}>
                  {data.yourRun.status}
                </span>{" "}
                <span className="text-stone-500">
                  on turn {data.yourRun.turnCount}, score{" "}
                  {data.yourRun.score.toLocaleString()}
                </span>
              </p>
              <p className="text-[10px] text-stone-600 mt-1 italic">
                come back tomorrow for a fresh challenge.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm text-stone-100">
            today&apos;s leaderboard ({data.leaderboard.length})
          </h2>
          {data.leaderboard.length === 0 ? (
            <p className="text-xs text-stone-600 italic">
              nobody has finished yet.
            </p>
          ) : (
            <ul className="border border-stone-800 bg-stone-900/40 divide-y divide-stone-800">
              {data.leaderboard.map((r, i) => (
                <li
                  key={r.userId}
                  className="flex items-baseline gap-3 px-3 py-2 text-sm"
                >
                  <span className="w-6 text-right text-stone-600 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-stone-200 truncate">
                    {r.username}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      STATUS_COLOR[r.status] ?? "text-stone-400"
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-[11px] text-stone-500">
                    t{r.turnCount}
                  </span>
                  <span className="text-stone-300 tabular-nums w-16 text-right">
                    {r.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {hasAccount && data.history.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm text-stone-100">your recent dailies</h2>
            <ul className="border border-stone-800 bg-stone-900/40 divide-y divide-stone-800">
              {data.history.map((h) => (
                <li
                  key={h.utcDate}
                  className="flex items-baseline gap-3 px-3 py-2 text-sm"
                >
                  <span className="w-20 text-stone-500 text-xs">
                    {h.utcDate}
                  </span>
                  <span className="flex-1 text-stone-300">{h.formId}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      STATUS_COLOR[h.status] ?? "text-stone-400"
                    }`}
                  >
                    {h.status}
                  </span>
                  <span className="text-[11px] text-stone-500">
                    t{h.turnCount}
                  </span>
                  <span className="text-stone-400 tabular-nums w-16 text-right">
                    {h.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
