import { randomBytes } from "node:crypto";

import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns, userLlmPrefs } from "@/lib/db/schema";
import {
  AVAILABLE_LOCATIONS,
  pickFormId,
  type LocationId,
} from "@/lib/game/types";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { uuidv7 } from "@/lib/util/uuidv7";

async function requireUser(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const v = await verifyCookie(cookie);
  return v?.userId ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
  return NextResponse.json({ campaigns: rows });
}

/**
 * POST /api/campaigns
 *
 * Body (all optional):
 *   - reincarnatedAs: free-text "a cursed armor", "a cartographer's
 *     ghost". When present, formId is keyword-derived (slime → typed
 *     slime form; everything else → generic-creature). When absent,
 *     formId defaults to lesser-slime.
 *   - formId: explicit form override (typed forms only — slime today).
 *   - locationId: explicit. If absent, picked randomly from
 *     AVAILABLE_LOCATIONS using crypto-strong randomness.
 *   - title: defaults to a derived title from reincarnatedAs.
 */
export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: {
    title?: string;
    formId?: string;
    locationId?: string;
    reincarnatedAs?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const reincarnatedAs = body.reincarnatedAs?.trim() || null;

  // Form: explicit > keyword-derived > slime default.
  const formId = body.formId ?? pickFormId(reincarnatedAs);

  // Location: explicit > random.
  let locationId: LocationId | string;
  if (
    body.locationId &&
    (AVAILABLE_LOCATIONS as readonly string[]).includes(body.locationId)
  ) {
    locationId = body.locationId;
  } else {
    const r = randomBytes(1)[0] % AVAILABLE_LOCATIONS.length;
    locationId = AVAILABLE_LOCATIONS[r];
  }

  // Title: explicit > derived.
  const title =
    (body.title ?? "").trim() ||
    (reincarnatedAs
      ? reincarnatedAs.length > 60
        ? reincarnatedAs.slice(0, 60) + "…"
        : reincarnatedAs
      : "Untitled run");

  // Voice continuity: snapshot the user's CURRENT BYO prefs into the
  // campaign so future turns of this campaign keep the same model
  // even if /settings changes. Null when the user hasn't set BYO
  // prefs (env-default — no point pinning).
  const prefRows = await db
    .select({
      presetId: userLlmPrefs.presetId,
      model: userLlmPrefs.model,
    })
    .from(userLlmPrefs)
    .where(eq(userLlmPrefs.userId, userId))
    .limit(1);
  const pin = prefRows[0]
    ? {
        pinnedPresetId: prefRows[0].presetId,
        pinnedNarrationModel: prefRows[0].model,
      }
    : { pinnedPresetId: null, pinnedNarrationModel: null };

  const id = uuidv7();
  await db.insert(campaigns).values({
    id,
    userId,
    title,
    formId,
    locationId,
    reincarnatedAs,
    ...pin,
  });
  return NextResponse.json({
    campaign: {
      id,
      userId,
      title,
      formId,
      locationId,
      reincarnatedAs,
      status: "active",
      ...pin,
    },
  });
}
