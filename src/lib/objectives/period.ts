/**
 * Period-key math. Pure functions — every objective lives in a
 * (objectiveId, periodKey) tuple where periodKey is:
 *   - "YYYY-MM-DD" for daily objectives (UTC date)
 *   - "YYYY-Www"   for weekly objectives (ISO 8601 week, UTC)
 *
 * UTC throughout — same world clock as ADR-019.
 */
export type ObjectivePeriod = "daily" | "weekly";

export function dailyKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * ISO 8601 week-numbering: weeks run Monday-Sunday. Week 1 contains
 * the year's first Thursday.
 *
 * Returns "YYYY-Www" e.g. "2026-W18".
 */
export function weeklyKey(now: Date = new Date()): string {
  // Algorithm from ISO 8601:
  // 1. Take the date.
  // 2. Compute the Thursday of the same ISO week.
  // 3. Year is that Thursday's year.
  // 4. Week 1 contains Jan 4.
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // ISO weekday: Mon=1 .. Sun=7. JS: Sun=0 .. Sat=6.
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // shift to Thursday
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function periodKeyFor(period: ObjectivePeriod, now: Date = new Date()): string {
  return period === "weekly" ? weeklyKey(now) : dailyKey(now);
}
