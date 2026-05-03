/**
 * Admin energy controls.
 *
 * GET  /api/god/energy?username=alice
 *      Returns the current energy view for the named user.
 *
 * POST /api/god/energy
 *      Body: { username, tier?, refillToMax?, setEnergy? }
 *      Promote/demote tier, refill to max, or set a specific value.
 *      Username (not user id) for ergonomic admin UX.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { adminSetEnergy, getEnergyView } from "@/lib/energy/state";
import { TIERS, turnsPerDay } from "@/lib/energy/tiers";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const username = (url.searchParams.get("username") ?? "").trim();
  if (!username) {
    return NextResponse.json(
      {
        // Catalog only — empty username returns the tier table for the UI dropdown.
        tiers: Object.values(TIERS).map((t) => ({
          id: t.id,
          label: t.label,
          max: t.max,
          regenIntervalMs: t.regenIntervalMs,
          description: t.description,
          turnsPerDay: turnsPerDay(t),
        })),
      },
    );
  }
  const u = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (u.length === 0) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const view = await getEnergyView(db, { userId: u[0].id });
  return NextResponse.json({
    user: { id: u[0].id, username: u[0].username },
    energy: view
      ? {
          energy: view.energy,
          max: view.tier.max,
          tierId: view.tier.id,
          tierLabel: view.tier.label,
          turnsPerDay: turnsPerDay(view.tier),
          nextRegenMs: view.nextRegenMs,
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    username?: string;
    tier?: string;
    refillToMax?: boolean;
    setEnergy?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const username = (body.username ?? "").trim();
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 });
  }
  if (body.tier && !TIERS[body.tier]) {
    return NextResponse.json(
      { error: `unknown tier: ${body.tier}` },
      { status: 400 },
    );
  }
  const u = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (u.length === 0) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const view = await adminSetEnergy(db, u[0].id, {
    tier: body.tier,
    refillToMax: body.refillToMax,
    setEnergy: body.setEnergy,
  });
  return NextResponse.json({
    ok: true,
    energy: view
      ? {
          energy: view.energy,
          max: view.tier.max,
          tierId: view.tier.id,
          tierLabel: view.tier.label,
          turnsPerDay: turnsPerDay(view.tier),
        }
      : null,
  });
}
