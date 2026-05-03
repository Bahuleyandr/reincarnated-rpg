"use client";

interface NearbyPlayer {
  sessionId: string;
  username: string | null;
  displayName: string;
  formId: string;
  isSelf: boolean;
}

interface NearbyNpc {
  slug: string;
  name: string;
  relationship?: number;
}

export function NearbyBox({
  room,
  pcs,
  npcs,
}: {
  room: { locationId: string; roomId: string | null };
  pcs: NearbyPlayer[];
  npcs: NearbyNpc[];
}) {
  return (
    <section className="border-t border-stone-800 bg-stone-900/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-stone-100 text-xs">in this room</h3>
        <span className="text-[10px] text-stone-600">
          {room.roomId ?? "—"}
        </span>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-stone-600">
          reincarnated ({pcs.length})
        </div>
        {pcs.length === 0 ? (
          <p className="text-stone-600 text-[11px] italic">
            no one else has woken here.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {pcs.map((p) => (
              <li
                key={p.sessionId}
                className={`flex items-baseline gap-2 ${
                  p.isSelf ? "opacity-50" : ""
                }`}
              >
                <span className="text-stone-200 truncate">
                  {p.displayName}
                </span>
                {p.username && (
                  <span className="text-[10px] text-stone-500">
                    @{p.username}
                  </span>
                )}
                <span className="text-[10px] text-stone-600 ml-auto">
                  {p.formId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1 pt-1">
        <div className="text-[10px] uppercase tracking-widest text-stone-600">
          others ({npcs.length})
        </div>
        {npcs.length === 0 ? (
          <p className="text-stone-600 text-[11px] italic">none.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {npcs.map((n) => (
              <li
                key={n.slug}
                className="flex items-baseline gap-2"
              >
                <span className="text-stone-300 truncate">{n.name}</span>
                {typeof n.relationship === "number" &&
                  n.relationship !== 0 && (
                    <span
                      className={`text-[10px] ml-auto ${
                        n.relationship > 0 ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {n.relationship > 0
                        ? `+${n.relationship}`
                        : n.relationship}
                    </span>
                  )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] text-stone-700 leading-4 pt-2 border-t border-stone-900">
        the reincarnated are other players in the same room as you.
        the others are NPCs the world placed here.
      </p>
    </section>
  );
}
