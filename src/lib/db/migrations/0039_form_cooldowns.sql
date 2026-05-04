-- Phase 5.5 Day 29: Per-form reincarnation cooldowns.
--
-- Just died as a slime → can't pick slime again for 24h. Forces
-- variety so form choice feels like commitment, not a slot machine.
-- The reincarnation picker filters cooled forms; the picker UI
-- shows them with a "available in 12h" badge instead of hiding.
--
-- Shape: jsonb array of `{ formId, diedAt }` entries. Trimmed to
-- the last 7 days on every write (stale entries don't gate anyway).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recent_form_deaths jsonb NOT NULL DEFAULT '[]'::jsonb;
