"use client";

/**
 * LocationNotes — Phase 5.5 Day 32-33.
 *
 * Small panel showing top-3 player notes pinned to the player's
 * current location. Logged-in players can vote ↑ on each note and
 * leave their own (1 energy cost, 160-char cap, 5 active per user).
 */
import { useCallback, useEffect, useState } from "react";

interface NoteRow {
  id: string;
  text: string;
  votes: number;
  authorUserId: string | null;
  formId: string | null;
  createdAtMs: number;
}

interface Props {
  locationId: string;
  formId: string;
  /** When false, hides the leave-note form (anon sessions). */
  canLeave: boolean;
}

const MAX_LEN = 160;

export function LocationNotes({ locationId, formId, canLeave }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/locations/${locationId}/notes?formId=${encodeURIComponent(formId)}&limit=3`,
      );
      if (!r.ok) return;
      const d = (await r.json()) as { notes: NoteRow[] };
      setNotes(d.notes);
    } catch {
      /* ignore */
    }
  }, [locationId, formId]);

  useEffect(() => {
    // Defer setState calls inside load() to a microtask so React
    // 19's react-hooks/set-state-in-effect rule is satisfied.
    void Promise.resolve().then(() => load());
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/locations/${locationId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, formId }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? `submit failed (${r.status})`);
        return;
      }
      setText("");
      setShowForm(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function vote(noteId: string) {
    if (votedIds.has(noteId)) return;
    setVotedIds((s) => new Set([...s, noteId]));
    try {
      await fetch(`/api/locations/${locationId}/notes/${noteId}/vote`, {
        method: "POST",
      });
      await load();
    } catch {
      /* ignore */
    }
  }

  if (notes.length === 0 && !canLeave) return null;

  return (
    <section className="px-4 py-3 border-b border-stone-800 bg-stone-900/40 space-y-2 text-xs">
      <header className="flex items-center justify-between">
        <h4 className="text-[10px] tracking-wider text-stone-400 uppercase">
          notes here
        </h4>
        {canLeave && (
          <button
            type="button"
            className="text-[10px] text-stone-500 hover:text-stone-300 underline underline-offset-2"
            onClick={() => setShowForm((s) => !s)}
          >
            {showForm ? "cancel" : "leave one"}
          </button>
        )}
      </header>
      {notes.length === 0 ? (
        <p className="text-stone-600 italic">silence.</p>
      ) : (
        <ul className="space-y-1">
          {notes.map((n) => {
            const voted = votedIds.has(n.id);
            return (
              <li key={n.id} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => vote(n.id)}
                  disabled={voted || !canLeave}
                  className={`text-[10px] tabular-nums ${
                    voted
                      ? "text-amber-300"
                      : "text-stone-600 hover:text-stone-300"
                  } ${!canLeave ? "cursor-default" : ""}`}
                  title={canLeave ? "agree" : "log in to vote"}
                  aria-label={`agree (${n.votes} so far)`}
                >
                  ▲ {n.votes + (voted ? 1 : 0)}
                </button>
                <span className="text-stone-300 leading-5">{n.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {showForm && canLeave && (
        <form onSubmit={submit} className="space-y-1 pt-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            rows={2}
            disabled={busy}
            placeholder="leave a note for the next traveler"
            className="w-full bg-stone-950 border border-stone-800 px-2 py-1 text-xs text-stone-200 placeholder-stone-700 focus:outline-none focus:border-stone-600"
          />
          <div className="flex items-center justify-between text-[10px] text-stone-600">
            <span className="tabular-nums">
              {text.length}/{MAX_LEN} · costs 1 ⚡
            </span>
            <button
              type="submit"
              disabled={busy || text.trim().length === 0}
              className="text-stone-300 hover:text-stone-100 underline underline-offset-2 disabled:opacity-50"
            >
              pin it
            </button>
          </div>
          {err && <p className="text-red-400 text-[10px]">{err.replace(/_/g, " ")}</p>}
        </form>
      )}
    </section>
  );
}
