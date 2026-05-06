"use client";

/**
 * MapPanel — POLISH_PLAN G.2 Tier 1.
 *
 * Renders the current location as an SVG node-graph: rooms as
 * circles, exits as edges, the player's avatar pinned to their
 * current room. Discovery state is reflected — visited rooms are
 * solid, unvisited rooms are dashed with a "?" placeholder.
 *
 * Layout comes from the pure helper `layoutMapView` (so tests can
 * pin coordinates without rendering React). Coords are in a 100×100
 * SVG viewBox; the renderer scales to whatever pixel size the
 * caller asks for.
 *
 * Coloring:
 *   - Rooms use `currentColor` (the form's --form-accent).
 *   - Edges between two visited rooms are solid; edges where one
 *     endpoint is unvisited are dashed (the player can SEE there's
 *     a connection but doesn't yet know what's on the other side).
 *
 * Accessibility:
 *   - role="img" with aria-label describing the location summary.
 *   - Per-room <title> elements give hoverable text.
 */
import type { MapView } from "@/lib/game/map-view";
import { layoutMapView } from "@/lib/game/map-view";
import { Avatar } from "@/components/Avatar";

interface Props {
  view: MapView;
  /** Room ids the player has visited so far. */
  discovered: string[];
  /** Room the player is currently in. */
  currentRoomId: string;
  /** Form id — used to render the avatar inside the current room. */
  formId: string;
  /** Pixel size of the rendered SVG. Default 200. */
  size?: number;
  className?: string;
}

export function MapPanel({
  view,
  discovered,
  currentRoomId,
  formId,
  size = 200,
  className,
}: Props) {
  const positions = layoutMapView(view);
  const visited = new Set(discovered);

  // Build the unique edge set (undirected). Exit lists in the
  // location JSON are bidirectional but listed twice (a→b and b→a);
  // we coalesce by sorting the endpoints.
  const seen = new Set<string>();
  const edges: Array<{ a: string; b: string }> = [];
  for (const room of view.rooms) {
    for (const to of room.exits) {
      const key = [room.id, to].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: room.id, b: to });
    }
  }

  const ariaLabel = `map of ${view.locationId} — ${visited.size} of ${view.rooms.length} rooms discovered`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ color: "var(--form-accent)" }}
    >
      {/* Edges first so they're behind the room circles. */}
      {edges.map((e) => {
        const pa = positions.get(e.a);
        const pb = positions.get(e.b);
        if (!pa || !pb) return null;
        const bothVisited = visited.has(e.a) && visited.has(e.b);
        return (
          <line
            key={`${e.a}|${e.b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="currentColor"
            strokeOpacity={bothVisited ? 0.7 : 0.3}
            strokeWidth={1}
            strokeDasharray={bothVisited ? undefined : "2 2"}
          />
        );
      })}

      {/* Rooms. Layered: dimmed background ring, visited fill,
          current-room highlight. */}
      {view.rooms.map((room) => {
        const pos = positions.get(room.id);
        if (!pos) return null;
        const isCurrent = room.id === currentRoomId;
        const isVisited = visited.has(room.id);
        const r = isCurrent ? 7 : 5;
        const display = room.displayName ?? room.id.replace(/-/g, " ");
        return (
          <g key={room.id} transform={`translate(${pos.x} ${pos.y})`}>
            <title>
              {display}
              {isCurrent
                ? " (here)"
                : isVisited
                  ? " (visited)"
                  : " (unknown)"}
            </title>
            <circle
              r={r}
              fill={
                isCurrent
                  ? "currentColor"
                  : isVisited
                    ? "currentColor"
                    : "transparent"
              }
              fillOpacity={isCurrent ? 0.85 : isVisited ? 0.25 : 0}
              stroke="currentColor"
              strokeWidth={isCurrent ? 1.5 : 1}
              strokeDasharray={isVisited ? undefined : "1.5 1.5"}
            />
            {/* Unknown room glyph: a small "?" centered. */}
            {!isVisited && !isCurrent && (
              <text
                y={1.5}
                fontSize={4}
                fill="currentColor"
                fillOpacity={0.5}
                textAnchor="middle"
              >
                ?
              </text>
            )}
            {/* Player marker: place the form avatar in the current
                room. The avatar's currentColor inherits via the
                <g>'s color, but we want a contrasting stroke so
                the glyph reads against the filled circle — render
                it in the form-accent-bg style by inverting. */}
            {isCurrent && (
              <g
                transform="translate(-3 -3)"
                style={{ color: "rgb(15 23 42)" }} // slate-900
              >
                <Avatar formId={formId} size={6} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
