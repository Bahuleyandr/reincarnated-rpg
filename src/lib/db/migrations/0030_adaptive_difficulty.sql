ALTER TABLE users
  ADD COLUMN IF NOT EXISTS adaptive_death_streak integer NOT NULL DEFAULT 0;

-- Count of consecutive recent deaths since the last non-death
-- (win or cap). Maintained by src/lib/memory/world.ts:
-- persistRunToWorld at run-end. Used by the adaptive-difficulty
-- layer (lib/difficulty/adaptive.ts) to award a +1 roll modifier
-- after 3 consecutive deaths. Win or cap resets to 0.
