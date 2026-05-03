/**
 * GET /api/chat/stream — Server-Sent Events stream of new chat
 * messages in the caller's current room.
 *
 * Connection lifecycle:
 *   1. Client connects, server resolves their current (locationId,
 *      roomId) from projection.
 *   2. Server sends an initial `data: {type:"hello",room}` event.
 *   3. Server polls the DB every 2s for new rows in this room
 *      created after the last cursor; emits them as
 *      `data: {type:"message", ...}` events.
 *   4. Server emits a `data: {type:"ping"}` heartbeat every 25s
 *      so intermediate proxies don't kill the connection.
 *   5. If the player's room changes (movement), the client
 *      detects the mismatch in its onmessage handler and
 *      reconnects.
 *
 * 2s poll is "real-time enough" for chat. A future Postgres
 * LISTEN/NOTIFY upgrade can drop the latency to ms; the wire
 * format here is already the upgrade path.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { messagesSince } from "@/lib/chat/store";
import { db } from "@/lib/db/client";
import { projections } from "@/lib/db/schema";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export const runtime = "nodejs";

const POLL_INTERVAL_MS = 2_000;
const PING_INTERVAL_MS = 25_000;
const MAX_STREAM_MS = 5 * 60 * 1000; // refresh every 5min so connections don't pile up

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return new Response(
      sseLine({ type: "error", error: "no session" }),
      { status: 401, headers: { "content-type": "text/event-stream" } },
    );
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId) {
    return new Response(
      sseLine({ type: "error", error: "no session" }),
      { status: 401, headers: { "content-type": "text/event-stream" } },
    );
  }
  const sessionId = verified.sessionId;

  const ctx = await resolveSessionContext(db, sessionId);
  const [snap] = await db
    .select({ state: projections.state })
    .from(projections)
    .where(eq(projections.sessionId, sessionId))
    .limit(1);
  const state = snap?.state as
    | { location?: { id?: string; roomId?: string } }
    | undefined;
  const roomId = state?.location?.roomId;
  const locationId = state?.location?.id ?? ctx.locationId;
  if (!roomId) {
    return new Response(
      sseLine({ type: "error", error: "no room" }),
      { status: 404, headers: { "content-type": "text/event-stream" } },
    );
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = new Date();
      let lastPing = Date.now();
      let stopped = false;

      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseLine(payload)));
        } catch {
          stopped = true;
        }
      };

      send({ type: "hello", room: { locationId, roomId } });

      while (!stopped && Date.now() - startedAt < MAX_STREAM_MS) {
        try {
          const fresh = await messagesSince(db, locationId, roomId, cursor);
          for (const m of fresh) {
            send({
              type: "message",
              message: {
                id: m.id,
                text: m.text,
                displayName: m.displayName,
                username: m.username,
                formId: m.formId,
                createdAt: m.createdAt,
                isSelf: m.sessionId === sessionId,
              },
            });
            if (m.createdAt > cursor) cursor = m.createdAt;
          }
          if (Date.now() - lastPing > PING_INTERVAL_MS) {
            send({ type: "ping" });
            lastPing = Date.now();
          }
        } catch (err) {
          log.warn("chat.stream.poll_failed", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      send({ type: "bye", reason: "max_duration" });
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
