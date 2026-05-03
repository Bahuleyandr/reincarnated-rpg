/**
 * POST /api/turn/stream — Server-Sent Events variant of /api/turn.
 *
 * Same input shape as /api/turn ({ input: string }). The response is
 * a `text/event-stream` body with these event types:
 *
 *   data: {"type":"text","delta":"..."}      // narration text chunk
 *   data: {"type":"done","narration":...,    // turn finished; full state
 *          "projection":...,"roll":...,
 *          "toolEvents":N,"beatsFired":[...],
 *          "narratorFallback":bool?,"narratorFallbackReason":string?}
 *   data: {"type":"error","error":"..."}     // turn failed; closes stream
 *
 * Falls back to the non-streaming path internally if the resolved
 * provider doesn't implement completeStream — the client still gets
 * a `text` event at the end with the whole text + a `done` event.
 *
 * The UI can detect this endpoint via feature query / capability ping;
 * /api/turn remains as the non-stream fallback.
 */
import { NextRequest } from "next/server";

import { getProviderForUser } from "@/lib/ai/factory";
import { db } from "@/lib/db/client";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import {
  loadBeatPack,
  loadForm,
  loadLocation,
} from "@/lib/game/content";
import { runTurn } from "@/lib/game/turn";
import { getCurrentArc, phaseForProgress } from "@/lib/meta/long-wyrm";
import { makeNarrator } from "@/lib/narrator";
import { TemplateNarrator } from "@/lib/narrator/template";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export const runtime = "nodejs";

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return new Response(
      sseLine({ type: "error", error: "no session" }),
      { status: 401, headers: { "content-type": "text/event-stream" } },
    );
  }
  const verified = await verifyCookie(cookie);
  if (!verified || !verified.sessionId) {
    return new Response(
      sseLine({ type: "error", error: "no active session" }),
      { status: 401, headers: { "content-type": "text/event-stream" } },
    );
  }
  const sessionId = verified.sessionId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      sseLine({ type: "error", error: "invalid JSON" }),
      { status: 400, headers: { "content-type": "text/event-stream" } },
    );
  }
  const input =
    typeof (body as { input?: unknown })?.input === "string"
      ? (body as { input: string }).input
      : "";
  if (!input) {
    return new Response(
      sseLine({ type: "error", error: "missing input" }),
      { status: 400, headers: { "content-type": "text/event-stream" } },
    );
  }

  // Bridge: a Web ReadableStream we manually push events into. The
  // turn runs concurrently and pushes via `enqueue`; we close the
  // stream when the turn resolves (or rejects).
  const encoder = new TextEncoder();
  let resolveController: (
    c: ReadableStreamDefaultController<Uint8Array>,
  ) => void = () => undefined;
  const controllerReady = new Promise<
    ReadableStreamDefaultController<Uint8Array>
  >((res) => {
    resolveController = res;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      resolveController(controller);
    },
  });

  // Fire-and-forget: kick off the turn; emit events into the stream.
  void (async () => {
    const controller = await controllerReady;
    const send = (payload: unknown) => {
      try {
        controller.enqueue(encoder.encode(sseLine(payload)));
      } catch {
        // controller may be closed if the client disconnected.
      }
    };
    const close = () => {
      try {
        controller.close();
      } catch {
        // already closed
      }
    };
    try {
      const ctx = await resolveSessionContext(db, sessionId);
      const form = loadForm(ctx.formId);
      const location = loadLocation(ctx.locationId);
      let beatPack: ReturnType<typeof loadBeatPack> | undefined;
      if (ctx.arcId) {
        try {
          beatPack = loadBeatPack(ctx.arcId);
        } catch {
          beatPack = undefined;
        }
      } else if (
        ctx.formId === "lesser-slime" &&
        ctx.locationId === "collapsed-tunnel"
      ) {
        beatPack = loadBeatPack("survive-the-night");
      }
      const resolved = await getProviderForUser(db, verified.userId ?? null, {
        pinnedPresetId: ctx.pinnedPresetId,
        pinnedNarrationModel: ctx.pinnedNarrationModel,
      });
      const presetForTelemetry =
        resolved.source === "env-default" ? null : resolved.source;
      // Pre-fetch meta-arc phase for the system-prompt block.
      let metaArcFlavor:
        | { phase: string; label: string; flavor: string }
        | null = null;
      try {
        const arc = await getCurrentArc(db);
        if (arc) {
          const p = phaseForProgress(arc.progress);
          metaArcFlavor = {
            phase: p.phase,
            label: p.label,
            flavor: p.ambientFlavor,
          };
        }
      } catch (err) {
        log.warn("turn.stream.meta_arc_fetch_failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      const narrator = makeNarrator({
        form,
        location,
        provider: resolved.provider,
        model: resolved.modelOverride ?? undefined,
        db,
        sessionId,
        userId: verified.userId ?? null,
        presetId: presetForTelemetry,
        metaArcFlavor,
      });
      const fallbackNarrator = new TemplateNarrator({ form, location });

      const starterFormState = ctx.starterBonus
        ? { [ctx.starterBonus.field]: ctx.starterBonus.value }
        : undefined;
      const result = await runTurn({
        db,
        sessionId,
        input,
        form,
        location,
        narrator,
        fallbackNarrator,
        beatPack,
        starterFormState,
        world: verified.userId
          ? {
              userId: verified.userId,
              campaignId: ctx.campaignId ?? null,
              formId: ctx.formId,
              locationId: ctx.locationId,
            }
          : undefined,
        llmJudges:
          resolved.useLlmClassifier || resolved.useLlmTone
            ? {
                useClassifier: resolved.useLlmClassifier,
                useTone: resolved.useLlmTone,
                provider: resolved.provider,
                classifierModel:
                  resolved.classifierModelOverride ??
                  resolved.modelOverride ??
                  undefined,
                toneModel:
                  resolved.toneModelOverride ??
                  resolved.modelOverride ??
                  undefined,
                userId: verified.userId ?? null,
                presetId: presetForTelemetry,
              }
            : undefined,
        onNarrationStreamDelta: (delta) => {
          send({ type: "text", delta });
        },
      });

      if (!result.ok) {
        send({
          type: "error",
          error: result.error,
          status: result.projection.status,
        });
        close();
        return;
      }

      const { readLog, rowToEvent } = await import("@/lib/game/events");
      const events = (await readLog(db, sessionId)).map(rowToEvent);
      const lastRoll = [...events]
        .reverse()
        .find((e) => e.kind === "roll.resolved");
      const roll =
        lastRoll && lastRoll.kind === "roll.resolved" ? lastRoll.roll : null;

      send({
        type: "done",
        narration: result.narration,
        projection: result.projection,
        roll,
        toolEvents: result.toolEvents,
        beatsFired: result.beatsFired,
        ...(result.narratorFallback
          ? {
              narratorFallback: true,
              narratorFallbackReason: result.narratorFallbackReason,
            }
          : {}),
      });
      close();
    } catch (err) {
      log.error("turn.stream.failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      send({
        type: "error",
        error: err instanceof Error ? err.message : "internal",
      });
      close();
    }
  })();

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
