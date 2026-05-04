-- NPC dialogue system foundation — post-Phase-8 follow-up.
--
-- Per-(session, npc) dialogue threads. Each turn that exchanges
-- words with an NPC writes one row (player utterance + npc
-- reply). The thread is truncated to the last N entries when
-- composing the next reply prompt; older entries summarize into
-- the existing memory pipeline.
--
-- Dialogue is OPTIONAL — most turns won't have a dialogue row.
-- The `speak_to(npcId, utterance)` tool emits a dialogue.exchanged
-- event; the orchestrator side-effect fills in the npc_reply
-- after the narrator responds.

CREATE TABLE IF NOT EXISTS dialogue_turns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  npc_id text NOT NULL,
  npc_template_id text NOT NULL,
  /** What the player said. Sanitized + length-capped before insert. */
  player_utterance text NOT NULL,
  /** What the NPC replied. May be empty if the narrator chose
      to narrate around the speak rather than reply directly. */
  npc_reply text NOT NULL DEFAULT '',
  /** Turn number when this exchange happened — used for the
      memory pipeline's eventSeqRange. */
  turn integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dialogue_turns_session_npc_idx
  ON dialogue_turns (session_id, npc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dialogue_turns_session_idx
  ON dialogue_turns (session_id);
