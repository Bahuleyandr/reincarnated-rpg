"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  id: string;
  text: string;
  displayName: string;
  username: string | null;
  formId: string;
  createdAt: string;
  isSelf?: boolean;
}

interface Props {
  /** The room the player is currently in. When this changes the
   *  chat panel reconnects its SSE stream and refetches. */
  room: { locationId: string; roomId: string | null };
  /** Allow sending. False when the player has no projection yet. */
  canSpeak: boolean;
}

export function ChatPanel({ room, canSpeak }: Props) {
  const roomKey = room.roomId ? `${room.locationId}:${room.roomId}` : null;
  const [messageState, setMessageState] = useState<{
    roomKey: string | null;
    messages: ChatMessage[];
  }>({ roomKey: null, messages: [] });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = messageState.roomKey === roomKey ? messageState.messages : [];

  // Initial load + reconnect on room change.
  useEffect(() => {
    let cancelled = false;
    let abortCtrl: AbortController | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    if (!room.roomId || !roomKey) return;

    async function loadInitial() {
      const r = await fetch("/api/chat/recent");
      if (!r.ok || cancelled) return;
      const d = (await r.json()) as { messages: ChatMessage[] };
      if (!cancelled) setMessageState({ roomKey, messages: d.messages });
    }
    async function streamLoop() {
      while (!cancelled) {
        abortCtrl = new AbortController();
        try {
          const res = await fetch("/api/chat/stream", {
            signal: abortCtrl.signal,
            headers: { accept: "text/event-stream" },
          });
          if (!res.ok || !res.body) break;
          reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled) {
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
                    | { type: "message"; message: ChatMessage }
                    | {
                        type: "hello" | "ping" | "bye";
                        room?: { locationId: string; roomId: string };
                        reason?: string;
                      }
                    | { type: "error"; error: string };
                  if (ev.type === "message") {
                    setMessageState((prev) => {
                      const prevMessages = prev.roomKey === roomKey ? prev.messages : [];
                      // Dedupe in case initial load and stream overlap.
                      if (prevMessages.some((m) => m.id === ev.message.id)) return prev;
                      return {
                        roomKey,
                        messages: [...prevMessages, ev.message].slice(-50),
                      };
                    });
                  } else if (ev.type === "hello" && ev.room) {
                    // If the stream's room doesn't match what we
                    // expected, the player must have moved before
                    // we connected — reload initial state.
                    if (ev.room.locationId !== room.locationId || ev.room.roomId !== room.roomId) {
                      cancelled = true;
                      break;
                    }
                  }
                  // ping + bye + error are handled by reconnect below
                } catch {
                  /* drop */
                }
              }
            }
          }
        } catch {
          /* abort or network — fall through to reconnect after 1s */
        }
        if (!cancelled) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    void loadInitial();
    void streamLoop();
    return () => {
      cancelled = true;
      try {
        abortCtrl?.abort();
      } catch {
        /* ignore */
      }
      try {
        reader?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [room.locationId, room.roomId, roomKey]);

  // Auto-scroll to bottom on new message when panel is open.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/chat/say", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `failed (${r.status})`);
        setBusy(false);
        return;
      }
      // Optimistic — the SSE stream will deliver the canonical row.
      setText("");
      setBusy(false);
    } catch (e) {
      setError(`network: ${e instanceof Error ? e.message : "?"}`);
      setBusy(false);
    }
  }

  if (!room.roomId) return null;

  const charsLeft = 280 - text.length;

  return (
    <section className="border-t border-stone-800 bg-stone-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-stone-900"
      >
        <span className="text-xs text-stone-100">
          chat{" "}
          <span className="text-stone-500">
            ({messages.length}
            {messages.length === 50 ? "+" : ""})
          </span>
        </span>
        <span className="text-[10px] text-stone-600">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="border-t border-stone-800">
          <div ref={scrollRef} className="max-h-64 space-y-1 overflow-y-auto px-4 py-2 text-xs">
            {messages.length === 0 ? (
              <p className="text-[11px] text-stone-600 italic">
                no one has spoken in this room recently.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`leading-5 ${m.isSelf ? "opacity-80" : ""}`}>
                  <span className="mr-2 text-[10px] text-stone-400">
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span
                    className={`mr-2 text-[11px] ${m.isSelf ? "text-amber-300" : "text-stone-300"}`}
                  >
                    {m.username ? `@${m.username}` : m.displayName}
                  </span>
                  <span className="text-stone-200">{m.text}</span>
                </div>
              ))
            )}
          </div>
          {canSpeak && (
            <form onSubmit={send} className="flex items-center gap-2 border-t border-stone-800 p-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 280))}
                placeholder="say something… (visible to anyone in this room)"
                className="flex-1 border border-stone-700 bg-stone-950 px-3 py-1.5 text-xs text-stone-100 focus:border-stone-500 focus:outline-none"
                disabled={busy}
              />
              <span
                className={`w-8 text-right text-[10px] ${
                  charsLeft < 30 ? "text-amber-400" : "text-stone-600"
                }`}
              >
                {charsLeft}
              </span>
              <button
                type="submit"
                disabled={busy || !text.trim()}
                className="border border-stone-300 px-3 py-1 text-xs text-stone-100 transition-colors hover:bg-stone-100 hover:text-stone-950 disabled:opacity-50"
              >
                say
              </button>
            </form>
          )}
          {error && (
            <p className="border-t border-stone-800 px-3 py-1 text-[11px] text-red-400">{error}</p>
          )}
          <p className="border-t border-stone-900 px-3 py-1.5 text-[10px] text-stone-700">
            chat is OOC — your in-game form does NOT see these messages. visible only to players
            physically in this room.
          </p>
        </div>
      )}
    </section>
  );
}
