"use client";

/**
 * OverworldMap — POLISH_PLAN G.3a Tier 3.
 *
 * Stylized cartographic view of the 22 named locations: the
 * estuary metropolis Caelum-by-the-Wash at the center, five
 * race-themed spokes radiating outward, six wilderness nodes
 * around the periphery. Spokes are connected by drawn roads;
 * outer nodes are isolated.
 *
 * Render strategy:
 *   - Tinted radial-gradient backdrop for each spoke (one per
 *     biome, reading as terrain).
 *   - Spoke roads as soft solid lines.
 *   - Each location as a labeled circle. The player's current
 *     location renders the form's avatar inside the node and
 *     pulses a subtle ring.
 *   - Compass-rose marker over caelum.
 *
 * Click handling is left to the parent (`onPickLocation` prop) so
 * this component can be used both as a static map and as a
 * future "fast travel" UI.
 *
 * Accessibility:
 *   - role="img" with aria-label summarising the location count.
 *   - Each node has a <title> for hover labelling.
 */
import type { WorldMap, WorldNode } from "@/lib/world/world-map";
import { Avatar } from "@/components/Avatar";

interface Props {
  map: WorldMap;
  /** Player's current location id. Renders the avatar inside the
   *  matching node and elevates it visually. */
  currentLocationId?: string | null;
  /** Form id for the player's avatar marker. */
  formId?: string | null;
  /** Locations the player has been to. Visited nodes render solid;
   *  unvisited render as a faint outline + "?" — the world is
   *  fogged-of-war until you've seen it. */
  visitedLocationIds?: string[];
  /** Pixel size of the rendered SVG width. Default 360. */
  size?: number;
  className?: string;
  /** Optional click handler for jump-to-location UI. */
  onPickLocation?: (locationId: string) => void;
}

const BIOME_COLORS: Record<WorldNode["biome"], { fill: string; stroke: string }> = {
  metropolis: { fill: "#92400e", stroke: "#f59e0b" }, // amber
  north: { fill: "#1e293b", stroke: "#7dd3fc" }, // sky / cloudline
  east: { fill: "#1e1b4b", stroke: "#a5b4fc" }, // indigo / mudflats
  west: { fill: "#3f3f46", stroke: "#fde68a" }, // amber-tinted plateau
  southeast: { fill: "#3f3f46", stroke: "#a3a3a3" }, // craft compounds
  southwest: { fill: "#0c4a6e", stroke: "#67e8f9" }, // cyan / reef sea
  outer: { fill: "#1c1917", stroke: "#a8a29e" }, // stone — wilderness
};

export function OverworldMap({
  map,
  currentLocationId,
  formId,
  visitedLocationIds,
  size = 360,
  className,
  onPickLocation,
}: Props) {
  const visited = new Set(visitedLocationIds ?? []);
  if (currentLocationId) visited.add(currentLocationId);

  const aspect = map.viewBox.height / map.viewBox.width;
  const height = Math.round(size * aspect);

  // Build the spoke-edge list for drawing. Each non-metropolis
  // spoke node has exactly one edgesTo target.
  const edges: Array<{ a: WorldNode; b: WorldNode }> = [];
  const byId = new Map(map.nodes.map((n) => [n.locationId, n]));
  for (const node of map.nodes) {
    for (const targetId of node.edgesTo) {
      const target = byId.get(targetId);
      if (target) edges.push({ a: node, b: target });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${map.viewBox.width} ${map.viewBox.height}`}
      width={size}
      height={height}
      role="img"
      aria-label={`world atlas — ${map.nodes.length} locations across five spokes`}
      className={className}
    >
      <defs>
        {/* Radial gradient backdrop — gives the map a sense of
            distance as it fades from center outward. */}
        <radialGradient id="overworld-bg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#1a1a17" />
          <stop offset="100%" stopColor="#0a0a08" />
        </radialGradient>
      </defs>

      {/* Backdrop. */}
      <rect
        x="0"
        y="0"
        width={map.viewBox.width}
        height={map.viewBox.height}
        fill="url(#overworld-bg)"
      />

      {/* Spoke roads. Drawn first so they're behind the nodes. */}
      {edges.map((e, i) => (
        <line
          key={`edge-${i}`}
          x1={e.a.x}
          y1={e.a.y}
          x2={e.b.x}
          y2={e.b.y}
          stroke="#78716c"
          strokeOpacity="0.45"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="0"
        />
      ))}

      {/* Compass rose at caelum (subtle hint of cardinal directions). */}
      <g transform={`translate(${map.center.x} ${map.center.y})`} opacity="0.25">
        {(
          [
            { angle: -Math.PI / 2 }, // N
            { angle: 0 }, // E
            { angle: Math.PI / 2 }, // S
            { angle: Math.PI }, // W
          ] as const
        ).map((d, i) => {
          const len = 24;
          return (
            <line
              key={`rose-${i}`}
              x1={0}
              y1={0}
              x2={Math.cos(d.angle) * len}
              y2={Math.sin(d.angle) * len}
              stroke="#fde68a"
              strokeWidth="1.5"
            />
          );
        })}
      </g>

      {/* Nodes. */}
      {map.nodes.map((node) => {
        const isCurrent = node.locationId === currentLocationId;
        const isVisited = visited.has(node.locationId);
        const colors = BIOME_COLORS[node.biome];
        const r = isCurrent ? 26 : 20;

        return (
          <g
            key={node.locationId}
            transform={`translate(${node.x} ${node.y})`}
            onClick={onPickLocation ? () => onPickLocation(node.locationId) : undefined}
            style={{ cursor: onPickLocation ? "pointer" : "default" }}
          >
            <title>
              {node.displayName}
              {isCurrent
                ? " — you are here"
                : isVisited
                  ? " — visited"
                  : " — unknown"}
            </title>

            {/* Backdrop circle. */}
            <circle
              r={r}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={isCurrent ? 3 : 2}
              fillOpacity={isVisited ? 0.95 : 0.4}
              strokeOpacity={isVisited ? 1 : 0.6}
              strokeDasharray={isVisited ? undefined : "4 3"}
            />

            {/* Avatar inside the current node. */}
            {isCurrent && formId && (
              <g
                transform="translate(-15 -15)"
                style={{ color: colors.stroke }}
              >
                <Avatar formId={formId} size={30} />
              </g>
            )}

            {/* Unknown-location glyph. */}
            {!isVisited && !isCurrent && (
              <text
                y={6}
                fontSize={20}
                fill={colors.stroke}
                fillOpacity="0.7"
                textAnchor="middle"
              >
                ?
              </text>
            )}

            {/* Label below the node. Larger fontSize for legibility
                at the typical mobile rendered width — at 360px wide
                the 1000-unit viewBox scales 1 unit ≈ 0.36 device px,
                so fontSize 26 → ~9 device px (still small but legible).
                Mobile UX (POLISH_PLAN Day 67). */}
            <text
              y={r + 26}
              fontSize={26}
              fill={isVisited ? "#e7e5e4" : "#a8a29e"}
              fontWeight={isCurrent ? 700 : 500}
              textAnchor="middle"
            >
              {node.displayName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
