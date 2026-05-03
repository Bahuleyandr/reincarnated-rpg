/**
 * Resolve the form / location / reincarnatedAs trio for a session.
 *
 * Resolution order (campaign wins; sessions row fills in for anon):
 *   1. campaign.* — set when the session is attached to a logged-in
 *      user's campaign.
 *   2. sessions.* — anon sessions store form/location/reincarnatedAs
 *      on the session row directly so the open-ended start works
 *      without needing a campaign.
 *   3. DEFAULT_CONTEXT — legacy anon sessions created before the
 *      open-ended fields existed.
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { campaigns, sessions } from "../db/schema";

export interface SessionContext {
  formId: string;
  locationId: string;
  reincarnatedAs: string | null;
}

const DEFAULT_CONTEXT: SessionContext = {
  formId: "lesser-slime",
  locationId: "collapsed-tunnel",
  reincarnatedAs: null,
};

export async function resolveSessionContext(
  db: Db,
  sessionId: string,
): Promise<SessionContext> {
  const rows = await db
    .select({
      sessionFormId: sessions.formId,
      sessionLocationId: sessions.locationId,
      sessionReincarnatedAs: sessions.reincarnatedAs,
      campaignFormId: campaigns.formId,
      campaignLocationId: campaigns.locationId,
      campaignReincarnatedAs: campaigns.reincarnatedAs,
    })
    .from(sessions)
    .leftJoin(campaigns, eq(sessions.campaignId, campaigns.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_CONTEXT;
  return {
    formId:
      row.campaignFormId ?? row.sessionFormId ?? DEFAULT_CONTEXT.formId,
    locationId:
      row.campaignLocationId ??
      row.sessionLocationId ??
      DEFAULT_CONTEXT.locationId,
    reincarnatedAs:
      row.campaignReincarnatedAs ?? row.sessionReincarnatedAs ?? null,
  };
}
