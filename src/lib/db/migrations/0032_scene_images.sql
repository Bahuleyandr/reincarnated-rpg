CREATE TABLE IF NOT EXISTS scene_images (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Trigger that fired this image. 'awakening' (turn 1), 'first_npc',
  -- 'death', 'win', 'wyrm_fell'. Used for analytics + ordering.
  trigger text NOT NULL,
  -- Turn the image was generated for (helps stitch in transcript).
  turn integer NOT NULL,
  -- The prompt sent to the image provider. Cached so re-renders are
  -- free and we never accidentally regenerate at cost.
  prompt text NOT NULL,
  -- Either the provider's URL or a path into our blob store.
  image_url text,
  -- Provider name + model (analytics + cost attribution).
  provider text,
  model text,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'ready' | 'failed' | 'skipped'
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  UNIQUE (session_id, trigger, turn)
);

CREATE INDEX IF NOT EXISTS scene_images_session_idx
  ON scene_images (session_id, turn);

CREATE INDEX IF NOT EXISTS scene_images_status_idx
  ON scene_images (status, created_at)
  WHERE status = 'pending';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS scene_images_enabled text NOT NULL DEFAULT 'false',
  ADD COLUMN IF NOT EXISTS scene_images_monthly_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scene_images_month_key text;
