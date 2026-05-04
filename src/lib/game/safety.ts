import type { Projection } from "./types";

export const SAFETY_CAPS = {
  formStateAbsMax: 20,
  damagePerCallMax: 10,
  healPerCallMax: 5,
  invQtyPerCallMax: 5,
  inventoryBase: 10,
  inventoryHardMax: 30,
  maxToolsPerTurn: 6,
  grantXpPerCallMax: 50,
} as const;

export function inventoryCapacity(projection: Projection): number {
  const bonus = (projection.form.state["bag_slots"] as number) ?? 0;
  return Math.max(
    SAFETY_CAPS.inventoryBase,
    Math.min(SAFETY_CAPS.inventoryHardMax, SAFETY_CAPS.inventoryBase + bonus),
  );
}

export function inventoryUsed(projection: Projection): number {
  return projection.inventory.reduce((sum, i) => sum + i.qty, 0);
}
