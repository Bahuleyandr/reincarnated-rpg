-- Phase 10 P5 — NPC-initiated letters.
--
-- The letters table assumed every letter had a player sender
-- (from_user_id NOT NULL). We want recurring NPCs to send letters
-- to players after the first time they're met in a run, so the
-- player's inbox stops being a wasteland of "no letters in this
-- folder."
--
-- Adds an alternate sender column (from_npc_template_id), drops the
-- NOT NULL on from_user_id, and adds a CHECK constraint that at
-- least one of the two sender columns is set. Existing letters all
-- have from_user_id populated, so the constraint is satisfied for
-- them without a backfill.

ALTER TABLE letters
  ADD COLUMN IF NOT EXISTS from_npc_template_id TEXT;

ALTER TABLE letters
  ALTER COLUMN from_user_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'letters_one_sender'
  ) THEN
    ALTER TABLE letters
      ADD CONSTRAINT letters_one_sender CHECK (
        from_user_id IS NOT NULL OR from_npc_template_id IS NOT NULL
      );
  END IF;
END $$;

-- Index supporting the dedupe lookup (from_npc + to_user) used by
-- seedFirstMeetLetters and any future "letters from this NPC" view.
CREATE INDEX IF NOT EXISTS letters_from_npc_idx
  ON letters (from_npc_template_id, sent_at DESC);
