"use client";

import { inventoryCapacity, inventoryUsed, SAFETY_CAPS } from "@/lib/game/safety";
import type { Projection } from "@/lib/game/types";

import { ManualHelpButton } from "./InstructionManual";

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
    <section className="space-y-3 px-4 py-3 text-xs" data-testid="inventory-panel">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <h4 className="text-[10px] tracking-wider text-stone-400 uppercase">inventory</h4>
            <ManualHelpButton topicId="inventory" compact />
          </div>
          <span
            className={`text-[10px] ${isFull ? "text-red-400" : "text-stone-500"}`}
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
        <div className="relative h-1 overflow-hidden border border-stone-800 bg-stone-900">
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
                className="flex items-baseline justify-between gap-2"
                data-testid={`item-${i.itemId}`}
              >
                <span className="truncate text-stone-300" title={i.itemId}>
                  {i.customName ? (
                    <>
                      <span className="text-amber-300">{i.customName}</span>
                      <span className="ml-1 text-[10px] text-stone-700">({i.itemId})</span>
                    </>
                  ) : (
                    i.itemId
                  )}
                </span>
                <span className="text-stone-500">×{i.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <h4 className="text-[10px] tracking-wider text-stone-400 uppercase">
            known ({npcs.length})
          </h4>
          <ManualHelpButton topicId="npcs" compact />
        </div>
        {npcs.length === 0 ? (
          <p className="text-stone-600 italic">no one yet</p>
        ) : (
          <ul className="space-y-0.5">
            {npcs.map(([id, npc]) => (
              <li key={id} className="flex justify-between" data-testid={`npc-${id}`}>
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
