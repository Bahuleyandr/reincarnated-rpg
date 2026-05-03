"use client";

import type { Projection } from "@/lib/game/types";

interface Props {
  projection: Projection | null;
}

export function InventoryPanel({ projection }: Props) {
  if (!projection) return null;
  const items = projection.inventory;
  const npcs = Object.entries(projection.npcs);

  return (
    <section
      className="px-4 py-3 space-y-3 text-xs"
      data-testid="inventory-panel"
    >
      <div className="space-y-1">
        <h4 className="text-stone-400 uppercase tracking-wider text-[10px]">
          inventory ({items.length})
        </h4>
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
