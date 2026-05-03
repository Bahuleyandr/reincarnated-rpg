import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns } from "@/lib/db/schema";
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

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: { title?: string; formId?: string; locationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const title = (body.title ?? "").trim() || "Untitled run";
  const formId = body.formId ?? "lesser-slime";
  const locationId = body.locationId ?? "collapsed-tunnel";

  const id = uuidv7();
  await db.insert(campaigns).values({
    id,
    userId,
    title,
    formId,
    locationId,
  });
  return NextResponse.json({
    campaign: {
      id,
      userId,
      title,
      formId,
      locationId,
      status: "active",
    },
  });
}
