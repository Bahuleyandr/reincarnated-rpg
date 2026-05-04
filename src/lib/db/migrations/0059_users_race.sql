-- Phase 9 atlas integration — race as a first-class user attribute.
--
-- Players can declare their race at registration (or via /character).
-- Race influences picker weights (entries from your homeland surface
-- more often), regional NPC reactions, and future race-specific
-- mechanics (T3.2). NULL = no declared race; the picker treats
-- those users as unaligned.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS race TEXT;

CREATE INDEX IF NOT EXISTS users_race_idx ON users (race) WHERE race IS NOT NULL;
