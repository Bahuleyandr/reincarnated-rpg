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
    // Beat pack: only the typed slime quest exists today; for any
    // other form/location combo we run without scripted milestones
    // and let the narrator drive the story directly.
    const beatPack =
      ctx.formId === "lesser-slime" && ctx.locationId === "collapsed-tunnel"
        ? loadBeatPack("survive-the-night")
        : undefined;
    // BYO-LLM: if the player has saved /settings overrides, use their
    // provider + model. Anonymous sessions and users without prefs
    // fall back to the env-default provider.
    const resolved = await getProviderForUser(db, verified.userId ?? null);
    const narrator = makeNarrator({
      form,
      location,
      provider: resolved.provider,
      model: resolved.modelOverride ?? undefined,
      db,
      sessionId,
      userId: verified.userId ?? null,
      presetId: resolved.source === "env-default" ? null : resolved.source,
    });

    // Safety net: deterministic template-narrator that runs offline.
    // If the primary narrator throws (provider 5xx, revoked key,
    // network blip), runTurn routes the turn through this so the
    // session never stalls. The fallback flag is surfaced to /play.
    const fallbackNarrator = new TemplateNarrator({ form, location });
    const result = await runTurn({
      db,
      sessionId,
      input,
      form,
      location,
      narrator,
      fallbackNarrator,
      beatPack,
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
