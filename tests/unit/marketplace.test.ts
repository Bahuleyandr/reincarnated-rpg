import {
  LISTING_DURATION_MS,
  PRICE_MAX,
  QTY_MAX,
  QTY_MIN,
  SINK_FEE_PERCENT,
  validateListing,
} from "@/lib/marketplace/listings";

describe("validateListing", () => {
  const base = {
    sellerUserId: "u1",
    itemId: "iron-ingot",
    qty: 2,
    pricePerUnit: 25,
    currentInventoryQty: 5,
  };

  test("happy path returns null", () => {
    expect(validateListing(base)).toBeNull();
  });

  test("qty out of bounds rejected", () => {
    expect(validateListing({ ...base, qty: 0 })?.ok).toBe(false);
    expect(validateListing({ ...base, qty: 100 })?.ok).toBe(false);
  });

  test("price out of bounds rejected", () => {
    expect(validateListing({ ...base, pricePerUnit: 0 })?.ok).toBe(false);
    expect(
      validateListing({ ...base, pricePerUnit: PRICE_MAX + 1 })?.ok,
    ).toBe(false);
  });

  test("note over 160 chars rejected", () => {
    expect(
      validateListing({ ...base, note: "a".repeat(200) })?.ok,
    ).toBe(false);
  });

  test("insufficient inventory rejected with `have`", () => {
    const r = validateListing({ ...base, currentInventoryQty: 1 });
    expect(r?.ok).toBe(false);
    if (r && !r.ok && r.error === "insufficient_inventory") {
      expect(r.have).toBe(1);
    } else {
      throw new Error("expected insufficient_inventory");
    }
  });
});

describe("constants", () => {
  test("sink fee = 10", () => {
    expect(SINK_FEE_PERCENT).toBe(10);
  });
  test("listing duration = 7d", () => {
    expect(LISTING_DURATION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
  test("qty bounds 1..99", () => {
    expect(QTY_MIN).toBe(1);
    expect(QTY_MAX).toBe(99);
  });
});
