-- Phase 5 Day 26: Economy telemetry — daily coin-flow rollup.
--
-- One row per (date, source) pair where `source` is the audit tag
-- attached to coins.gained/spent events ("vendor:halrik",
-- "trainer:mother-vael", "gather", "gift:from:user-x", ...). The
-- /god/economy admin dashboard reads this for "today: 12,400 minted,
-- 9,800 spent, top earner Halrik 800c" rollups.
--
-- The orchestrator upserts on every turn that emits coin events.

CREATE TABLE IF NOT EXISTS coin_flow_daily (
  date date NOT NULL,
  source text NOT NULL,
  /** Net amount: positive when coins flowed INTO the player from
      this source; negative when coins flowed OUT. */
  total_amount bigint NOT NULL DEFAULT 0,
  /** Count of distinct events contributing to this row. */
  txn_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (date, source)
);

CREATE INDEX IF NOT EXISTS coin_flow_daily_date_idx
  ON coin_flow_daily (date DESC);
