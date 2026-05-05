"use client";

/**
 * /letters — inbox + sent + compose. Logged-in only.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Letter {
  id: string;
  fromUserId: string;
  fromUsername: string | null;
  subject: string;
  bodyPreview: string;
  status: string;
  sentAtMs: number;
  readAtMs: number | null;
  voiceMode: string;
}

type Folder = "inbox" | "sent" | "compose";

export default function LettersPage() {
  const [folder, setFolder] = useState<Folder>("inbox");
  const [letters, setLetters] = useState<Letter[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<{
    id: string;
    subject: string;
    body: string;
  } | null>(null);
  // Compose form
  const [toUsername, setToUsername] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (folder === "compose") {
      setLoaded(true);
      return;
    }
    const r = await fetch(`/api/letters?folder=${folder}`);
    if (r.ok) {
      const d = (await r.json()) as {
        letters: Letter[];
        unread?: number;
      };
      setLetters(d.letters);
      if (typeof d.unread === "number") setUnread(d.unread);
    }
    setLoaded(true);
  }, [folder]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function openLetter(id: string) {
    const r = await fetch(`/api/letters/${id}`);
    if (r.ok) {
      const d = (await r.json()) as { subject: string; body: string };
      setOpen({ id, ...d });
      // Refresh inbox so the read state updates.
      if (folder === "inbox") await load();
    }
  }

  async function sendCompose(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toUsername: toUsername.trim(),
          subject: subject.trim(),
          body: bodyText,
        }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && d.ok) {
        setMsg("sent.");
        setSubject("");
        setBodyText("");
      } else {
        setMsg(`error: ${d.error ?? r.statusText}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (active: boolean) =>
    active
      ? "px-3 py-1 text-stone-100 border-b border-stone-300"
      : "px-3 py-1 text-stone-500 hover:text-stone-300";

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-950 font-mono text-stone-500">
        loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-200 font-mono px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl text-stone-100">
            letters{" "}
            {unread > 0 && folder === "inbox" && (
              <span className="text-[10px] text-amber-400 font-normal">
                {unread} unread
              </span>
            )}
          </h1>
          <Link
            href="/"
            className="text-xs text-stone-500 hover:text-stone-300 underline underline-offset-2"
          >
            ← home
          </Link>
        </header>

        <p className="text-xs text-stone-500 leading-relaxed">
          slow-mail to other players. address by username; subject and
          body are arbitrary text. pick a voice — the world&apos;s
          tone-checker may rewrite an angry letter into a calmer
          version, depending on your last form&apos;s mood. there is no
          delete: a sent letter sits in the recipient&apos;s inbox until
          they read it.
        </p>

        <nav className="flex gap-1 border-b border-stone-800">
          <button
            type="button"
            className={tabClass(folder === "inbox")}
            onClick={() => setFolder("inbox")}
          >
            inbox{unread > 0 ? ` (${unread})` : ""}
          </button>
          <button
            type="button"
            className={tabClass(folder === "sent")}
            onClick={() => setFolder("sent")}
          >
            sent
          </button>
          <button
            type="button"
            className={tabClass(folder === "compose")}
            onClick={() => setFolder("compose")}
          >
            compose
          </button>
        </nav>

        {msg && (
          <div className="text-xs text-stone-300 bg-stone-900 border border-stone-700 px-3 py-2 rounded">
            {msg}
          </div>
        )}

        {folder !== "compose" && (
          <ul className="space-y-1">
            {letters.length === 0 && (
              <li className="text-xs text-stone-600 italic">
                no letters in this folder.
              </li>
            )}
            {letters.map((l) => (
              <li
                key={l.id}
                className={`border ${
                  l.status === "delivered"
                    ? "border-amber-700/60"
                    : "border-stone-800"
                } px-3 py-2 cursor-pointer hover:bg-stone-900/60`}
                onClick={() => openLetter(l.id)}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-stone-200 truncate flex-1">
                    {l.subject}
                  </span>
                  <span className="text-[10px] text-stone-500">
                    {l.fromUsername ?? "you"}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      l.status === "delivered"
                        ? "text-amber-400"
                        : "text-stone-500"
                    }`}
                  >
                    {l.status}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 italic mt-1 truncate">
                  {l.bodyPreview}
                </p>
              </li>
            ))}
          </ul>
        )}

        {folder === "compose" && (
          <form onSubmit={sendCompose} className="space-y-3">
            <div>
              <label htmlFor="to" className="block text-xs text-stone-400 mb-1">
                to (username)
              </label>
              <input
                id="to"
                required
                type="text"
                value={toUsername}
                onChange={(e) => setToUsername(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 px-3 py-2 rounded text-stone-200 text-sm"
              />
            </div>
            <div>
              <label htmlFor="subj" className="block text-xs text-stone-400 mb-1">
                subject (≤280 chars)
              </label>
              <input
                id="subj"
                required
                type="text"
                maxLength={280}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 px-3 py-2 rounded text-stone-200 text-sm"
              />
            </div>
            <div>
              <label htmlFor="body" className="block text-xs text-stone-400 mb-1">
                body (≤4000 chars)
              </label>
              <textarea
                id="body"
                required
                rows={10}
                maxLength={4000}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 px-3 py-2 rounded text-stone-200 text-sm font-mono"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-stone-200 disabled:opacity-50"
              >
                {busy ? "sending…" : "send"}
              </button>
            </div>
          </form>
        )}

        {open && (
          <section className="border border-stone-700 bg-stone-900/60 p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm text-stone-100">{open.subject}</h2>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="text-xs text-stone-500 hover:text-stone-300"
              >
                close
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-stone-300 font-mono leading-6">
              {open.body}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
