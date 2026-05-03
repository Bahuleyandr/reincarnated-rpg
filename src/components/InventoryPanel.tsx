"use client";

import {
  inventoryCapacity,
  inventoryUsed,
  SAFETY_CAPS,
} from "@/lib/game/tools";
import type { Projection } from "@/lib/game/types";

interface Props {
  projection: Projection | null;
}

export function InventoryPanel({ projection }: Props) {
  if (!projection) return null;
  const items = projection.inventory;
  const npcs = Object.entries(projection.npcs);
  const capacity = inventoryCapacity(projection);
  const used = inventoryUsed(projection);
  const pct = (used / capacity) * 100;
  const isFull = used >= capacity;
  const isAtHardMax = capacity >= SAFETY_CAPS.inventoryHardMax;

  return (
    <section
      className="px-4 py-3 space-y-3 text-xs"
      data-testid="inventory-panel"
    >
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
            inventory
          </h4>
          <span
            className={`text-[10px] ${
              isFull ? "text-red-400" : "text-stone-500"
            }`}
            title={
              isAtHardMax
                ? `at hard cap (${SAFETY_CAPS.inventoryHardMax})`
                : `base ${SAFETY_CAPS.inventoryBase} + ${capacity - SAFETY_CAPS.inventoryBase} bonus`
            }
          >
            {used} / {capacity}
            {isAtHardMax ? " ✦" : ""}
          </span>
        </div>
        <div className="h-1 bg-stone-900 border border-stone-800 relative overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 ${
              isFull ? "bg-red-700" : pct > 80 ? "bg-amber-700" : "bg-stone-600"
            }`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        {items.length === 0 ? (
          <p className="text-stone-600 italic">empty</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((i) => (
              <li
                key={i.itemId}
                className="flex justify-between"
                data-testid={`item-${i.itemId}`}
              >
                <span className="text-stone-300">{i.itemId}</span>
                <span className="text-stone-500">×{i.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
          known ({npcs.length})
        </h4>
        {npcs.length === 0 ? (
          <p className="text-stone-600 italic">no one yet</p>
        ) : (
          <ul className="space-y-0.5">
            {npcs.map(([id, npc]) => (
              <li
                key={id}
                className="flex justify-between"
                data-testid={`npc-${id}`}
              >
                <span className="text-stone-300">{npc.name}</span>
                <span
                  className={
                    npc.relationship < 0
                      ? "text-red-400"
                      : npc.relationship > 0
                        ? "text-emerald-400"
                        : "text-stone-500"
                  }
                >
                  {npc.relationship >= 0 ? "+" : ""}
                  {npc.relationship}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
