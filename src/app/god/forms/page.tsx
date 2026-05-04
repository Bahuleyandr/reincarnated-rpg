"use client";

/**
 * /god/forms — admin queue for player-authored form submissions.
 *
 * Lists pending submissions; admin can approve (writes
 * content/forms/<slug>.json) or reject with notes. Audit list
 * includes already-decided rows for context.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Submission {
  id: string;
  name: string;
  theme: string;
  status: string;
  authorUserId: string;
  approvedFormId: string | null;
  reviewerNotes: string | null;
  submittedAtMs: number;
  reviewedAtMs: number | null;
}

interface Resp {
  admin: { username: string };
  items: Submission[];
}

export default function GodFormsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<string>("pending_review");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    const r = await fetch(`/api/god/forms?${params.toString()}`);
    if (r.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    // Defer setState calls inside load() to a microtask so React
    // 19's react-hooks/set-state-in-effect rule is satisfied.
    void Promise.resolve().then(() => load());
  }, [load]);

  async function decide(id: string, decision: "approve" | "reject") {
    if (busy) return;
    const notes = notesById[id] ?? "";
    if (decision === "reject" && notes.trim().length === 0) {
      setMsg("rejection notes are required.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/god/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: id,
          decision,
          notes,
        }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && d.ok !== false) {
        setMsg(`${decision}d ${id.slice(0, 8)}…`);
        setNotesById((m) => ({ ...m, [id]: "" }));
        await load();
      } else {
        setMsg(`error: ${d.error ?? r.statusText}`);
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
  if (forbidden) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-950 font-mono text-stone-200">
        <p className="text-red-400">forbidden — admin only.</p>
        <Link href="/god" className="text-xs text-stone-500 underline hover:text-stone-300">
          ← /god
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 px-6 py-10 font-mono text-stone-200">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">
            player form submissions{" "}
            <span className="text-xs text-stone-500">({data?.admin.username})</span>
          </h1>
          <Link href="/god" className="text-xs text-stone-500 underline hover:text-stone-300">
            ← /god
          </Link>
        </header>

        <div className="flex gap-2 text-xs">
          {(["pending_review", "approved", "rejected", ""] as const).map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1 border rounded ${
                filter === s
                  ? "border-stone-300 text-stone-100"
                  : "border-stone-700 text-stone-500 hover:text-stone-300"
              }`}
            >
              {s || "all"}
            </button>
          ))}
        </div>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        {data && data.items.length === 0 ? (
          <p className="text-xs text-stone-600 italic">no submissions in this queue.</p>
        ) : (
          <ul className="space-y-3">
            {data?.items.map((it) => (
              <li
                key={it.id}
                className="border border-stone-800 bg-stone-900/40 px-4 py-3 space-y-2"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-sm text-stone-100 font-semibold">{it.name}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      it.status === "pending_review"
                        ? "text-amber-400"
                        : it.status === "approved"
                          ? "text-emerald-400"
                          : "text-stone-500"
                    }`}
                  >
                    {it.status}
                  </span>
                  <span className="text-[10px] text-stone-600 ml-auto">
                    {new Date(it.submittedAtMs).toLocaleString()}
                  </span>
                </div>

                <div className="text-xs text-stone-400 italic">{it.theme}</div>
                <div className="text-[10px] text-stone-600">
                  author <span className="text-stone-500">{it.authorUserId.slice(0, 8)}…</span>
                  {it.approvedFormId && (
                    <>
                      {" · approved as "}
                      <code className="text-emerald-400">{it.approvedFormId}</code>
                    </>
                  )}
                </div>

                {it.reviewerNotes && (
                  <div className="text-xs text-stone-500 border-l-2 border-stone-700 pl-2">
                    {it.reviewerNotes}
                  </div>
                )}

                {it.status === "pending_review" && (
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="text"
                      value={notesById[it.id] ?? ""}
                      onChange={(e) =>
                        setNotesById((m) => ({ ...m, [it.id]: e.target.value }))
                      }
                      placeholder="reviewer notes (required for reject)"
                      className="flex-1 bg-stone-950 border border-stone-700 px-2 py-1 rounded text-stone-200 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => decide(it.id, "approve")}
                      disabled={busy}
                      className="px-3 py-1 border border-emerald-700 text-emerald-300 rounded hover:bg-emerald-950 text-xs disabled:opacity-50"
                    >
                      approve
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(it.id, "reject")}
                      disabled={busy}
                      className="px-3 py-1 border border-red-700 text-red-300 rounded hover:bg-red-950 text-xs disabled:opacity-50"
                    >
                      reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
