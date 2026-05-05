import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { arcTagline } from "@/lib/game/arc-routing";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import { loadBeatPack, loadForm, loadLocation } from "@/lib/game/content";
import { resolveFirstGoal } from "@/lib/game/goals";
import { previewContribution } from "@/lib/meta/long-wyrm";
import { readLog, rowToEvent } from "@/lib/game/events";
import { loadProjection } from "@/lib/game/projection";
import { suggestVerbs } from "@/lib/game/verb-suggestions";
import type { BeatPack } from "@/lib/game/beats";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function GET(req: NextRequest) {
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

  try {
    const ctx = await resolveSessionContext(db, sessionId);
    const form = loadForm(ctx.formId);
    const location = loadLocation(ctx.locationId);
    const starterFormState = ctx.starterBonus
      ? { [ctx.starterBonus.field]: ctx.starterBonus.value }
      : undefined;
    const projection = await loadProjection(db, sessionId, form, location, {
      reincarnatedAs: ctx.reincarnatedAs,
      starterFormState,
    });

    const events = await readLog(db, sessionId);
    const eventList = events.map(rowToEvent);
    const narrations = eventList
      .filter((e) => e.kind === "narration.emitted")
      .map((e) => (e as { kind: "narration.emitted"; text: string }).text);
    // P4: per-turn wyrm tally — what the player's actions so far in
    // this session would contribute to the Long Wyrm if the run
    // ended right now (excluding the outcome bonus, which only
    // fires at session.ended).
    const wyrmRunning = previewContribution(eventList);

    // P9: verb-button suggestions. Source priority is beat → form's
    // iconicVerbs → form.verbs[]; the helper handles the fallthrough.
    let beatPack: BeatPack | null = null;
    if (ctx.arcId) {
      try {
        beatPack = loadBeatPack(ctx.arcId);
      } catch {
        // Arc has no beat file (read-the-room is form-agnostic but
        // also has a pack; this branch handles invented arc ids).
      }
    }
    const firedBeatIds = new Set<string>(
      eventList
        .filter((e) => e.kind === "quest.objectiveUpdated")
        .map((e) => (e as { kind: "quest.objectiveUpdated"; objective: string }).objective),
    );
    const verbSuggestions = suggestVerbs({
      form,
      projection,
      beatPack,
      firedBeatIds,
    });

    // Phase 5.5 Day 36-37: surface tutorial flag so the UI can
    // render TutorialHint without a separate fetch.
    const { sessions: sessTbl } = await import("@/lib/db/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    const [sessionRow] = await db
      .select({ isTutorial: sessTbl.isTutorial })
      .from(sessTbl)
      .where(eqOp(sessTbl.id, sessionId))
      .limit(1);
    const isTutorial = !!sessionRow?.isTutorial;
    return NextResponse.json({
      sessionId,
      projection,
      narrations,
      // For the recap "save this run" link — only show if anon.
      hasAccount: !!verified.userId,
      // For the epitaph form (Phase 5.5 Day 30) — null on anon
      // sessions that haven't claimed a campaign yet.
      campaignId: ctx.campaignId ?? null,
      reincarnatedAs: ctx.reincarnatedAs,
      formId: ctx.formId,
      locationId: ctx.locationId,
      arcId: ctx.arcId,
      arcTagline: arcTagline(ctx.arcId),
      isTutorial,
      // Phase 10 P2: form-specific opening + first goal — surfaced
      // here so the play page can render them without a second
      // fetch. Both are optional; older forms without the data
      // simply get a generic hint.
      formOpening: form.opening ?? null,
      formDisplayName: form.displayName ?? ctx.formId,
      firstGoal: resolveFirstGoal(form, projection),
      // Phase 10 P4: running wyrm tally for this session. Plays back
      // through the play-page wyrm pulse so the player sees their
      // contribution accumulate. Outcome bonus excluded.
      wyrmRunning: {
        delta: wyrmRunning.delta,
        prose: wyrmRunning.prose,
      },
      // Phase 11 P9: 3 verb-button suggestions — author-curated when
      // a beat is firing, form-iconic otherwise. The play page
      // renders these as preset buttons + an escape-hatch text box.
      verbSuggestions,
    });
  } catch (err) {
    log.error("state.failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
