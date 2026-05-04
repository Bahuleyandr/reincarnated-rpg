-- Phase 5.5 Day 36-37: First-10-minutes tutorial.
--
-- Brand-new users land in a guarded slime intro that teaches the
-- wedge ("each form plays differently") with explicit per-turn
-- hints. After the scripted graduation event, tutorial_completed
-- is flipped and the next session is normal.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_completed boolean NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_tutorial boolean NOT NULL DEFAULT false;
