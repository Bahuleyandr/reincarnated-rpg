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
import { loadBeatPack, loadForm, loadLocation } from "@/lib/game/content";
import { runTurn } from "@/lib/game/turn";
import { refundEnergy, trySpend } from "@/lib/energy/state";
import { acquireTurnLock, releaseTurnLock } from "@/lib/game/turn-lock";
import { getCurrentArc, phaseForProgress } from "@/lib/meta/long-wyrm";
import { moderate } from "@/lib/moderation";
import { activeTheme } from "@/lib/world/weekly-theme";
import { makeNarrator } from "@/lib/narrator";
import { TemplateNarrator } from "@/lib/narrator/template";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export const runtime = "nodejs";

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return new Response(sseLine({ type: "error", error: "no session" }), {
      status: 401,
      headers: { "content-type": "text/event-stream" },
    });
  }
  const verified = await verifyCookie(cookie);
  if (!verified || !verified.sessionId) {
    return new Response(sseLine({ type: "error", error: "no active session" }), {
      status: 401,
      headers: { "content-type": "text/event-stream" },
    });
  }
  const sessionId = verified.sessionId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(sseLine({ type: "error", error: "invalid JSON" }), {
      status: 400,
      headers: { "content-type": "text/event-stream" },
    });
  }
  const input =
    typeof (body as { input?: unknown })?.input === "string"
      ? (body as { input: string }).input
      : "";
  if (!input) {
    return new Response(sseLine({ type: "error", error: "missing input" }), {
      status: 400,
      headers: { "content-type": "text/event-stream" },
    });
  }
  // P10: when a preset verb is passed, the orchestrator forces
  // template narrator (cheap, on-form). Free-text inputs omit it
  // and follow env-default narrator (template OR remote/MiniMax).
  const presetVerb =
    typeof (body as { presetVerb?: unknown })?.presetVerb === "string"
      ? (body as { presetVerb: string }).presetVerb
      : null;

  // Moderation gate: must run BEFORE trySpend so injection attempts
  // don't drain energy. See /api/turn/route.ts for the full rationale.
  const moderation = moderate(input);
  if (moderation.verdict === "injection") {
    log.warn("turn.stream.moderation.injection_blocked", {
      sessionId,
      hits: moderation.injectionHits.map((h) => h.pattern),
    });
    return new Response(
      JSON.stringify({
        error: moderation.playerMessage ?? "injection rejected",
        injectionBlocked: true,
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const lock = await acquireTurnLock(db, sessionId);
  if (!lock) {
    const { sessions } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ expiresAt: sessions.turnLockExpiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    const expiresAtMs = rows[0]?.expiresAt?.getTime() ?? null;
    return new Response(
      JSON.stringify({
        error: "turn already in progress",
        turnInFlight: true,
        currentLockExpiresAtMs: expiresAtMs,
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Energy gate: charge 1 energy before opening the stream. Same
  // logic as /api/turn — out-of-energy returns 429 with a normal
  // JSON response (not SSE) so the client's fetch error handler
  // can surface it cleanly.
  const spend = await trySpend(db, {
    userId: verified.userId ?? null,
    sessionId,
  });
  if (!spend.ok) {
    await releaseTurnLock(db, lock);
    return new Response(JSON.stringify({ error: "out of energy", energy: spend.view }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }
  let energySpent = true;
  let turnCommitted = false;

  // Bridge: a Web ReadableStream we manually push events into. The
  // turn runs concurrently and pushes via `enqueue`; we close the
  // stream when the turn resolves (or rejects).
  const encoder = new TextEncoder();
  let resolveController: (c: ReadableStreamDefaultController<Uint8Array>) => void = () => undefined;
  const controllerReady = new Promise<ReadableStreamDefaultController<Uint8Array>>((res) => {
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
      } else if (ctx.formId === "lesser-slime" && ctx.locationId === "collapsed-tunnel") {
        beatPack = loadBeatPack("survive-the-night");
      }
      const resolved = await getProviderForUser(db, verified.userId ?? null, {
        pinnedPresetId: ctx.pinnedPresetId,
        pinnedNarrationModel: ctx.pinnedNarrationModel,
      });
      const presetForTelemetry = resolved.source === "env-default" ? null : resolved.source;
      // Pre-fetch meta-arc phase + active weekly theme.
      let metaArcFlavor: { phase: string; label: string; flavor: string } | null = null;
      let turnCapOverride: number | undefined;
      try {
        const arc = await getCurrentArc(db);
        if (arc) {
          const p = phaseForProgress(arc.progress);
          const theme = activeTheme(arc);
          metaArcFlavor = {
            phase: p.phase,
            label: p.label,
            flavor: `${p.ambientFlavor} ${theme.ambientFlavor}`,
          };
          if (theme.turnCap !== null) turnCapOverride = theme.turnCap;
        }
      } catch (err) {
        log.warn("turn.stream.meta_arc_fetch_failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // Resolve mood preset (Phase 2 Day 11).
      let resolvedMood = "standard";
      try {
        const { resolveMood } = await import("@/lib/narrator/moods");
        const { sessions: sessionsTbl, users: usersTbl } = await import(
          "@/lib/db/schema"
        );
        const { eq: eqOp } = await import("drizzle-orm");
        const sessionRow = (
          await db
            .select({ moodPreset: sessionsTbl.moodPreset })
            .from(sessionsTbl)
            .where(eqOp(sessionsTbl.id, sessionId))
            .limit(1)
        )[0];
        let userMood: string | null = null;
        if (verified.userId) {
          const userRow = (
            await db
              .select({ moodPreset: usersTbl.moodPreset })
              .from(usersTbl)
              .where(eqOp(usersTbl.id, verified.userId))
              .limit(1)
          )[0];
          userMood = userRow?.moodPreset ?? null;
        }
        resolvedMood = resolveMood(sessionRow?.moodPreset ?? null, userMood);
      } catch (err) {
        log.warn("turn.stream.mood.resolve_failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // Phase 7 Day 39: pre-fetch active chapter fragment.
      let chapterFragment: {
        book: number;
        chapter: number;
        title: string;
        fragment: string;
      } | null = null;
      try {
        const { getCalendar } = await import("@/lib/story/calendar");
        const cal = await getCalendar(db);
        if (cal.chapter.narratorPromptFragment) {
          chapterFragment = {
            book: cal.row.currentBook,
            chapter: cal.row.currentChapter,
            title: cal.chapter.title,
            fragment: cal.chapter.narratorPromptFragment,
          };
        }
      } catch (err) {
        log.warn("turn.stream.calendar_fetch_failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      let regionFlavor:
        | {
            locationId: string;
            raceId: string | null;
            raceVoice: string | null;
            subPopulations: string[];
            signatureResources: string[];
          }
        | null = null;
      try {
        const { regionFlavorFor } = await import("@/lib/world/regions");
        regionFlavor = regionFlavorFor(location.id);
      } catch {
        /* race-agnostic */
      }

      // P10 — when the player picked a preset button, force
      // template narrator. Otherwise follow env-default + the
      // user's preset-pinned model (if logged in).
      const narrator = presetVerb
        ? new TemplateNarrator({ form, location })
        : makeNarrator({
            form,
            location,
            provider: resolved.provider,
            model: resolved.modelOverride ?? undefined,
            db,
            sessionId,
            userId: verified.userId ?? null,
            presetId: presetForTelemetry,
            metaArcFlavor,
            moodPreset: resolvedMood,
            chapterFragment,
            regionFlavor,
          });
      const fallbackNarrator = new TemplateNarrator({ form, location });

      const { composeStarterFormState } = await import(
        "@/lib/legacy/compose-starter"
      );
      const starterFormState = await composeStarterFormState(db, {
        starterBonus: ctx.starterBonus,
        userId: verified.userId ?? null,
      });

      // Phase 9 T3.2 follow-up: pre-fetch race for the per-turn
      // race-mod hook. Anon sessions get null.
      let raceId:
        | "human"
        | "elven"
        | "dwarven"
        | "halfling"
        | "orcish"
        | null = null;
      if (verified.userId) {
        try {
          const { users: usersForRace } = await import(
            "@/lib/db/schema"
          );
          const { eq: eqForRace } = await import("drizzle-orm");
          const r = await db
            .select({ race: usersForRace.race })
            .from(usersForRace)
            .where(eqForRace(usersForRace.id, verified.userId))
            .limit(1);
          const v = r[0]?.race;
          if (
            v === "human" ||
            v === "elven" ||
            v === "dwarven" ||
            v === "halfling" ||
            v === "orcish"
          ) {
            raceId = v;
          }
        } catch {
          /* best-effort */
        }
      }

      const result = await runTurn({
        db,
        sessionId,
        input,
        form,
        location,
        narrator,
        fallbackNarrator,
        beatPack,
        turnCap: turnCapOverride,
        starterFormState,
        moderation,
        raceId,
        presetVerb,
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
                  resolved.classifierModelOverride ?? resolved.modelOverride ?? undefined,
                toneModel: resolved.toneModelOverride ?? resolved.modelOverride ?? undefined,
                userId: verified.userId ?? null,
                presetId: presetForTelemetry,
              }
            : undefined,
        onNarrationStreamDelta: (delta) => {
          send({ type: "text", delta });
        },
      });

      if (!result.ok) {
        await refundEnergy(db, {
          userId: verified.userId ?? null,
          sessionId,
        });
        energySpent = false;
        send({
          type: "error",
          error: result.error,
          status: result.projection.status,
        });
        close();
        return;
      }
      turnCommitted = true;

      const { readLog, rowToEvent } = await import("@/lib/game/events");
      const events = (await readLog(db, sessionId)).map(rowToEvent);
      const lastRoll = [...events].reverse().find((e) => e.kind === "roll.resolved");
      const roll = lastRoll && lastRoll.kind === "roll.resolved" ? lastRoll.roll : null;
      // P4: include the running wyrm tally so the play page can
      // refresh its pulse without a separate /api/state fetch.
      const { previewContribution } = await import("@/lib/meta/long-wyrm");
      const wyrmRunning = previewContribution(events);
      // P10: recompute verb-button suggestions for the next turn,
      // based on the post-turn projection. The play page swaps
      // its preset buttons whenever this lands.
      const { suggestVerbs } = await import("@/lib/game/verb-suggestions");
      const firedBeatIds = new Set<string>(
        events
          .filter((e) => e.kind === "quest.objectiveUpdated")
          .map(
            (e) =>
              (e as { kind: "quest.objectiveUpdated"; objective: string })
                .objective,
          ),
      );
      const verbSuggestions = suggestVerbs({
        form,
        projection: result.projection,
        beatPack: beatPack ?? null,
        firedBeatIds,
      });

      send({
        type: "done",
        narration: result.narration,
        projection: result.projection,
        roll,
        toolEvents: result.toolEvents,
        beatsFired: result.beatsFired,
        wyrmRunning: { delta: wyrmRunning.delta, prose: wyrmRunning.prose },
        verbSuggestions,
        ...(result.narratorFallback
          ? {
              narratorFallback: true,
              narratorFallbackReason: result.narratorFallbackReason,
            }
          : {}),
      });
      close();
    } catch (err) {
      if (energySpent && !turnCommitted) {
        try {
          await refundEnergy(db, {
            userId: verified.userId ?? null,
            sessionId,
          });
        } catch (refundErr) {
          log.warn("turn.stream.energy_refund_failed", {
            sessionId,
            err: refundErr instanceof Error ? refundErr.message : String(refundErr),
          });
        }
      }
      log.error("turn.stream.failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      send({
        type: "error",
        error: err instanceof Error ? err.message : "internal",
      });
      close();
    } finally {
      await releaseTurnLock(db, lock);
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
