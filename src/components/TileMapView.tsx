"use client";

/**
 * TileMapView — POLISH_PLAN G.3b/G.3c Tier 3.
 *
 * Renders an authored tile-map (content/tile-maps/<locationId>.json)
 * as an SVG grid. Each tile is a <rect> with the legend's fill
 * color, optionally with a glyph atop it. The player's avatar
 * is placed at the room's authored anchor.
 *
 * Visited / unvisited state is indicated per ROOM (not per tile)
 * since the orchestrator tracks discovery at room granularity:
 *   - tiles inside an unvisited room are dimmed by a 60% opacity
 *     overlay rect
 *   - tiles inside the current room are unmodified (full color)
 *   - tiles inside visited-but-not-current rooms are unmodified
 *
 * Tile size is computed from the desired pixel width; the SVG
 * keeps a square aspect per tile so the grid never distorts.
 */
import type { TileMap } from "@/lib/world/tile-map";
import { Avatar } from "@/components/Avatar";

interface Props {
  map: TileMap;
  /** Room id the player is currently in. */
  currentRoomId: string;
  /** Form id for the avatar marker. */
  formId: string;
  /** Visited room ids — used for fog-of-war dimming on a per-room
   *  basis. Defaults to just the currentRoomId. */
  discoveredRoomIds?: string[];
  /** Pixel size of the rendered SVG WIDTH. The renderer auto-sizes
   *  height to keep tiles square. Default 480. */
  size?: number;
  className?: string;
}

export function TileMapView({
  map,
  currentRoomId,
  formId,
  discoveredRoomIds,
  size = 480,
  className,
}: Props) {
  const tileSize = 32; // SVG units per tile (used inside viewBox)
  const viewW = map.width * tileSize;
  const viewH = map.height * tileSize;
  const aspect = viewH / viewW;
  const pixelHeight = Math.round(size * aspect);

  // Build per-tile room membership (so we can fog-of-war by room).
  // We approximate: the room a given tile belongs to is the
  // closest authored room anchor by Manhattan distance. This is
  // imperfect for awkwardly-shaped rooms but good enough for the
  // 16×12 PoC maps; future maps can encode room rectangles
  // explicitly.
  const tileRoom: string[][] = Array.from({ length: map.height }, () =>
    new Array<string>(map.width).fill(""),
  );
  const anchorEntries = Object.entries(map.roomAnchors);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      let bestId = "";
      let bestDist = Infinity;
      for (const [roomId, pos] of anchorEntries) {
        const d = Math.abs(pos.x - x) + Math.abs(pos.y - y);
        if (d < bestDist) {
          bestDist = d;
          bestId = roomId;
        }
      }
      tileRoom[y][x] = bestId;
    }
  }

  const visited = new Set(discoveredRoomIds ?? []);
  visited.add(currentRoomId);

  const playerAnchor = map.roomAnchors[currentRoomId];

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      width={size}
      height={pixelHeight}
      role="img"
      aria-label={`tile map of ${map.locationId}`}
      className={className}
      style={{ imageRendering: "pixelated" }}
    >
      {/* Tile fills first — base layer. */}
      {map.grid.flatMap((row, y) =>
        row.split("").map((ch, x) => {
          const tile = map.legend[ch];
          if (!tile) return null;
          return (
            <rect
              key={`t-${x}-${y}`}
              x={x * tileSize}
              y={y * tileSize}
              width={tileSize}
              height={tileSize}
              fill={tile.fill}
            />
          );
        }),
      )}

      {/* Tile glyphs — second layer, atop fills. */}
      {map.grid.flatMap((row, y) =>
        row.split("").map((ch, x) => {
          const tile = map.legend[ch];
          if (!tile?.glyph) return null;
          return (
            <text
              key={`g-${x}-${y}`}
              x={x * tileSize + tileSize / 2}
              y={y * tileSize + tileSize * 0.7}
              fontSize={tileSize * 0.6}
              fill="#000"
              fillOpacity="0.5"
              textAnchor="middle"
            >
              {tile.glyph}
            </text>
          );
        }),
      )}

      {/* Fog-of-war overlay — cover unvisited rooms with a dim
          rect. Per-tile to handle non-rectangular rooms cleanly. */}
      {tileRoom.flatMap((row, y) =>
        row.map((roomId, x) => {
          if (!roomId || visited.has(roomId)) return null;
          return (
            <rect
              key={`fog-${x}-${y}`}
              x={x * tileSize}
              y={y * tileSize}
              width={tileSize}
              height={tileSize}
              fill="#0a0a08"
              fillOpacity="0.7"
            />
          );
        }),
      )}

      {/* Current-room subtle highlight: a thin border around the
          tiles flagged as belonging to the current room. */}
      {tileRoom.flatMap((row, y) =>
        row.map((roomId, x) => {
          if (roomId !== currentRoomId) return null;
          return (
            <rect
              key={`hl-${x}-${y}`}
              x={x * tileSize}
              y={y * tileSize}
              width={tileSize}
              height={tileSize}
              fill="none"
              stroke="var(--form-accent)"
              strokeOpacity="0.25"
              strokeWidth="1"
            />
          );
        }),
      )}

      {/* Player avatar at the current room's anchor. */}
      {playerAnchor && (
        <g
          transform={`translate(${playerAnchor.x * tileSize - tileSize / 2} ${playerAnchor.y * tileSize - tileSize / 2})`}
          style={{ color: "var(--form-accent)" }}
        >
          <rect
            x={tileSize * 0.1}
            y={tileSize * 0.1}
            width={tileSize * 1.8}
            height={tileSize * 1.8}
            rx={tileSize * 0.4}
            fill="#0a0a08"
            fillOpacity="0.9"
            stroke="currentColor"
            strokeWidth="2"
          />
          <g transform={`translate(${tileSize * 0.5} ${tileSize * 0.5})`}>
            <Avatar formId={formId} size={tileSize * 1.0} />
          </g>
        </g>
      )}
    </svg>
  );
}
