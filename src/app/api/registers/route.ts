/**
 * GET /api/registers — public read of the world's records.
 *
 * Returns five registers in a single response (see
 * src/lib/registers/aggregate.ts for the field contract).
 *
 * Authless. Anyone with the URL can read who's on the wyrm-fed list,
 * who's been chronicled, etc. Usernames are public anyway; nothing
 * here exposes anything not already on the leaderboard / lore feed.
 *
 * Cached upstream by a short in-memory window — registers don't
 * change often enough that a 30s cache hurts anyone, and the
 * aggregate queries are five-table-join-and-sum-and-sort, which is
 * worth not re-computing per page load.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getAllRegisters } from "@/lib/registers/aggregate";

interface CacheEntry {
  expiresAt: number;
  payload: Awaited<ReturnType<typeof getAllRegisters>>;
}
let cache: CacheEntry | null = null;
const TTL_MS = 30_000;

export async function GET() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json(cache.payload, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }
  const payload = await getAllRegisters(db);
  cache = { expiresAt: now + TTL_MS, payload };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
