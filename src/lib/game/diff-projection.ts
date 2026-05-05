/**
 * Pure projection-diff helper for the play page's per-turn toast.
 *
 * Trial-run finding A4: state changes were invisible. A player rolled
 * a partial-success that cost 4 mana and never knew. The asides on
 * the play page show current vitals, but offer no diff against the
 * previous turn — the change is silent.
 *
 * `diffProjection(prev, next)` returns a small object describing what
 * the player should be told happened. The client renders it as a
 * fading toast above the input box. Pure — easy to test in isolation.
 */
import type { Projection } from "./types";

export interface VitalDelta {
  /** Vital name (e.g. "mana", "integrity"). */
  name: string;
  /** Value before the turn. */
  prev: number;
  /** Value after the turn. */
  next: number;
  /** next - prev. Positive = gained, negative = spent / damaged. */
  delta: number;
}

export interface ProjectionDiff {
  vitals: VitalDelta[];
  inventoryAdded: Array<{ itemId: string; qty: number }>;
  inventoryRemoved: Array<{ itemId: string; qty: number }>;
  /** Room ids that just became discovered (typically just one per turn). */
  roomsDiscovered: string[];
  /** True when status switched from active → ended. UI should not
   *  flash a tiny diff toast on the run-end transition; the Recap
   *  panel takes over. */
  statusChanged: boolean;
  /** Convenience flag: true when the diff is meaningful enough to
   *  show. False for "nothing visible changed" turns. */
  hasChange: boolean;
}

/** Empty diff used when there's no previous projection (e.g. first
 *  state load). The play page suppresses the toast when hasChange
 *  is false, so this works as a sentinel without a separate null
 *  branch. */
export const EMPTY_DIFF: ProjectionDiff = {
  vitals: [],
  inventoryAdded: [],
  inventoryRemoved: [],
  roomsDiscovered: [],
  statusChanged: false,
  hasChange: false,
};

export function diffProjection(
  prev: Projection | null,
  next: Projection,
): ProjectionDiff {
  if (!prev) return EMPTY_DIFF;

  const vitals: VitalDelta[] = [];
  for (const [name, nextVal] of Object.entries(next.form.vitals)) {
    const prevVal = prev.form.vitals[name] ?? nextVal;
    if (prevVal !== nextVal) {
      vitals.push({ name, prev: prevVal, next: nextVal, delta: nextVal - prevVal });
    }
  }

  // Inventory diff. Match by itemId; treat qty changes as add/remove
  // rather than a single qty-delta line because the player thinks of
  // each pick-up as its own event.
  const prevInv = new Map<string, number>();
  for (const it of prev.inventory) {
    prevInv.set(it.itemId, (prevInv.get(it.itemId) ?? 0) + (it.qty ?? 1));
  }
  const nextInv = new Map<string, number>();
  for (const it of next.inventory) {
    nextInv.set(it.itemId, (nextInv.get(it.itemId) ?? 0) + (it.qty ?? 1));
  }
  const inventoryAdded: Array<{ itemId: string; qty: number }> = [];
  const inventoryRemoved: Array<{ itemId: string; qty: number }> = [];
  for (const [itemId, qty] of nextInv) {
    const prevQty = prevInv.get(itemId) ?? 0;
    if (qty > prevQty) {
      inventoryAdded.push({ itemId, qty: qty - prevQty });
    }
  }
  for (const [itemId, prevQty] of prevInv) {
    const qty = nextInv.get(itemId) ?? 0;
    if (qty < prevQty) {
      inventoryRemoved.push({ itemId, qty: prevQty - qty });
    }
  }

  const prevRooms = new Set(prev.location.discovered);
  const roomsDiscovered = next.location.discovered.filter(
    (r) => !prevRooms.has(r),
  );

  const statusChanged = prev.status !== next.status;

  const hasChange =
    vitals.length > 0 ||
    inventoryAdded.length > 0 ||
    inventoryRemoved.length > 0 ||
    roomsDiscovered.length > 0;

  return {
    vitals,
    inventoryAdded,
    inventoryRemoved,
    roomsDiscovered,
    statusChanged,
    hasChange,
  };
}
