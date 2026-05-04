ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS turn_lock_token text,
  ADD COLUMN IF NOT EXISTS turn_lock_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS sessions_turn_lock_expires_idx
  ON sessions(turn_lock_expires_at);
