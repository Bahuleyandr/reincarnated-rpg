-- Player marketplace (Phase 6 anchor — scaffold).
--
-- Players list items they own at a price; other players buy.
-- The seller surrenders the item to escrow at list time; on
-- buy, the buyer's coins go to the seller (minus a 10% sink fee
-- that prevents zero-sum economy growth) and the item moves to
-- the buyer's inventory via the existing inventory.added event
-- pipeline.
--
-- Listings expire after 7 days; the item returns to the seller
-- via the same event-emission path. This stays in sync with the
-- existing economy without a separate truth source.

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id uuid PRIMARY KEY,
  seller_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  qty integer NOT NULL,
  price_per_unit integer NOT NULL,
  /** Optional seller note ("only smithed yesterday — still warm"). */
  note text,
  /** 'active' | 'sold' | 'expired' | 'cancelled' */
  status text NOT NULL DEFAULT 'active',
  buyer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  listed_at timestamptz NOT NULL DEFAULT now(),
  sold_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

-- Hot query: active listings for a given item, cheapest first.
CREATE INDEX IF NOT EXISTS marketplace_listings_item_active_idx
  ON marketplace_listings (item_id, price_per_unit ASC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS marketplace_listings_seller_idx
  ON marketplace_listings (seller_user_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx
  ON marketplace_listings (status, expires_at);
