/**
 * Phase 5 Day 25: Buy/sell loop end-to-end.
 *
 * Verifies the full economic gradient works: a fresh player can
 * gather raw ore, smelt it into ingots, and sell those ingots to
 * a vendor for net coin gain. Each step rides through the actual
 * tool validator + DB writers (coins + craftCredits).
 *
 * Exercises every Day 18-24 piece in sequence: trade_with_npc
 * (sell), gather_resource, craft_recipe, learn_skill_from,
 * coin balance + craft credit consumption.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { sessions, users, userSkills } from "@/lib/db/schema";
import { applyCoinDelta, getCoins } from "@/lib/economy/coins";
import { learnSkill } from "@/lib/economy/skills";
import { utcDateString } from "@/lib/energy/streak";
import { readLog, rowToEvent } from "@/lib/game/events";
import { applyEvents, initialProjection } from "@/lib/game/projection";
import { applyTools } from "@/lib/game/tools";
import type {
  FormTemplate,
  LocationTemplate,
  Projection,
  Event,
} from "@/lib/game/types";
import { uuidv7 } from "@/lib/util/uuidv7";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1 },
  verbs: ["gather", "craft", "trade"],
  verbMappings: {
    gather: { tools: ["gather_resource"], rollStat: null },
    craft: { tools: ["craft_recipe"], rollStat: null },
    trade: { tools: ["trade_with_npc"], rollStat: null },
  },
};

const LOC: LocationTemplate = {
  id: "iron-reach",
  entryRoomId: "main",
  rooms: [{ id: "main", exits: [] }],
};

let client: postgres.Sql;
let db: ReturnType<typeof drizzle>;
let sessionId: string;
let userId: string;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, { max: 1, onnotice: () => {} });
  db = drizzle(client);
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE user_skills, memories, entities, projections, events, sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    email: `e${userId}@x.com`,
    username: `e${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    energy: 20,
    energyUpdatedAt: now,
    coins: 200,
    craftCredits: 10,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
  });
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
  });
});

describe("Phase 5 Day 25: full economic loop", () => {
  test("learn → gather → smelt → sell yields net coin gain", async () => {
    // Step 0: a vendor + a smelting trainer are in scene (the
    // narrator would normally introduce them via introduce_npc;
    // we shortcut by writing the projection state directly via
    // applyEvents on a synthetic batch, then running tools off
    // it).
    let projection: Projection = initialProjection({
      sessionId,
      form: FORM,
      location: LOC,
    });
    projection = applyEvents(projection, [
      {
        kind: "npc.introduced",
        npcId: "tutorial-vendor-aabbccdd",
        data: {
          name: "Old Veft",
          relationship: 1,
          templateId: "tutorial-vendor",
        },
      },
      {
        kind: "npc.introduced",
        npcId: "old-vassi-of-the-furnace-bbccddee",
        data: {
          name: "Old Vassi",
          relationship: 1,
          templateId: "old-vassi-of-the-furnace",
        },
      },
    ] as Event[]);

    const before = await getCoins(db, { userId });
    expect(before).toBe(200);

    // Step 1: learn smelting from Old Vassi (80 coins).
    {
      const r = await applyTools(
        db,
        sessionId,
        projection,
        [
          {
            name: "learn_skill_from",
            npcId: "old-vassi-of-the-furnace-bbccddee",
          },
        ],
        {
          form: FORM,
          location: LOC,
          intent: "learn",
          rollBand: "success",
          currentCoins: before,
          knownSkills: new Set(),
        },
      );
      expect(r.ok).toBe(true);
    }
    // Apply the user_skills + coins side effects manually (turn.ts
    // does this in the orchestrator; here we do it inline for the
    // integration of the lower-level pieces).
    await learnSkill(db, userId, "smelting", "old-vassi-of-the-furnace-bbccddee");
    await applyCoinDelta(db, { userId }, -80);
    expect(await getCoins(db, { userId })).toBe(120);

    // Step 2: gather 4 iron-ore over multiple turns. Each gather
    // rolls 1-3 ore from a deterministic seed; we run repeatedly
    // until we have at least 4. With seed=1..N this terminates
    // reliably within ~3 calls.
    let oreCount = 0;
    for (let t = 1; t < 8 && oreCount < 4; t++) {
      const r = await applyTools(
        db,
        sessionId,
        projection,
        [{ name: "gather_resource", resourceId: "iron-ore" }],
        {
          form: FORM,
          location: LOC,
          intent: "gather",
          rollBand: "success",
          currentCoins: await getCoins(db, { userId }),
          turnSeed: t,
        },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        const events = r.events.map((e) => e.event);
        const gathered = events.find((e) => e.kind === "craft.gathered");
        if (gathered?.kind === "craft.gathered") {
          oreCount += gathered.qty;
        }
        // Apply to projection so subsequent calls see the inventory.
        projection = applyEvents(projection, events as Event[]);
      }
    }
    expect(oreCount).toBeGreaterThanOrEqual(4);

    // Gather coal too (recipe needs 1 coal per ingot, 2 ingots = 2).
    let coalCount = 0;
    for (let t = 100; t < 110 && coalCount < 2; t++) {
      // collapsed-tunnel + iron-reach both list coal in resources.json.
      const r = await applyTools(
        db,
        sessionId,
        projection,
        [{ name: "gather_resource", resourceId: "coal" }],
        {
          form: FORM,
          location: LOC,
          intent: "gather",
          rollBand: "success",
          currentCoins: await getCoins(db, { userId }),
          turnSeed: t,
        },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        const events = r.events.map((e) => e.event);
        const gathered = events.find((e) => e.kind === "craft.gathered");
        if (gathered?.kind === "craft.gathered") {
          coalCount += gathered.qty;
        }
        projection = applyEvents(projection, events as Event[]);
      }
    }
    expect(coalCount).toBeGreaterThanOrEqual(2);

    // Step 3: smelt 2 iron-ingot (consumes 4 ore + 2 coal).
    for (let i = 0; i < 2; i++) {
      const r = await applyTools(
        db,
        sessionId,
        projection,
        [{ name: "craft_recipe", recipeId: "smelt-iron-ingot" }],
        {
          form: FORM,
          location: LOC,
          intent: "craft",
          rollBand: "success",
          currentCoins: await getCoins(db, { userId }),
          skillLevels: { smelting: 1 },
        },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        projection = applyEvents(projection, r.events.map((e) => e.event) as Event[]);
      }
    }
    const ingotEntry = projection.inventory.find((i) => i.itemId === "iron-ingot");
    expect(ingotEntry?.qty).toBe(2);

    // Step 4: sell both ingots to Old Veft. Vendor sellPrice is 18
    // each (catalog), so net gain is 36.
    const beforeSell = await getCoins(db, { userId });
    {
      const r = await applyTools(
        db,
        sessionId,
        projection,
        [
          {
            name: "trade_with_npc",
            npcId: "tutorial-vendor-aabbccdd",
            action: "sell",
            itemId: "iron-ingot",
            qty: 2,
          },
        ],
        {
          form: FORM,
          location: LOC,
          intent: "trade",
          rollBand: "success",
          currentCoins: beforeSell,
        },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        const events = r.events.map((e) => e.event);
        const trade = events.find((e) => e.kind === "trade.completed");
        if (trade?.kind === "trade.completed") {
          expect(trade.coinsDelta).toBe(36); // 18 × 2
          await applyCoinDelta(db, { userId }, trade.coinsDelta);
        }
        projection = applyEvents(projection, events as Event[]);
      }
    }
    const after = await getCoins(db, { userId });
    expect(after).toBe(beforeSell + 36);
    // Net across the whole session: started 200, paid 80 trainer,
    // earned 36 from sale → 156. We didn't pay for ore or coal
    // (gathered free).
    expect(after).toBe(200 - 80 + 36);

    // Inventory: ingots gone; ore + coal partial leftovers OK
    // (they're free gathers).
    expect(
      projection.inventory.find((i) => i.itemId === "iron-ingot"),
    ).toBeUndefined();

    // Skill row exists for smelting.
    const skills = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.userId, userId));
    expect(skills.length).toBe(1);
    expect(skills[0].skillId).toBe("smelting");

    // Event log contains the major audit events.
    const log = (await readLog(db, sessionId)).map(rowToEvent);
    const kinds = log.map((e) => e.kind);
    expect(kinds).toContain("craft.gathered");
    expect(kinds).toContain("craft.completed");
    expect(kinds).toContain("trade.completed");
  });
});
