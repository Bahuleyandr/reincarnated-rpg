import { NextRequest, NextResponse } from "next/server";

import { getProviderForUser } from "@/lib/ai/factory";
import { db } from "@/lib/db/client";
import { refundEnergy, trySpend } from "@/lib/energy/state";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import { loadBeatPack, loadForm, loadLocation } from "@/lib/game/content";
import { runTurn } from "@/lib/game/turn";
import { acquireTurnLock, releaseTurnLock } from "@/lib/game/turn-lock";
import { getCurrentArc, phaseForProgress } from "@/lib/meta/long-wyrm";
import { moderate } from "@/lib/moderation";
import { activeTheme } from "@/lib/world/weekly-theme";
import { makeNarrator } from "@/lib/narrator";
import { TemplateNarrator } from "@/lib/narrator/template";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified || !verified.sessionId) {
    return NextResponse.json({ error: "no active session" }, { status: 401 });
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

  // Moderation gate: cheap, deterministic. Runs BEFORE trySpend so
  // a prompt-injection attempt can't drain the player's energy.
  // - injection → 400, no energy charge.
  // - severe profanity → energy IS charged, runTurn short-circuits
  //   with a refusal narration + bad-luck curse stacked.
  // - mild profanity → energy charged, run continues but with a
  //   smaller bad-luck stack queued for the next few turns.
  const moderation = moderate(input);
  if (moderation.verdict === "injection") {
    log.warn("turn.moderation.injection_blocked", {
      sessionId,
      hits: moderation.injectionHits.map((h) => h.pattern),
    });
    return NextResponse.json(
      {
        error: moderation.playerMessage ?? "injection rejected",
        injectionBlocked: true,
      },
      { status: 400 },
    );
  }

  const lock = await acquireTurnLock(db, sessionId);
  if (!lock) {
    // Look up how long until the existing lock expires, so the UI
    // can show "settling..." with an accurate countdown + auto-retry
    // once it clears.
    const { sessions } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ expiresAt: sessions.turnLockExpiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    const expiresAtMs = rows[0]?.expiresAt?.getTime() ?? null;
    return NextResponse.json(
      {
        error: "turn already in progress",
        turnInFlight: true,
        currentLockExpiresAtMs: expiresAtMs,
      },
      { status: 409 },
    );
  }
  let energySpent = false;
  let turnCommitted = false;
  try {
    // Energy gate: each turn costs 1. If the player is at 0 (after
    // refill), 429 with the post-refill view so the UI can render
    // "next refill in Xm". Logged-in users charge users.energy; anon
    // sessions charge sessions.energy.
    const spend = await trySpend(db, {
      userId: verified.userId ?? null,
      sessionId,
    });
    if (!spend.ok) {
      return NextResponse.json(
        {
          error: "out of energy",
          energy: spend.view,
        },
        { status: 429 },
      );
    }
    energySpent = true;

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
    } else if (ctx.formId === "lesser-slime" && ctx.locationId === "collapsed-tunnel") {
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
    const presetForTelemetry = resolved.source === "env-default" ? null : resolved.source;
    // Pre-fetch the current meta-arc phase + active weekly theme so
    // the narrator's system prompt carries both today's wyrm state
    // and this week's mood. One indexed PK lookup; theme is a
    // pure function once the arc is known.
    let metaArcFlavor: { phase: string; label: string; flavor: string } | null = null;
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
    // Resolve mood preset: per-session override > per-user default >
    // 'standard'. (Phase 2 Day 11.)
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
      log.warn("turn.mood.resolve_failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    // Phase 7 Day 39: pre-fetch the current chapter's narrator
    // fragment so the system prompt picks it up. Cheap PK lookup.
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
      log.warn("turn.calendar_fetch_failed", {
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
      moodPreset: resolvedMood,
      chapterFragment,
    });

    // Safety net: deterministic template-narrator that runs offline.
    // If the primary narrator throws (provider 5xx, revoked key,
    // network blip), runTurn routes the turn through this so the
    // session never stalls. The fallback flag is surfaced to /play.
    const fallbackNarrator = new TemplateNarrator({ form, location });

    // Compose starterFormState from campaign starterBonus + the
    // player's legacy traits (cross-run, persistent). See
    // src/lib/legacy/compose-starter.ts for the merge rule.
    const { composeStarterFormState } = await import(
      "@/lib/legacy/compose-starter"
    );
    const starterFormState = await composeStarterFormState(db, {
      starterBonus: ctx.starterBonus,
      userId: verified.userId ?? null,
    });
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
    });

    if (!result.ok) {
      await refundEnergy(db, {
        userId: verified.userId ?? null,
        sessionId,
      });
      energySpent = false;
      return NextResponse.json(
        { error: result.error, status: result.projection.status },
        { status: 409 },
      );
    }
    turnCommitted = true;

    // Pull the just-emitted roll.resolved event so the UI can show
    // the dice. Avoids re-running the rules engine on the client.
    const { readLog, rowToEvent } = await import("@/lib/game/events");
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    const lastRoll = [...events].reverse().find((e) => e.kind === "roll.resolved");
    const roll = lastRoll && lastRoll.kind === "roll.resolved" ? lastRoll.roll : null;

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
    if (energySpent && !turnCommitted) {
      try {
        await refundEnergy(db, {
          userId: verified.userId ?? null,
          sessionId,
        });
      } catch (refundErr) {
        log.warn("turn.energy_refund_failed", {
          sessionId,
          err: refundErr instanceof Error ? refundErr.message : String(refundErr),
        });
      }
    }
    log.error("turn.failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  } finally {
    await releaseTurnLock(db, lock);
  }
}
