/**
 * Per-form reincarnation cooldowns — Phase 5.5 Day 29.
 *
 * Just died as a slime → can't pick slime again for 24h. The
 * reincarnation picker filters cooled formIds; the UI surfaces them
 * with a "available in 12h" badge so the player sees what's coming.
 *
 * State lives on `users.recent_form_deaths` (jsonb array of
 * `{ formId, diedAt }`). On each write we trim entries older than
 * the retention window (7d) so the column doesn't grow unbounded.
 *
 * Anonymous sessions don't have form-history persistence — they get
 * `cooling: false` for everything (no userId to attach state to,
 * and they only ever have one death anyway).
 */
export const FORM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const FORM_COOLDOWN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface FormDeathEntry {
  formId: string;
  /** ISO timestamp string. */
  diedAt: string;
}

export interface CoolingResult {
  cooling: boolean;
  /** ms-since-epoch when the cooldown lifts; null when not cooling. */
  untilMs: number | null;
}

/**
 * Pure: is `formId` currently cooling for the player at `now`?
 * Returns `{ cooling: true, untilMs }` when the latest death of
 * formId is within FORM_COOLDOWN_MS of now.
 */
export function coolingDown(
  recentDeaths: ReadonlyArray<FormDeathEntry>,
  formId: string,
  now: number,
): CoolingResult {
  if (recentDeaths.length === 0) return { cooling: false, untilMs: null };
  // Find the most recent diedAt for formId.
  let latestMs = 0;
  for (const e of recentDeaths) {
    if (e.formId !== formId) continue;
    const t = Date.parse(e.diedAt);
    if (!Number.isFinite(t)) continue;
    if (t > latestMs) latestMs = t;
  }
  if (latestMs === 0) return { cooling: false, untilMs: null };
  const untilMs = latestMs + FORM_COOLDOWN_MS;
  return untilMs > now
    ? { cooling: true, untilMs }
    : { cooling: false, untilMs: null };
}

/**
 * Pure: append a death and trim to the retention window. Returns
 * the new entries array (caller persists).
 */
export function recordFormDeath(
  recentDeaths: ReadonlyArray<FormDeathEntry>,
  formId: string,
  diedAt: Date,
  now: number = Date.now(),
): FormDeathEntry[] {
  const cutoff = now - FORM_COOLDOWN_RETENTION_MS;
  const fresh = recentDeaths.filter((e) => {
    const t = Date.parse(e.diedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
  fresh.push({ formId, diedAt: diedAt.toISOString() });
  return fresh;
}

/**
 * Convenience: bulk-evaluate cooldowns for a set of formIds. Used
 * by the reincarnation picker to render badges in one pass.
 */
export function bulkCoolingDown(
  recentDeaths: ReadonlyArray<FormDeathEntry>,
  formIds: ReadonlyArray<string>,
  now: number,
): Record<string, CoolingResult> {
  const out: Record<string, CoolingResult> = {};
  for (const id of formIds) out[id] = coolingDown(recentDeaths, id, now);
  return out;
}
