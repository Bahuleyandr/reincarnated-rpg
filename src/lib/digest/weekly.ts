/**
 * Weekly world digest scaffold (T4.3, Phase-9 follow-up).
 *
 * Compiles a "what happened this week in the world" summary that
 * a returning-player surface (and eventually an email) can show.
 * Pulls from:
 *   - lore (top N notable summaries, 7d window)
 *   - famous deaths ticker (the recent-7d slice)
 *   - faction state changes
 *   - festivals that fired this week
 *   - top retired-player NPCs that surfaced
 *
 * Pure-function: pass it pre-fetched state, get back a markdown
 * digest. The substrate lets the existing email infra (Phase 8)
 * deliver this on a weekly cron, or a /world/digest UI pull.
 */

export interface WeeklyDigestInputs {
  weekOfUtc: string; // YYYY-MM-DD of Monday
  loreEntries: Array<{ summary: string; category: string | null }>;
  famousDeaths: Array<{ summary: string; formId: string }>;
  factionShifts: Array<{ factionId: string; delta: number; note: string }>;
  festivalsFired: Array<{ id: string; displayName: string; region: string }>;
  retiredAppearances: Array<{
    templateId: string;
    displayName: string;
    appearedFor: string;
  }>;
}

export function composeWeeklyDigest(args: WeeklyDigestInputs): string {
  const lines: string[] = [];
  lines.push(`# The week of ${args.weekOfUtc}`);
  lines.push("");

  if (args.festivalsFired.length > 0) {
    lines.push("## Festivals this week");
    for (const f of args.festivalsFired) {
      lines.push(`- **${f.displayName}** in ${f.region}`);
    }
    lines.push("");
  }

  if (args.loreEntries.length > 0) {
    lines.push("## What was written down");
    for (const l of args.loreEntries.slice(0, 6)) {
      const cat = l.category ? ` [${l.category}]` : "";
      lines.push(`- ${l.summary}${cat}`);
    }
    lines.push("");
  }

  if (args.famousDeaths.length > 0) {
    lines.push("## Notable deaths");
    for (const d of args.famousDeaths.slice(0, 5)) {
      lines.push(`- A ${d.formId}: ${d.summary}`);
    }
    lines.push("");
  }

  if (args.factionShifts.length > 0) {
    lines.push("## Faction shifts");
    for (const f of args.factionShifts) {
      const sign = f.delta > 0 ? "+" : "";
      lines.push(`- ${f.factionId}: ${sign}${f.delta} (${f.note})`);
    }
    lines.push("");
  }

  if (args.retiredAppearances.length > 0) {
    lines.push("## Returned from retirement");
    for (const r of args.retiredAppearances) {
      lines.push(`- **${r.displayName}** appeared in ${r.appearedFor}`);
    }
    lines.push("");
  }

  if (
    args.loreEntries.length === 0 &&
    args.famousDeaths.length === 0 &&
    args.factionShifts.length === 0 &&
    args.festivalsFired.length === 0 &&
    args.retiredAppearances.length === 0
  ) {
    lines.push(
      "*A quiet week. The world held its breath; nothing of note was written down.*",
    );
  }

  return lines.join("\n");
}
