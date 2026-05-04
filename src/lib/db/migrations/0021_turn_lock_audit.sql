CREATE TABLE IF NOT EXISTS turn_lock_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  token text,
  at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS turn_lock_events_session_idx
  ON turn_lock_events (session_id, at DESC);

CREATE INDEX IF NOT EXISTS turn_lock_events_kind_idx
  ON turn_lock_events (event_kind, at DESC);
