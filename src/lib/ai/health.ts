/**
 * Provider health tracker — Phase 7 Day 40-41.
 *
 * 3-strikes-and-degrade rule:
 *   - 3 consecutive failures within 60s → degraded
 *   - 10 consecutive failures            → down
 *   - 1 success                          → healthy
 *
 * The factory consults the health row before routing; degraded
 * providers can still take traffic but log warnings, down
 * providers fall through to the next link in the chain (template
 * at the tail).
 *
 * Admin can force a provider's status from /god/providers — the
 * automatic recovery still runs but the manual override sticks
 * until cleared.
 */
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { providerHealth } from "../db/schema";
import { log } from "../util/log";

export type ProviderStatus = "healthy" | "degraded" | "down" | "manual_down";

export const FAILURES_TO_DEGRADE = 3;
export const FAILURES_TO_DOWN = 10;
export const DEGRADE_WINDOW_MS = 60_000;

export interface ProviderHealthState {
  providerId: string;
  status: ProviderStatus;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
}

export async function getHealth(
  db: Db,
  providerId: string,
): Promise<ProviderHealthState | null> {
  const [row] = await db
    .select()
    .from(providerHealth)
    .where(eq(providerHealth.providerId, providerId))
    .limit(1);
  if (!row) return null;
  return {
    providerId: row.providerId,
    status: row.status as ProviderStatus,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    consecutiveFailures: row.consecutiveFailures,
  };
}

export async function getAllHealth(
  db: Db,
): Promise<ProviderHealthState[]> {
  const rows = await db.select().from(providerHealth);
  return rows.map((r) => ({
    providerId: r.providerId,
    status: r.status as ProviderStatus,
    lastSuccessAt: r.lastSuccessAt,
    lastFailureAt: r.lastFailureAt,
    consecutiveFailures: r.consecutiveFailures,
  }));
}

export async function recordSuccess(
  db: Db,
  providerId: string,
): Promise<void> {
  await db
    .update(providerHealth)
    .set({
      status: sql`CASE WHEN ${providerHealth.status} = 'manual_down' THEN 'manual_down' ELSE 'healthy' END`,
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(providerHealth.providerId, providerId));
}

export async function recordFailure(
  db: Db,
  providerId: string,
): Promise<{ status: ProviderStatus; consecutiveFailures: number }> {
  const before = await getHealth(db, providerId);
  if (!before) {
    return { status: "down", consecutiveFailures: 0 };
  }
  // Manual_down stays sticky regardless of automatic counters.
  if (before.status === "manual_down") {
    await db
      .update(providerHealth)
      .set({
        lastFailureAt: new Date(),
        consecutiveFailures: before.consecutiveFailures + 1,
        updatedAt: new Date(),
      })
      .where(eq(providerHealth.providerId, providerId));
    return {
      status: "manual_down",
      consecutiveFailures: before.consecutiveFailures + 1,
    };
  }
  const nextCount = before.consecutiveFailures + 1;
  const now = Date.now();
  const lastFailureMs = before.lastFailureAt?.getTime() ?? 0;
  const withinWindow = now - lastFailureMs <= DEGRADE_WINDOW_MS;
  let nextStatus: ProviderStatus = before.status;
  if (nextCount >= FAILURES_TO_DOWN) {
    nextStatus = "down";
  } else if (nextCount >= FAILURES_TO_DEGRADE && withinWindow) {
    nextStatus = "degraded";
  } else if (
    nextCount >= FAILURES_TO_DEGRADE &&
    !withinWindow &&
    before.status === "healthy"
  ) {
    // 3 failures spread far apart — keep healthy but log.
    nextStatus = "healthy";
  }
  await db
    .update(providerHealth)
    .set({
      status: nextStatus,
      lastFailureAt: new Date(now),
      consecutiveFailures: nextCount,
      updatedAt: new Date(),
    })
    .where(eq(providerHealth.providerId, providerId));
  if (nextStatus !== before.status) {
    log.warn("provider.health.transition", {
      providerId,
      from: before.status,
      to: nextStatus,
      consecutiveFailures: nextCount,
    });
  }
  return { status: nextStatus, consecutiveFailures: nextCount };
}

export async function adminSetStatus(
  db: Db,
  providerId: string,
  status: ProviderStatus,
): Promise<void> {
  await db
    .update(providerHealth)
    .set({ status, updatedAt: new Date() })
    .where(eq(providerHealth.providerId, providerId));
  log.info("provider.health.admin_override", { providerId, status });
}

/**
 * Pure: given the per-provider statuses, return the ordered chain
 * of providers we should try. Skips status='down' / 'manual_down'.
 * Defaults the chain to anthropic → bedrock → vertex; tail is the
 * sentinel string 'template' (not a real provider — the factory
 * consults this string and picks the TemplateNarrator).
 */
export function failoverChain(
  preferred: string,
  states: ReadonlyArray<ProviderHealthState>,
): string[] {
  const all = ["anthropic", "bedrock", "vertex"];
  const preferredFirst = [preferred, ...all.filter((p) => p !== preferred)];
  const byId = new Map(states.map((s) => [s.providerId, s]));
  const result: string[] = [];
  for (const id of preferredFirst) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.status === "down" || s.status === "manual_down") continue;
    result.push(id);
  }
  result.push("template");
  return result;
}
