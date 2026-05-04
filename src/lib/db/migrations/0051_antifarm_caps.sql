-- Phase 5 Day 26 follow-up: anti-farm caps for the economy.
--
-- Per-(user, vendor) and per-(user, resource) daily counters.
-- Vendor catalog metadata.dailyCoinCap and resource metadata
-- daily_gather_cap (per resource × user) are enforced via these
-- counters. Reset at UTC midnight via the date-key column.

CREATE TABLE IF NOT EXISTS vendor_daily_flow (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor_template_id text NOT NULL,
  date date NOT NULL,
  total_amount integer NOT NULL DEFAULT 0,
  txn_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, vendor_template_id, date)
);

CREATE INDEX IF NOT EXISTS vendor_daily_flow_date_idx
  ON vendor_daily_flow (date DESC);

CREATE TABLE IF NOT EXISTS resource_daily_gather (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  date date NOT NULL,
  qty integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, resource_id, date)
);

CREATE INDEX IF NOT EXISTS resource_daily_gather_date_idx
  ON resource_daily_gather (date DESC);
