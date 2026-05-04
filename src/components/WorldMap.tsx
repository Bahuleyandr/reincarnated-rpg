"use client";

/**
 * WorldMap — SVG map of the five spokes + metropolis. Each
 * city node is clickable and routes to /world/[id]. Designed
 * to match the ASCII map's geometry: N is Highfield, E is
 * Saltgale, W is Long Indices, SE is Threadwarden, SW is the
 * Coral Anchorage. Caelum sits at center.
 *
 * Self-contained — no external icon library, just SVG primitives
 * + Tailwind classes for hover states.
 */
import Link from "next/link";

interface NodeSpec {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: "metropolis" | "homeland" | "town";
}

const NODES: NodeSpec[] = [
  // metropolis at center
  { id: "caelum-by-the-wash", label: "Caelum", x: 250, y: 250, kind: "metropolis" },

  // N spoke
  { id: "three-notches", label: "Three Notches", x: 250, y: 200, kind: "town" },
  { id: "coldspoon", label: "Coldspoon", x: 250, y: 150, kind: "town" },
  { id: "highfield-ascending", label: "Highfield", x: 250, y: 90, kind: "homeland" },

  // E spoke
  { id: "mudmoth", label: "Mudmoth", x: 320, y: 250, kind: "town" },
  { id: "tallowfen", label: "Tallowfen", x: 380, y: 250, kind: "town" },
  { id: "saltgale", label: "Saltgale", x: 450, y: 250, kind: "homeland" },

  // W spoke
  { id: "cataract-mile", label: "Cataract Mile", x: 180, y: 250, kind: "town" },
  { id: "quietmile", label: "Quietmile", x: 120, y: 250, kind: "town" },
  { id: "the-long-indices", label: "Long Indices", x: 50, y: 250, kind: "homeland" },

  // SE spoke (humans inland)
  { id: "furrowmouth", label: "Furrowmouth", x: 280, y: 310, kind: "town" },
  { id: "knots-landing", label: "Knot's Landing", x: 305, y: 360, kind: "town" },
  { id: "threadwarden", label: "Threadwarden", x: 330, y: 420, kind: "homeland" },

  // SW spoke (halflings offshore)
  { id: "briny-bell", label: "Briny Bell", x: 220, y: 310, kind: "town" },
  { id: "crab-by-crab", label: "Crab-by-Crab", x: 195, y: 360, kind: "town" },
  { id: "the-coral-anchorage", label: "Coral Anchorage", x: 170, y: 420, kind: "homeland" },
];

const EDGES: Array<[string, string]> = [
  // N
  ["caelum-by-the-wash", "three-notches"],
  ["three-notches", "coldspoon"],
  ["coldspoon", "highfield-ascending"],
  // E
  ["caelum-by-the-wash", "mudmoth"],
  ["mudmoth", "tallowfen"],
  ["tallowfen", "saltgale"],
  // W
  ["caelum-by-the-wash", "cataract-mile"],
  ["cataract-mile", "quietmile"],
  ["quietmile", "the-long-indices"],
  // SE
  ["caelum-by-the-wash", "furrowmouth"],
  ["furrowmouth", "knots-landing"],
  ["knots-landing", "threadwarden"],
  // SW
  ["caelum-by-the-wash", "briny-bell"],
  ["briny-bell", "crab-by-crab"],
  ["crab-by-crab", "the-coral-anchorage"],
];

const KIND_STYLE: Record<NodeSpec["kind"], { r: number; fill: string }> = {
  metropolis: { r: 10, fill: "#fbbf24" },
  homeland: { r: 8, fill: "#a78bfa" },
  town: { r: 4, fill: "#94a3b8" },
};

export function WorldMap() {
  const byId = new Map(NODES.map((n) => [n.id, n]));
  return (
    <svg
      viewBox="0 0 500 480"
      className="w-full max-w-2xl mx-auto bg-stone-950 border border-stone-800"
      role="img"
      aria-label="map of the five spokes and the metropolis"
    >
      {/* Edges first so they sit underneath */}
      {EDGES.map(([fromId, toId]) => {
        const f = byId.get(fromId);
        const t = byId.get(toId);
        if (!f || !t) return null;
        // SW spoke between Crab-by-Crab and Coral Anchorage is
        // the tide causeway — render with dashed stroke.
        const isCauseway = fromId === "crab-by-crab" && toId === "the-coral-anchorage";
        return (
          <line
            key={`${fromId}-${toId}`}
            x1={f.x}
            y1={f.y}
            x2={t.x}
            y2={t.y}
            stroke="#44403c"
            strokeWidth={1.5}
            strokeDasharray={isCauseway ? "4 3" : undefined}
          />
        );
      })}
      {/* Compass rose at center under the Caelum node */}
      <text x={250} y={262} textAnchor="middle" fontSize={6} fill="#57534e">
        ◇
      </text>
      {/* Direction labels at the canvas edges */}
      <text x={250} y={20} textAnchor="middle" fontSize={9} fill="#57534e">
        N
      </text>
      <text x={250} y={470} textAnchor="middle" fontSize={9} fill="#57534e">
        S (coast)
      </text>
      <text x={20} y={250} textAnchor="middle" fontSize={9} fill="#57534e">
        W
      </text>
      <text x={485} y={250} textAnchor="middle" fontSize={9} fill="#57534e">
        E
      </text>
      {/* Nodes */}
      {NODES.map((n) => {
        const style = KIND_STYLE[n.kind];
        const labelOffsetY = n.y < 250 ? -10 : n.y > 350 ? 16 : 0;
        const labelOffsetX = n.x > 350 ? 12 : n.x < 150 ? -12 : 0;
        const anchor =
          n.x > 350 ? "start" : n.x < 150 ? "end" : "middle";
        return (
          <Link key={n.id} href={`/world/${n.id}`}>
            <g className="cursor-pointer hover:opacity-80">
              <circle
                cx={n.x}
                cy={n.y}
                r={style.r}
                fill={style.fill}
                opacity={0.9}
                stroke="#1c1917"
                strokeWidth={1}
              />
              <text
                x={n.x + labelOffsetX}
                y={n.y + labelOffsetY}
                textAnchor={anchor}
                fontSize={n.kind === "metropolis" ? 11 : n.kind === "homeland" ? 10 : 8}
                fontFamily="ui-monospace, monospace"
                fill={n.kind === "town" ? "#a8a29e" : "#e7e5e4"}
              >
                {n.label}
              </text>
            </g>
          </Link>
        );
      })}
    </svg>
  );
}
