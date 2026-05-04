/**
 * NPC dialogue threads — post-Phase-8 follow-up.
 *
 * Per-(session, npc) recent-utterance reader + writer. The
 * narrator gets the last N exchanges as context blocks so it
 * can reply in the NPC's voice across multiple turns without
 * re-deriving everything from the event log.
 *
 * Dialogue is opt-in: the speak_to tool emits dialogue.exchanged;
 * the orchestrator side-effect persists the row. The
 * `recentExchanges` reader is called on the next turn before
 * narrate() runs.
 */
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { dialogueTurns } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export const DIALOGUE_THREAD_DEPTH = 8;
export const UTTERANCE_MAX_LEN = 280;

export interface DialogueExchange {
  id: string;
  npcId: string;
  npcTemplateId: string;
  playerUtterance: string;
  npcReply: string;
  turn: number;
  createdAtMs: number;
}

export async function recentExchanges(
  db: Db,
  args: {
    sessionId: string;
    npcId: string;
    limit?: number;
  },
): Promise<DialogueExchange[]> {
  const limit = Math.max(1, Math.min(20, args.limit ?? DIALOGUE_THREAD_DEPTH));
  const rows = await db
    .select()
    .from(dialogueTurns)
    .where(
      and(
        eq(dialogueTurns.sessionId, args.sessionId),
        eq(dialogueTurns.npcId, args.npcId),
      ),
    )
    .orderBy(desc(dialogueTurns.createdAt))
    .limit(limit);
  // Return chronological (oldest → newest) so the narrator
  // reads the thread in natural order.
  return rows.reverse().map((r) => ({
    id: r.id,
    npcId: r.npcId,
    npcTemplateId: r.npcTemplateId,
    playerUtterance: r.playerUtterance,
    npcReply: r.npcReply,
    turn: r.turn,
    createdAtMs: r.createdAt.getTime(),
  }));
}

/** All NPCs the player has spoken with this session. Used to
 *  pre-fetch threads for any NPC currently in-scene. */
export async function listSessionDialoguePartners(
  db: Db,
  sessionId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ npcId: dialogueTurns.npcId })
    .from(dialogueTurns)
    .where(eq(dialogueTurns.sessionId, sessionId));
  return rows.map((r) => r.npcId);
}

/**
 * Persist a new exchange. Sanitizes utterance (trim + length cap)
 * and skips when blank. Returns the new row id; reply is set to
 * empty string and updated in a follow-up call once the narrator
 * has run.
 */
export async function appendExchange(
  db: Db,
  args: {
    sessionId: string;
    npcId: string;
    npcTemplateId: string;
    utterance: string;
    turn: number;
  },
): Promise<{ id: string } | null> {
  const trimmed = args.utterance.trim().slice(0, UTTERANCE_MAX_LEN);
  if (trimmed.length === 0) return null;
  const id = uuidv7();
  await db.insert(dialogueTurns).values({
    id,
    sessionId: args.sessionId,
    npcId: args.npcId,
    npcTemplateId: args.npcTemplateId,
    playerUtterance: trimmed,
    npcReply: "",
    turn: args.turn,
  });
  return { id };
}

/**
 * Update the npc_reply on an existing exchange row. The
 * orchestrator calls this AFTER narration completes; the reply
 * is the narrator's prose-extracted line for that NPC (or the
 * narrator's full prose minus the player's words; the template
 * narrator just stores its hard-move output).
 */
export async function fillReply(
  db: Db,
  exchangeId: string,
  reply: string,
): Promise<void> {
  await db
    .update(dialogueTurns)
    .set({ npcReply: reply.slice(0, 1000) })
    .where(eq(dialogueTurns.id, exchangeId));
}

/**
 * Compose a system-prompt fragment showing the recent dialogue
 * thread. Returns null when the thread is empty so the caller
 * can skip the block.
 */
export function composeThreadFragment(
  exchanges: ReadonlyArray<DialogueExchange>,
  npcLabel: string,
): string | null {
  if (exchanges.length === 0) return null;
  const lines = exchanges
    .map((e) => {
      const reply = e.npcReply ? `\n  ${npcLabel}: ${e.npcReply}` : "";
      return `- player: ${e.playerUtterance}${reply}`;
    })
    .join("\n");
  return `RECENT DIALOGUE WITH ${npcLabel.toUpperCase()} (${exchanges.length} prior exchanges):\n${lines}\nKeep the NPC's voice consistent with the prior replies.`;
}
