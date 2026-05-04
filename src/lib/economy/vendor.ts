/**
 * Vendor catalogs — pure validation for the `trade_with_npc` tool.
 *
 * Catalogs live in `content/npcs/<id>.json` under `metadata.catalog`.
 * Each entry: `{ itemId, buyPrice, sellPrice, stock?: number }`. The
 * central-bank rule is `sellPrice > buyPrice` so the vendor's markup
 * anchors the prices and the player can't sell-buy-sell-buy at zero
 * cost. (`buyPrice` is what the player PAYS to buy; `sellPrice` is
 * what the player RECEIVES when selling. Always sellPrice < buyPrice.)
 *
 * `stock` is optional and per-catalog-entry. When unset, the entry
 * has unlimited stock (e.g. a smith who always has nails). When set,
 * the buy action decrements stock and the entry becomes unavailable
 * once stock reaches 0. Stock is per-NPC-template — not per-player —
 * so a vendor that runs out of iron ingots stays out for everyone.
 *
 * Phase 5 Day 18-19.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface VendorCatalogEntry {
  itemId: string;
  /** Coins the player pays to buy this item from the vendor. */
  buyPrice: number;
  /** Coins the player receives when selling this item to the vendor.
   *  Always less than buyPrice. */
  sellPrice: number;
  /** Optional stock cap. When unset, unlimited. Decrements on buy. */
  stock?: number;
}

export interface VendorCatalog {
  npcId: string;
  entries: VendorCatalogEntry[];
  /** Optional per-vendor daily coin gain cap (Phase 5 Day 26 anti-farm).
   *  Not enforced here — read by the runtime telemetry layer. */
  dailyCoinCap?: number;
}

interface RawNpcCatalogEntry {
  itemId?: unknown;
  buyPrice?: unknown;
  sellPrice?: unknown;
  stock?: unknown;
}

interface RawNpc {
  id?: unknown;
  metadata?: {
    catalog?: RawNpcCatalogEntry[];
    dailyCoinCap?: unknown;
  };
}

const catalogCache = new Map<string, VendorCatalog | null>();

function loadCatalog(templateId: string): VendorCatalog | null {
  if (catalogCache.has(templateId)) return catalogCache.get(templateId)!;
  const path = join(process.cwd(), "content", "npcs", `${templateId}.json`);
  if (!existsSync(path)) {
    catalogCache.set(templateId, null);
    return null;
  }
  let parsed: RawNpc;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as RawNpc;
  } catch {
    catalogCache.set(templateId, null);
    return null;
  }
  const raw = parsed.metadata?.catalog;
  if (!Array.isArray(raw) || raw.length === 0) {
    catalogCache.set(templateId, null);
    return null;
  }
  const entries: VendorCatalogEntry[] = [];
  for (const r of raw) {
    if (
      typeof r.itemId !== "string" ||
      typeof r.buyPrice !== "number" ||
      typeof r.sellPrice !== "number"
    ) {
      continue;
    }
    if (r.buyPrice <= 0 || r.sellPrice <= 0) continue;
    if (r.sellPrice >= r.buyPrice) continue; // central-bank invariant
    entries.push({
      itemId: r.itemId,
      buyPrice: Math.floor(r.buyPrice),
      sellPrice: Math.floor(r.sellPrice),
      stock: typeof r.stock === "number" ? Math.max(0, Math.floor(r.stock)) : undefined,
    });
  }
  if (entries.length === 0) {
    catalogCache.set(templateId, null);
    return null;
  }
  const dailyCoinCap =
    typeof parsed.metadata?.dailyCoinCap === "number"
      ? parsed.metadata.dailyCoinCap
      : undefined;
  const cat: VendorCatalog = {
    npcId: typeof parsed.id === "string" ? parsed.id : templateId,
    entries,
    ...(dailyCoinCap !== undefined ? { dailyCoinCap } : {}),
  };
  catalogCache.set(templateId, cat);
  return cat;
}

/** For tests — clears the in-memory cache. */
export function clearVendorCatalogCache(): void {
  catalogCache.clear();
}

/**
 * Look up a vendor's catalog by their template id (the NPC slug used
 * in `content/npcs/<id>.json`). Returns null if the file doesn't exist
 * or doesn't have a `metadata.catalog`.
 *
 * Note: in projection, NPCs have a runtime id like "halrik-abcd1234"
 * (template + uuid suffix). The caller resolves this to the templateId
 * via `projection.npcs[npcId].templateId` before calling.
 */
export function getVendorCatalog(templateId: string): VendorCatalog | null {
  return loadCatalog(templateId);
}

export interface TradeRequest {
  catalog: VendorCatalog;
  action: "buy" | "sell";
  itemId: string;
  qty: number;
  /** Player's current coin balance. Required for buy. */
  currentCoins: number;
  /** Player's current inventory quantity for itemId. Required for sell. */
  currentInventoryQty: number;
}

export interface TradeResolution {
  /** Net coin delta — negative for buy, positive for sell. */
  coinsDelta: number;
  /** Per-unit price (buyPrice for buy, sellPrice for sell). */
  unitPrice: number;
  /** Total coins exchanged (always positive). */
  totalPrice: number;
  entry: VendorCatalogEntry;
}

/**
 * Pure trade validator. Returns the resolved coin/inventory delta on
 * success, or a string error message on failure. Caller is responsible
 * for applying side effects (DB writes, event emissions).
 */
export function validateTrade(
  req: TradeRequest,
): TradeResolution | { error: string } {
  if (req.qty < 1 || req.qty > 10) {
    return { error: `trade_with_npc: qty must be 1-10 (got ${req.qty})` };
  }
  const entry = req.catalog.entries.find((e) => e.itemId === req.itemId);
  if (!entry) {
    return {
      error: `trade_with_npc: vendor doesn't deal in '${req.itemId}'`,
    };
  }
  if (req.action === "buy") {
    const total = entry.buyPrice * req.qty;
    if (req.currentCoins < total) {
      return {
        error: `trade_with_npc: insufficient coins (need ${total}, have ${req.currentCoins})`,
      };
    }
    if (entry.stock !== undefined && entry.stock < req.qty) {
      return {
        error: `trade_with_npc: vendor only has ${entry.stock} of '${entry.itemId}' in stock`,
      };
    }
    return {
      coinsDelta: -total,
      unitPrice: entry.buyPrice,
      totalPrice: total,
      entry,
    };
  }
  // sell
  if (req.currentInventoryQty < req.qty) {
    return {
      error: `trade_with_npc: only ${req.currentInventoryQty} '${req.itemId}' in inventory, asked ${req.qty}`,
    };
  }
  const total = entry.sellPrice * req.qty;
  return {
    coinsDelta: +total,
    unitPrice: entry.sellPrice,
    totalPrice: total,
    entry,
  };
}
