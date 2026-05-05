"use client";

/**
 * /party — open-parties lobby. Logged-in users can:
 *   - See open parties + join one
 *   - Create a new party from their current session
 *   - Start a party once 2+ members have joined (host only)
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface OpenParty {
  id: string;
  hostUsername: string | null;
  memberCount: number;
  maxSize: number;
  createdAtMs: number;
}

export default function PartyLobbyPage() {
  const [list, setList] = useState<OpenParty[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [createMaxSize, setCreateMaxSize] = useState(3);

  const load = useCallback(async () => {
    const r = await fetch("/api/party");
    if (r.ok) {
      const d = (await r.json()) as { parties: OpenParty[] };
      setList(d.parties);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  async function act(
    action: "create" | "join" | "leave" | "start",
    partyId?: string,
  ) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      // For "create" we need a sessionId — pull from /api/state.
      let sessionId: string | undefined;
      if (action === "create") {
        const sr = await fetch("/api/state");
        if (sr.ok) {
          const sd = (await sr.json()) as { sessionId?: string };
          sessionId = sd.sessionId;
        }
        if (!sessionId) {
          setMsg("start a session first (open /play).");
          return;
        }
      }
      const r = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          partyId,
          sessionId,
          maxSize: action === "create" ? createMaxSize : undefined,
        }),
      });
      const d = (await r.json()) as
        | { ok: true; partyId?: string }
        | { ok: false; error: string }
        | { error: string };
      if (("ok" in d && d.ok) || (!("ok" in d) && r.ok)) {
        setMsg(`${action} ok`);
        await load();
      } else if ("error" in d) {
        setMsg(`error: ${d.error}`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <main className="min-h-screen bg-stone-950 text-stone-500 font-mono flex items-center justify-center">
        loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">parties</h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          co-play in a shared session. 2-3 players take turns
          round-robin. host&apos;s session is the canonical one.
          turn-lock is server-enforced — only the current player
          may submit input.
        </p>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        <section className="border border-stone-800 bg-stone-900/40 px-4 py-3 space-y-2">
          <h2 className="text-sm text-stone-100">create a party</h2>
          <p className="text-[10px] text-stone-500">
            uses your active session as the canonical one. start
            a session at <code>/play</code> first.
          </p>
          <div className="flex items-center gap-2">
            <label className="text-xs text-stone-400">
              max size
              <select
                value={createMaxSize}
                onChange={(e) => setCreateMaxSize(Number(e.target.value))}
                className="ml-2 bg-stone-900 border border-stone-700 px-2 py-1 rounded text-stone-200"
              >
                <option value={2}>2 players</option>
                <option value={3}>3 players</option>
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("create")}
              className="text-xs px-3 py-1 border border-amber-700 text-amber-300 rounded hover:bg-amber-950 disabled:opacity-50"
            >
              {busy ? "…" : "create"}
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm text-stone-100">
            open parties ({list.length})
          </h2>
          {list.length === 0 ? (
            <p className="text-xs text-stone-600 italic">
              no open parties. be the first to create one.
            </p>
          ) : (
            <ul className="space-y-1">
              {list.map((p) => (
                <li
                  key={p.id}
                  className="border border-stone-800 px-3 py-2 flex items-baseline gap-3"
                >
                  <span className="text-xs text-stone-200">
                    {p.hostUsername ?? "(host)"}
                  </span>
                  <span className="text-[10px] text-stone-500">
                    {p.memberCount}/{p.maxSize}
                  </span>
                  <span className="text-[10px] text-stone-600 ml-auto">
                    {new Date(p.createdAtMs).toLocaleTimeString()}
                  </span>
                  <button
                    type="button"
                    disabled={busy || p.memberCount >= p.maxSize}
                    onClick={() => act("join", p.id)}
                    className="text-[10px] px-2 py-0.5 border border-stone-700 rounded text-stone-300 hover:bg-stone-800 disabled:opacity-50"
                  >
                    join
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act("start", p.id)}
                    className="text-[10px] px-2 py-0.5 border border-amber-700 text-amber-300 rounded hover:bg-amber-950 disabled:opacity-50"
                    title="host-only; enabled when ≥2 members"
                  >
                    start (host)
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
