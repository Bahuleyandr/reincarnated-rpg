/**
 * Live presence — who else is currently in your room.
 *
 * Sessions get a `lastActiveAt` timestamp that the /play page bumps
 * every ~30s via /api/presence/heartbeat. The /api/presence/nearby
 * endpoint reads this column joined against projections to find PCs
 * (player characters — reincarnated humans) sharing a room.
 *
 * Liveness threshold: a session is "live" if lastActiveAt is within
 * the last 90 seconds (3 missed heartbeats). Beyond that, the
 * session is considered dormant and is not surfaced to anyone.
 *
 * NPCs are NOT in this list — they are content-template instances
 * carried in projection.npcs and surfaced separately by the UI.
 * The "PC vs NPC distinction" the user asked for is structural:
 *   - PCs have a sessions row + projection + are reincarnated humans
 *   - NPCs have entity rows or live in projection.npcs as templated
 *     content; they don't have heartbeats
 */
import { and, eq, gte, ne, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { campaigns, projections, sessions, users } from "../db/schema";

const LIVENESS_WINDOW_MS = 90_000;

/** Bump heartbeat for a session. Idempotent. */
export async function heartbeat(
  db: Db,
  sessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export interface NearbyPlayer {
  /** Stable per-session id; tells the UI when the same player moves. */
  sessionId: string;
  /** Username for logged-in players, or null for anon (UI shows
   *  "a wandering candle" or similar from displayName). */
  username: string | null;
  /** Reincarnation declaration / form label, for display. */
  displayName: string;
  /** formId so UI can show a small icon / typed-form badge. */
  formId: string;
  /** Whether this is the requesting session itself (UI grays out). */
  isSelf: boolean;
}

/**
 * Returns PCs currently in `roomId` of `locationId`. Excludes the
 * caller's own session unless `includeSelf=true`.
 */
export async function nearbyInRoom(
  db: Db,
  locationId: string,
  roomId: string,
  selfSessionId: string,
  includeSelf = false,
): Promise<NearbyPlayer[]> {
  const cutoff = new Date(Date.now() - LIVENESS_WINDOW_MS);

  // Join sessions × projections × campaigns × users.
  // Filter:
  //   - sessions.lastActiveAt >= cutoff
  //   - sessions.status = 'active'
  //   - projection.state->>'location'->>'roomId' = roomId
  //   - (campaign.locationId = locationId) OR (sessions.locationId = locationId for anon)
  // The roomId match is the key one because rooms are unique within a
  // location in our content model.
  const rows = await db
    .select({
      sessionId: sessions.id,
      username: users.username,
      sessionFormId: sessions.formId,
      sessionReincarnatedAs: sessions.reincarnatedAs,
      sessionLocationId: sessions.locationId,
      campaignFormId: campaigns.formId,
      campaignReincarnatedAs: campaigns.reincarnatedAs,
      campaignLocationId: campaigns.locationId,
      projectionState: projections.state,
    })
    .from(sessions)
    .leftJoin(campaigns, eq(sessions.campaignId, campaigns.id))
    .leftJoin(users, eq(campaigns.userId, users.id))
    .leftJoin(projections, eq(projections.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.status, "active"),
        gte(sessions.lastActiveAt, cutoff),
        ...(includeSelf ? [] : [ne(sessions.id, selfSessionId)]),
        // Effective location: campaign overrides session for logged-in.
        sql`COALESCE(${campaigns.locationId}, ${sessions.locationId}) = ${locationId}`,
        // roomId out of projection state. NULL projection = ignore
        // (player hasn't taken a turn yet — they're still in /reincarnate
        // or the limbo right after session create).
        sql`${projections.state}->'location'->>'roomId' = ${roomId}`,
      ),
    );

  return rows.map((r) => {
    const formId = r.campaignFormId ?? r.sessionFormId ?? "generic-creature";
    const declared = r.campaignReincarnatedAs ?? r.sessionReincarnatedAs;
    const displayName = declared ?? humaniseFormId(formId);
    return {
      sessionId: r.sessionId,
      username: r.username ?? null,
      displayName,
      formId,
      isSelf: r.sessionId === selfSessionId,
    };
  });
}

function humaniseFormId(formId: string): string {
  switch (formId) {
    case "lesser-slime":
      return "a lesser slime";
    case "cursed-book":
      return "a cursed book";
    case "dragon-egg":
      return "a dragon egg";
    case "dungeon-core":
      return "a dungeon core";
    case "generic-creature":
    default:
      return "a reincarnated thing";
  }
}
