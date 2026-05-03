import { NextRequest, NextResponse } from "next/server";

import { getProviderForUser } from "@/lib/ai/factory";
import { db } from "@/lib/db/client";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import {
  loadBeatPack,
  loadForm,
  loadLocation,
} from "@/lib/game/content";
import { runTurn } from "@/lib/game/turn";
import {
  getCurrentArc,
  phaseForProgress,
} from "@/lib/meta/long-wyrm";
import { activeTheme } from "@/lib/world/weekly-theme";
import { makeNarrator } from "@/lib/narrator";
import { TemplateNarrator } from "@/lib/narrator/template";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified || !verified.sessionId) {
    return NextResponse.json(
      { error: "no active session" },
      { status: 401 },
    );
  }
  const sessionId = verified.sessionId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const input =
    typeof (body as { input?: unknown })?.input === "string"
      ? (body as { input: string }).input
      : "";
  if (!input) {
    return NextResponse.json({ error: "missing input" }, { status: 400 });
  }

  try {
    const ctx = await resolveSessionContext(db, sessionId);
    const form = loadForm(ctx.formId);
    const location = loadLocation(ctx.locationId);
    // Beat pack: each campaign was assigned an arc at create time
    // (see arc-routing.ts). Anon sessions and free-form runs hit
    // the legacy slime+tunnel default, then fall through to no arc.
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
    // BYO-LLM: if the player has saved /settings overrides, use their
    // provider + model. The campaign's pinned model wins over current
    // prefs when present, preserving voice continuity across /settings
    // edits. Anon sessions and unconfigured users hit env-default.
    const resolved = await getProviderForUser(db, verified.userId ?? null, {
      pinnedPresetId: ctx.pinnedPresetId,
      pinnedNarrationModel: ctx.pinnedNarrationModel,
    });
    const presetForTelemetry =
      resolved.source === "env-default" ? null : resolved.source;
    // Pre-fetch the current meta-arc phase + active weekly theme so
    // the narrator's system prompt carries both today's wyrm state
    // and this week's mood. One indexed PK lookup; theme is a
    // pure function once the arc is known.
    let metaArcFlavor:
      | { phase: string; label: string; flavor: string }
      | null = null;
    let turnCapOverride: number | undefined;
    try {
      const arc = await getCurrentArc(db);
      if (arc) {
        const p = phaseForProgress(arc.progress);
        const theme = activeTheme(arc);
        // Compose: phase ambient + theme ambient. Both are short.
        metaArcFlavor = {
          phase: p.phase,
          label: p.label,
          flavor: `${p.ambientFlavor} ${theme.ambientFlavor}`,
        };
        if (theme.turnCap !== null) turnCapOverride = theme.turnCap;
      }
    } catch (err) {
      log.warn("turn.meta_arc_fetch_failed", {
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

    // Safety net: deterministic template-narrator that runs offline.
    // If the primary narrator throws (provider 5xx, revoked key,
    // network blip), runTurn routes the turn through this so the
    // session never stalls. The fallback flag is surfaced to /play.
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
      turnCap: turnCapOverride,
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
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, status: result.projection.status },
        { status: 409 },
      );
    }

    // Pull the just-emitted roll.resolved event so the UI can show
    // the dice. Avoids re-running the rules engine on the client.
    const { readLog, rowToEvent } = await import("@/lib/game/events");
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    const lastRoll = [...events]
      .reverse()
      .find((e) => e.kind === "roll.resolved");
    const roll =
      lastRoll && lastRoll.kind === "roll.resolved" ? lastRoll.roll : null;

    return NextResponse.json({
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
  } catch (err) {
    log.error("turn.failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
