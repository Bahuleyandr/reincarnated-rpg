-- Phase 8 Day 69-71: payment integration scaffolding.
--
-- Stripe Checkout flow stores a customer id + active subscription
-- per user. Webhooks update subscription_status + tier; tier
-- changes flow into the existing energy/cost-cap layers without
-- code change.
--
-- Audit log for all webhook events received, dedup'd by stripe
-- event id so a retried webhook doesn't double-apply.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz;

CREATE INDEX IF NOT EXISTS users_stripe_customer_idx
  ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS stripe_events_received_idx
  ON stripe_events (received_at DESC);
CREATE INDEX IF NOT EXISTS stripe_events_user_idx
  ON stripe_events (user_id) WHERE user_id IS NOT NULL;
