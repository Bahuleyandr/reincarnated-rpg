-- Phase 7 Day 40-41: provider redundancy.
--
-- One row per known AI provider. The factory consults this table
-- before routing each call: a 'down' provider is skipped, an
-- 'anthropic → bedrock → vertex → template' fallback chain
-- triggers automatically. 3 consecutive failures within 60s →
-- degraded; 10 consecutive → down. One success heals to healthy.

CREATE TABLE IF NOT EXISTS provider_health (
  provider_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'healthy',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO provider_health (provider_id) VALUES
  ('anthropic'),
  ('bedrock'),
  ('vertex')
ON CONFLICT (provider_id) DO NOTHING;
