/**
 * Registers — DB integration covering the five aggregations
 * (wyrm-fed / starved / chronicle / refused / recurring).
 *
 * The aggregator is pure SQL; these tests seed minimal fixtures
 * and assert ranking + value formatting.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  campaigns,
  metaContributions,
  users,
  worldLore,
  worldNpcs,
} from "@/lib/db/schema";
import { utcDateString } from "@/lib/energy/streak";
import {
  getAllRegisters,
  getChronicleRegister,
  getRecurringNpcRegisters,
  getRefusedRegister,
  getWyrmFedRegister,
  getWyrmStarvedRegister,
} from "@/lib/registers/aggregate";
import { LONG_WYRM_ID } from "@/lib/meta/long-wyrm";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;

async function makeUser(username: string): Promise<string> {
  const id = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id,
    email: `${username}@x.com`,
    username,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
    coins: 0,
  });
  // Read-back barrier for the postgres-js / WSL Drizzle visibility
  // race documented on the npc-letters seeder integration test.
  await client`SELECT 1 FROM users WHERE id = ${id}`;
  return id;
}

async function ensureWyrmArc() {
  await client`
    INSERT INTO meta_arcs (id, progress, phase, phase_label)
    VALUES (${LONG_WYRM_ID}, 0, 'stirring', 'Stirring')
    ON CONFLICT DO NOTHING
  `;
}

async function contribute(
  userId: string,
  delta: number,
  reason = "test",
): Promise<void> {
  await db.insert(metaContributions).values({
    id: uuidv7(),
    arcId: LONG_WYRM_ID,
    userId,
    delta,
    reason,
  });
}

async function chronicle(userId: string, summary: string): Promise<void> {
  await db.insert(worldLore).values({
    id: uuidv7(),
    summary,
    salience: 0.7,
    sourceUserId: userId,
    adminRedacted: false,
  });
}

async function finishCampaign(
  userId: string,
  formId: string,
  status: "completed" | "abandoned" = "completed",
): Promise<void> {
  await db.insert(campaigns).values({
    id: uuidv7(),
    userId,
    title: "test",
    formId,
    locationId: "collapsed-tunnel",
    status,
  });
}

async function meetNpc(
  userId: string,
  slug: string,
  timesMet: number,
  relationshipScore = 0,
): Promise<void> {
  await db.insert(worldNpcs).values({
    id: uuidv7(),
    userId,
    slug,
    name: slug,
    timesMet,
    relationshipScore,
    isRecurring: true,
    data: { displayName: slug },
  });
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, { max: 1, onnotice: () => {} });
  db = drizzle(client) as unknown as Db;
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE world_lore, world_npcs, meta_contributions, meta_arcs, campaigns, users RESTART IDENTITY CASCADE",
  );
  await ensureWyrmArc();
});

describe("getWyrmFedRegister", () => {
  test("orders users by sum of positive deltas", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    const c = await makeUser("carl");
    await contribute(a, 5);
    await contribute(a, 2);
    await contribute(b, 4);
    await contribute(c, -3);
    const reg = await getWyrmFedRegister(db, 10);
    const usernames = reg.map((r) => r.username);
    expect(usernames).toEqual(["alice", "bob"]);
    expect(reg[0]).toMatchObject({
      rank: 1,
      username: "alice",
      value: 7,
      formattedValue: "+7 fed",
    });
    expect(reg[1]).toMatchObject({
      rank: 2,
      username: "bob",
      value: 4,
      formattedValue: "+4 fed",
    });
  });

  test("excludes users with only negative contributions", async () => {
    const a = await makeUser("alice");
    await contribute(a, -3);
    const reg = await getWyrmFedRegister(db);
    expect(reg).toHaveLength(0);
  });
});

describe("getWyrmStarvedRegister", () => {
  test("orders users by sum of negative deltas (most-negative first)", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await contribute(a, -2);
    await contribute(a, -3);
    await contribute(b, -1);
    await contribute(b, 4);
    const reg = await getWyrmStarvedRegister(db);
    expect(reg.map((r) => r.username)).toEqual(["alice", "bob"]);
    expect(reg[0].formattedValue).toBe("-5 starved");
    expect(reg[1].formattedValue).toBe("-1 starved");
  });
});

describe("getChronicleRegister", () => {
  test("counts non-redacted lore rows per user", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await chronicle(a, "alice did a thing");
    await chronicle(a, "alice did another thing");
    await chronicle(a, "and a third");
    await chronicle(b, "bob did a thing");
    const reg = await getChronicleRegister(db);
    expect(reg.map((r) => r.username)).toEqual(["alice", "bob"]);
    expect(reg[0].formattedValue).toBe("3 entries");
    expect(reg[1].formattedValue).toBe("1 entry");
  });

  test("excludes admin-redacted rows", async () => {
    const a = await makeUser("alice");
    await chronicle(a, "ok");
    // Now redact alice's only entry.
    await client`UPDATE world_lore SET admin_redacted = true WHERE source_user_id = ${a}`;
    const reg = await getChronicleRegister(db);
    expect(reg).toHaveLength(0);
  });
});

describe("getRefusedRegister", () => {
  test("counts forsaken-revenant + the-still-one finished campaigns per user", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    await finishCampaign(a, "forsaken-revenant");
    await finishCampaign(a, "the-still-one");
    await finishCampaign(b, "forsaken-revenant");
    await finishCampaign(b, "lesser-slime"); // shouldn't count
    const reg = await getRefusedRegister(db);
    expect(reg.map((r) => r.username)).toEqual(["alice", "bob"]);
    expect(reg[0].formattedValue).toBe("2 refusals");
    expect(reg[1].formattedValue).toBe("1 refusal");
  });

  test("excludes still-active runs", async () => {
    const a = await makeUser("alice");
    await db.insert(campaigns).values({
      id: uuidv7(),
      userId: a,
      title: "live",
      formId: "forsaken-revenant",
      locationId: "x",
      status: "active",
    });
    const reg = await getRefusedRegister(db);
    expect(reg).toHaveLength(0);
  });
});

describe("getRecurringNpcRegisters", () => {
  test("groups by NPC slug, top-3 players per slug", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    const c = await makeUser("carl");
    const d = await makeUser("dee");
    await meetNpc(a, "rhozell", 5, 2);
    await meetNpc(b, "rhozell", 3, 1);
    await meetNpc(c, "rhozell", 1, -1);
    await meetNpc(d, "rhozell", 1, 0);
    await meetNpc(a, "captain-mira", 2);
    const reg = await getRecurringNpcRegisters(db);
    const rhozell = reg.find((e) => e.npcSlug === "rhozell");
    expect(rhozell).toBeDefined();
    expect(rhozell!.topPlayers).toHaveLength(3);
    expect(rhozell!.topPlayers[0].username).toBe("alice");
    expect(rhozell!.topPlayers[0].formattedValue).toBe("5 meetings");
    expect(rhozell!.topPlayers[0].context).toBe("relationship +2");
  });

  test("returns empty list when no recurring NPCs are tracked", async () => {
    const a = await makeUser("alice");
    await db.insert(worldNpcs).values({
      id: uuidv7(),
      userId: a,
      slug: "anon",
      name: "anon",
      timesMet: 1,
      relationshipScore: 0,
      isRecurring: false,
      data: {},
    });
    const reg = await getRecurringNpcRegisters(db);
    expect(reg).toEqual([]);
  });
});

describe("getAllRegisters", () => {
  test("returns all five registers in one call", async () => {
    const a = await makeUser("alice");
    await contribute(a, 5);
    await chronicle(a, "x");
    await finishCampaign(a, "the-still-one");
    await meetNpc(a, "rhozell", 4);
    const all = await getAllRegisters(db);
    expect(all.wyrmFed.length).toBe(1);
    expect(all.wyrmStarved.length).toBe(0);
    expect(all.chronicle.length).toBe(1);
    expect(all.refused.length).toBe(1);
    expect(all.recurring.length).toBe(1);
    expect(all.recurring[0].npcSlug).toBe("rhozell");
  });
});
