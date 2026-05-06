/**
 * MapView builder — POLISH_PLAN G.2.
 *
 * Pure helper that distills a LocationTemplate into the minimum
 * shape the <MapPanel> component needs:
 *
 *   - entry room id (anchor for the ring layout)
 *   - per-room id + optional displayName + exit list
 *   - exit list is normalised to undirected pairs (toRoomId only)
 *
 * No coordinates here — layout is the renderer's concern. This
 * keeps the API payload small and the component free to relayout
 * (for a future force-directed view, or per-form-flavored layouts).
 */
import type { LocationTemplate } from "./types";

export interface MapViewRoom {
  id: string;
  /** Optional human-readable name from the location JSON. */
  displayName?: string;
  /** Other rooms reachable from this room. Verb-stripped — the
   *  map cares only about adjacency. Deduplicated. */
  exits: string[];
}

export interface MapView {
  /** Location id this map describes. */
  locationId: string;
  /** Room the player wakes in (or the location's default entry).
   *  Anchors ring layouts. */
  entryRoomId: string;
  rooms: MapViewRoom[];
}

export function buildMapView(loc: LocationTemplate): MapView {
  const rooms: MapViewRoom[] = loc.rooms.map((r) => {
    const exits = Array.from(
      new Set(r.exits.map((e) => e.toRoomId)),
    );
    const withName = r as { id: string; displayName?: string };
    return {
      id: r.id,
      displayName: withName.displayName,
      exits,
    };
  });
  return {
    locationId: loc.id,
    entryRoomId: loc.entryRoomId,
    rooms,
  };
}

/**
 * Compute SVG positions for each room. Used by <MapPanel> at render
 * time and by tests to verify layout determinism.
 *
 * Layout:
 *   - Single room → centered.
 *   - Two rooms → horizontal pair (left = entry, right = other).
 *   - Three+ rooms → entry at center, others on a ring.
 *
 * Coordinates are in a 100×100 canvas so the renderer can scale
 * to any pixel size via SVG viewBox without recomputing.
 */
export function layoutMapView(
  view: MapView,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const center = { x: 50, y: 50 };
  const radius = 32;

  if (view.rooms.length === 0) return positions;
  if (view.rooms.length === 1) {
    positions.set(view.rooms[0].id, center);
    return positions;
  }
  if (view.rooms.length === 2) {
    // Entry on the left, other on the right.
    const others = view.rooms.filter((r) => r.id !== view.entryRoomId);
    positions.set(view.entryRoomId, { x: 30, y: 50 });
    positions.set(others[0].id, { x: 70, y: 50 });
    return positions;
  }

  // 3+ rooms: entry at center, others on a ring at fixed step.
  positions.set(view.entryRoomId, center);
  const others = view.rooms.filter((r) => r.id !== view.entryRoomId);
  // Sort others by id so the layout is deterministic regardless of
  // JSON file ordering — important for tests + for stable visuals.
  others.sort((a, b) => a.id.localeCompare(b.id));
  const step = (2 * Math.PI) / others.length;
  // Start at the top (12 o'clock) so single-pair locations look
  // natural and 3-room sets form a triangle pointing up.
  const startAngle = -Math.PI / 2;
  others.forEach((r, i) => {
    const angle = startAngle + i * step;
    positions.set(r.id, {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  });
  return positions;
}
