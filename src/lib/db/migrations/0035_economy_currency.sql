-- Phase 5 Day 18-19: Currency primitive + NPC vendors (central bank).
--
-- Coins are user-level — they survive reincarnation, like legacy traits and
-- the daily streak. Anonymous sessions get a session-scoped purse that
-- merges into the user's account when they register/claim. Default starting
-- balance is 50 coins; just enough to buy a starter resource from the
-- tutorial vendor without grinding first.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 50;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 0;

-- Negative balances are blocked at the application layer (lib/economy/coins.ts);
-- a CHECK here protects against direct writes (admin SQL, accidents).
ALTER TABLE users
  ADD CONSTRAINT users_coins_nonneg_chk CHECK (coins >= 0);
ALTER TABLE sessions
  ADD CONSTRAINT sessions_coins_nonneg_chk CHECK (coins >= 0);
