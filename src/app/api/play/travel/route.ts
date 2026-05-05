/**
 * POST /api/play/travel — explicit player-initiated inter-city
 * travel. Bypasses the narrator's travel_to tool and directly
 * appends the events to the session's event log.
 *
 * Body: { toLocationId: string }
 *
 * Behavior:
 *   - Validates the destination is in AVAILABLE_LOCATIONS
 *   - Loads the destination LocationTemplate (404 on miss)
 *   - Resolves the entry room (per-form override OR
 *     entryRoomId)
 *   - Appends time.passed (3) + region.changed events
 *   - Re-loads + writes a fresh projection snapshot
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { appendEvents } from "@/lib/game/events";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import { loadForm, loadLocation } from "@/lib/game/content";
import { pickStartingRoom } from "@/lib/game/arc-routing";
import { loadProjection, writeSnapshot } from "@/lib/game/projection";
import { AVAILABLE_LOCATIONS, type Event } from "@/lib/game/types";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const sessionId = verified.sessionId;

  let body: { toLocationId?: unknown };
  try {
    body = (await req.json()) as { toLocationId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const toLocationId = body.toLocationId;
  if (typeof toLocationId !== "string" || toLocationId.length === 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    !(AVAILABLE_LOCATIONS as readonly string[]).includes(toLocationId)
  ) {
    return NextResponse.json(
      { error: "unknown_location" },
      { status: 400 },
    );
  }

  const ctx = await resolveSessionContext(db, sessionId);
  if (ctx.locationId === toLocationId) {
    return NextResponse.json(
      { error: "already_in_location" },
      { status: 400 },
    );
  }

  // Load destination + resolve entry room.
  let destLoc;
  try {
    destLoc = loadLocation(toLocationId);
  } catch {
    return NextResponse.json({ error: "unknown_location" }, { status: 400 });
  }
  const startRoom =
    pickStartingRoom(ctx.formId, toLocationId) ?? destLoc.entryRoomId;
  const form = loadForm(ctx.formId);

  // Append events: time.passed + region.changed.
  const events: Event[] = [
    { kind: "time.passed", ticks: 3 },
    {
      kind: "region.changed",
      fromLocation: ctx.locationId,
      toLocation: toLocationId,
      toRoom: startRoom,
    },
  ];
  await appendEvents(db, sessionId, events);

  // Refresh projection.
  const proj = await loadProjection(db, sessionId, form, destLoc);
  await writeSnapshot(db, proj);
  log.info("travel.completed", {
    sessionId,
    fromLocation: ctx.locationId,
    toLocation: toLocationId,
    toRoom: startRoom,
  });

  return NextResponse.json({
    ok: true,
    fromLocation: ctx.locationId,
    toLocation: toLocationId,
    toRoom: startRoom,
  });
}
