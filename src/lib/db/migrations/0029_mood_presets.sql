ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mood_preset text NOT NULL DEFAULT 'standard';
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mood_preset text;

-- Allowed values: 'cozy' | 'standard' | 'brutal'.
-- sessions.mood_preset is nullable; null falls back to the user's
-- mood (or 'standard' for anon sessions).
