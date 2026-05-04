/**
 * Pin the four threat-themed NPC templates so a future content
 * refactor can't silently break them. The narrator's form-specific
 * hard-moves reference these IDs — if they get renamed, deleted, or
 * lose required fields, the runtime path to introducing them must
 * fail fast (CI), not at 2am after a deploy.
 *
 * Three layers of coverage:
 * 1. Each templateId resolves to a JSON file under content/npcs/.
 * 2. Each file has the minimum shape the runtime expects (id, name,
 *    optional vitals/stats fields used by introduce_npc).
 * 3. validateToolsToEvents accepts an introduce_npc call for each.
 *
 * The negative case (unknown templateId rejected) lives in
 * tool-validation.test.ts; this is the positive pin.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { validateToolsToEvents } from "@/lib/game/tools";
import type { Projection, ToolCall } from "@/lib/game/types";

const THREAT_NPCS = [
  "ambient-threat",
  "patrol-presence",
  "warped-minion",
  "wrong-reader",
] as const;

function fakeProjection(): Projection {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    upToSeq: 0,
    form: {
      id: "lesser-slime",
      vitals: { cohesion: 8 },
      vitalsMax: { cohesion: 8 },
      vitalsDeath: { cohesion: 0 },
      stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
      state: {},
    },
    location: { id: "collapsed-tunnel", roomId: "x", discovered: ["x"] },
    inventory: [],
    npcs: {},
    quest: { id: null, objectives: {} },
    xp: 0,
    turn: 1,
    status: "active",
    reincarnatedAs: null,
  };
}

describe("threat NPC templates pinned", () => {
  for (const slug of THREAT_NPCS) {
    test(`content/npcs/${slug}.json exists and has matching id`, () => {
      const path = join(process.cwd(), "content", "npcs", `${slug}.json`);
      expect(existsSync(path)).toBe(true);
      const json = JSON.parse(readFileSync(path, "utf8"));
      expect(json.id).toBe(slug);
      expect(typeof json.displayName).toBe("string");
      expect(json.displayName.length).toBeGreaterThan(0);
    });

    test(`introduce_npc(${slug}) passes precondition validation`, () => {
      const tools: ToolCall[] = [
        {
          name: "introduce_npc",
          templateId: slug,
          attitude: -1,
        },
      ];
      const result = validateToolsToEvents({
        tools,
        projection: fakeProjection(),
        intent: "ooze",
        rollBand: "miss",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const introduced = result.events.find(
          (e) => e.kind === "npc.introduced",
        );
        expect(introduced).toBeDefined();
        // The templateId is preserved on the event's data.
        if (introduced && introduced.kind === "npc.introduced") {
          expect(introduced.data?.templateId).toBe(slug);
        }
      }
    });
  }
});
