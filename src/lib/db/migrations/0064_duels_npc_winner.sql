-- Phase 9 T5.5 follow-up — NPC duel resolution.
--
-- The original duels schema only carried winner_user_id (nullable).
-- An NPC win was indistinguishable from a tie. This adds an
-- explicit winner_npc_template_id column so the resolution can
-- record either side cleanly. A duel has at most one winner; the
-- check constraint enforces that.

ALTER TABLE duels
  ADD COLUMN IF NOT EXISTS winner_npc_template_id TEXT;

-- Drop the existing CHECK if any prior version added one;
-- recreate with the at-most-one-winner rule.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'duels_one_winner'
  ) THEN
    ALTER TABLE duels
      ADD CONSTRAINT duels_one_winner CHECK (
        winner_user_id IS NULL OR winner_npc_template_id IS NULL
      );
  END IF;
END $$;
