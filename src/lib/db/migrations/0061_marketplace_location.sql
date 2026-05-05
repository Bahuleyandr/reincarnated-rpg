-- Phase 9 T3.4 — regional marketplace.
--
-- Listings now carry a location_id (where the seller posted from);
-- buyers can filter by city. Backfilled to NULL meaning "no
-- specific region" — those listings still show up under "all
-- regions" and are visible everywhere.

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS location_id TEXT;

CREATE INDEX IF NOT EXISTS marketplace_listings_location_idx
  ON marketplace_listings (location_id, status, expires_at);
