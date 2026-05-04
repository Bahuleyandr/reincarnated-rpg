-- Phase 5.5 Day 34-35: Recurring antagonist tracking.
--
-- world_npcs gets two new fields so a named NPC like Rhozell can
-- carry a per-user run history across reincarnations: was Rhozell
-- killed, aided, fled-from, or spared in past lives? The
-- antagonist hook reads this to compose a 1-line "history beat" the
-- narrator weaves in on first appearance.
--
-- run_history is JSONB so it can grow without schema churn:
--   [{ userId, sessionId, outcome, at }, ...]

ALTER TABLE world_npcs
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;

ALTER TABLE world_npcs
  ADD COLUMN IF NOT EXISTS run_history jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS world_npcs_recurring_idx
  ON world_npcs (is_recurring) WHERE is_recurring;
