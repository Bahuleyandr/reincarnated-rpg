/**
 * P5 — NPC-initiated letters.
 *
 * Trial-run finding B5: /letters has tabs and an "no letters in
 * this folder." empty state. Solo players never see anything in
 * their inbox. NPC-initiated letters seed the inbox so the world
 * starts to feel like it's reaching back.
 *
 * Trigger: at session.ended, scan the run's events for any
 * `npc.introduced` whose template id corresponds to a recurring
 * NPC with a `letters.firstMeet` block. For each one, send a
 * letter from that NPC to the player — but only if no letter from
 * this NPC to this user already exists. Idempotent.
 *
 * Sender column: from_npc_template_id (added in migration 0066).
 * fromUserId is null on these rows, which the inbox UI handles by
 * looking up the NPC template's displayName.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { letters } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";
import type { Event } from "../game/types";

/** Letter copy stored on the NPC json template. Both subject and
 *  body are required when the block is present. */
export interface NpcFirstMeetLetter {
  subject: string;
  body: string;
}

interface NpcTemplateJson {
  id: string;
  displayName?: string;
  letters?: {
    firstMeet?: NpcFirstMeetLetter;
  };
  metadata?: {
    recurring?: boolean;
  };
}

const cache = new Map<string, NpcTemplateJson | null>();

function loadNpcTemplate(templateId: string): NpcTemplateJson | null {
  if (cache.has(templateId)) return cache.get(templateId) ?? null;
  const path = join(
    process.cwd(),
    "content",
    "npcs",
    `${templateId}.json`,
  );
  if (!existsSync(path)) {
    cache.set(templateId, null);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as NpcTemplateJson;
    cache.set(templateId, data);
    return data;
  } catch {
    cache.set(templateId, null);
    return null;
  }
}

/** Reset the in-memory cache. Tests use this to force re-reads of
 *  NPC json files between fixtures. */
export function _resetNpcLetterCacheForTests(): void {
  cache.clear();
}

/** Read the NPC template from disk and return its first-meet
 *  letter block — or null if the NPC isn't recurring or doesn't
 *  define a firstMeet letter. */
export function getFirstMeetLetterForNpc(
  templateId: string,
): NpcFirstMeetLetter | null {
  const npc = loadNpcTemplate(templateId);
  if (!npc) return null;
  if (!npc.metadata?.recurring) return null;
  return npc.letters?.firstMeet ?? null;
}

interface SeedArgs {
  db: Db;
  toUserId: string;
  /** Recurring NPCs introduced during the run. Repeats are fine —
   *  the dedupe check handles them. */
  npcTemplateIds: string[];
}

export interface SeedResult {
  /** Template ids of NPCs that sent a new letter on this call. */
  sent: string[];
  /** Template ids that were skipped because a prior letter already
   *  exists. Useful for log telemetry. */
  skipped: string[];
}

/**
 * For each unique NPC template id in `npcTemplateIds`, attempt to
 * send a first-meet letter to `toUserId`. Skips when:
 *   - the NPC template has no `letters.firstMeet`
 *   - the NPC isn't a recurring template
 *   - a letter from this NPC to this user already exists in the
 *     letters table
 *
 * Returns the list of templates that sent and the list that were
 * skipped — caller decides whether to log.
 */
export async function seedFirstMeetLetters(
  args: SeedArgs,
): Promise<SeedResult> {
  const sent: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const templateId of args.npcTemplateIds) {
    if (seen.has(templateId)) continue;
    seen.add(templateId);

    const tpl = getFirstMeetLetterForNpc(templateId);
    if (!tpl) {
      skipped.push(templateId);
      continue;
    }

    // Dedupe: any prior letter from this NPC to this user means
    // the firstMeet has already been seeded. Even refused letters
    // count — we don't want to retry.
    const [existing] = await args.db
      .select({ id: letters.id })
      .from(letters)
      .where(
        and(
          eq(letters.fromNpcTemplateId, templateId),
          eq(letters.toUserId, args.toUserId),
        ),
      )
      .limit(1);
    if (existing) {
      skipped.push(templateId);
      continue;
    }

    await args.db.insert(letters).values({
      id: uuidv7(),
      fromUserId: null,
      fromNpcTemplateId: templateId,
      toUserId: args.toUserId,
      toNpcTemplateId: null,
      subject: tpl.subject,
      body: tpl.body,
      // World-generated letters land in the inbox immediately;
      // there's no async-mail pending step.
      status: "delivered",
      voiceMode: "written",
    });
    sent.push(templateId);
  }
  return { sent, skipped };
}

/**
 * Convenience helper: pull the introduced-NPC template ids from a
 * session's event log. The orchestrator calls this at session.ended
 * and feeds the result to seedFirstMeetLetters.
 */
export function npcTemplateIdsIntroducedDuring(
  events: Event[],
): string[] {
  const ids: string[] = [];
  for (const e of events) {
    if (e.kind === "npc.introduced") {
      // `data.templateId` is set by the introduce_npc tool (see
      // src/lib/game/tools.ts). It's stored alongside name +
      // relationship in the event payload.
      const tpl =
        typeof e.data?.templateId === "string"
          ? e.data.templateId
          : null;
      if (tpl) ids.push(tpl);
    }
  }
  return ids;
}
