/**
 * In-run companions (Roadmap 64) — DB integration.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

import {
  COMPANION_HP_BASE,
  COMPANION_HP_PER_LEVEL,
  COMPANION_MAX_LEVEL,
  damageCompanion,
  healCompanion,
  levelUpAlive,
  listInRunCompanions,
  summonCompanion,
} from "@/lib/companions/in-run";
import type { Db } from "@/lib/db/client";
import {
  sessionCompanions,
  sessions,
  users,
  worldNpcs,
} from "@/lib/db/schema";
import { utcDateString } from "@/lib/energy/streak";
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
  return id;
}

async function makeSession(): Promise<string> {
  const id = uuidv7();
  await db.insert(sessions).values({
    id,
    cookieHmac: id.replace(/-/g, ""),
    formId: "lesser-slime",
  });
  return id;
}

async function makeBondedNpc(args: {
  userId: string;
  slug: string;
  name: string;
  timesMet?: number;
  bonded?: boolean;
  status?: string;
}): Promise<string> {
  const id = uuidv7();
  await db.insert(worldNpcs).values({
    id,
    userId: args.userId,
    slug: args.slug,
    name: args.name,
    relationshipScore: args.bonded === false ? 0 : 4,
    lastSeenStatus: args.status ?? "alive",
    timesMet: args.timesMet ?? 1,
    timesHelped: 0,
    timesHarmed: 0,
    data: {},
    bondedAt: args.bonded === false ? null : new Date(),
    isRecurring: false,
    runHistory: [],
  });
  return id;
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
    "TRUNCATE session_companions, world_npcs, sessions, users RESTART IDENTITY CASCADE",
  );
});

describe("summonCompanion", () => {
  test("happy path — bonded alive NPC summons with level + maxHp scaled by timesMet", async () => {
    const userId = await makeUser("alice");
    const sessionId = await makeSession();
    const npcId = await makeBondedNpc({
      userId,
      slug: "berra-the-smith",
      name: "Berra",
      timesMet: 3,
    });
    const r = await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "berra-the-smith",
      turn: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.level).toBe(3);
    expect(r.row.maxHp).toBe(COMPANION_HP_BASE + 2 * COMPANION_HP_PER_LEVEL);
    expect(r.row.currentHp).toBe(r.row.maxHp);
    expect(r.row.status).toBe("alive");
    expect(r.row.joinedAtTurn).toBe(2);

    // Row is in DB.
    const [row] = await db
      .select()
      .from(sessionCompanions)
      .where(
        and(
          eq(sessionCompanions.sessionId, sessionId),
          eq(sessionCompanions.worldNpcId, npcId),
        ),
      );
    expect(row.slug).toBe("berra-the-smith");
  });

  test("level capped at COMPANION_MAX_LEVEL even for legendary timesMet", async () => {
    const userId = await makeUser("legend");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "legend",
      name: "Legend",
      timesMet: 99,
    });
    const r = await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "legend",
      turn: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.level).toBe(COMPANION_MAX_LEVEL);
  });

  test("rejects unbonded NPC", async () => {
    const userId = await makeUser("nobond");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "stranger",
      name: "stranger",
      bonded: false,
    });
    const r = await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "stranger",
      turn: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("not_bonded");
  });

  test("rejects already-dead NPC (the bond doesn't resurrect)", async () => {
    const userId = await makeUser("graveyard");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "ghost",
      name: "Ghost",
      status: "dead",
    });
    const r = await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "ghost",
      turn: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("already_dead");
  });

  test("second summon of the same companion in the same session = already_summoned", async () => {
    const userId = await makeUser("twice");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "buddy",
      name: "Buddy",
    });
    const a = await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "buddy",
      turn: 1,
    });
    expect(a.ok).toBe(true);
    const b = await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "buddy",
      turn: 2,
    });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.error).toBe("already_summoned");
  });
});

describe("damageCompanion", () => {
  test("partial damage reduces currentHp, keeps alive", async () => {
    const userId = await makeUser("dmg");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "punch-bag",
      name: "PunchBag",
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "punch-bag",
      turn: 1,
    });
    const r = await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "punch-bag",
      amount: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.died).toBe(false);
    expect(r.remainingHp).toBe(COMPANION_HP_BASE - 3);
  });

  test("HP→0 flips status to dead AND world_npcs.last_seen_status = dead", async () => {
    const userId = await makeUser("perma");
    const sessionId = await makeSession();
    const npcId = await makeBondedNpc({
      userId,
      slug: "doomed",
      name: "Doomed",
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "doomed",
      turn: 1,
    });
    const r = await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "doomed",
      amount: 999,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.died).toBe(true);
    expect(r.remainingHp).toBe(0);

    const [sc] = await db
      .select()
      .from(sessionCompanions)
      .where(
        and(
          eq(sessionCompanions.sessionId, sessionId),
          eq(sessionCompanions.worldNpcId, npcId),
        ),
      );
    expect(sc.status).toBe("dead");
    expect(sc.endedAt).not.toBeNull();

    const [npc] = await db
      .select()
      .from(worldNpcs)
      .where(eq(worldNpcs.id, npcId));
    expect(npc.lastSeenStatus).toBe("dead");
  });

  test("damaging an already-dead companion returns already_dead", async () => {
    const userId = await makeUser("zombie");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "zombie",
      name: "Zombie",
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "zombie",
      turn: 1,
    });
    await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "zombie",
      amount: 999,
    });
    const r = await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "zombie",
      amount: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("already_dead");
  });
});

describe("healCompanion + listInRunCompanions", () => {
  test("heals up to maxHp, cannot heal a dead companion", async () => {
    const userId = await makeUser("heal");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "patient",
      name: "Patient",
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "patient",
      turn: 1,
    });
    await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "patient",
      amount: 4,
    });
    const healed = await healCompanion(db, {
      sessionId,
      worldNpcSlug: "patient",
      amount: 2,
    });
    expect(healed).toBe(COMPANION_HP_BASE - 4 + 2);
    // Heal cap.
    const capped = await healCompanion(db, {
      sessionId,
      worldNpcSlug: "patient",
      amount: 999,
    });
    expect(capped).toBe(COMPANION_HP_BASE);
    // Dead → null.
    await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "patient",
      amount: 999,
    });
    const noHeal = await healCompanion(db, {
      sessionId,
      worldNpcSlug: "patient",
      amount: 5,
    });
    expect(noHeal).toBeNull();
  });

  test("listInRunCompanions surfaces the full party state", async () => {
    const userId = await makeUser("party");
    const sessionId = await makeSession();
    await makeBondedNpc({
      userId,
      slug: "alpha",
      name: "Alpha",
    });
    await makeBondedNpc({
      userId,
      slug: "beta",
      name: "Beta",
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "alpha",
      turn: 1,
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "beta",
      turn: 2,
    });
    const list = await listInRunCompanions(db, sessionId);
    expect(list.length).toBe(2);
    const slugs = list.map((c) => c.slug).sort();
    expect(slugs).toEqual(["alpha", "beta"]);
  });
});

describe("levelUpAlive", () => {
  test("alive companions gain a level + heal to full; dead companions are skipped; cap respected", async () => {
    const userId = await makeUser("growth");
    const sessionId = await makeSession();
    await makeBondedNpc({ userId, slug: "fresh", name: "Fresh" });
    await makeBondedNpc({
      userId,
      slug: "veteran",
      name: "Vet",
      timesMet: COMPANION_MAX_LEVEL,
    });
    await makeBondedNpc({ userId, slug: "fallen", name: "Fallen" });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "fresh",
      turn: 1,
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "veteran",
      turn: 1,
    });
    await summonCompanion(db, {
      sessionId,
      userId,
      worldNpcSlug: "fallen",
      turn: 1,
    });
    await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "fresh",
      amount: 2,
    });
    await damageCompanion(db, {
      sessionId,
      worldNpcSlug: "fallen",
      amount: 999,
    });

    const leveled = await levelUpAlive(db, sessionId);
    // Fresh leveled (1→2). Veteran skipped (already at cap).
    // Fallen skipped (dead).
    expect(leveled.map((l) => l.slug)).toEqual(["fresh"]);
    expect(leveled[0].level).toBe(2);
    expect(leveled[0].maxHp).toBe(
      COMPANION_HP_BASE + 1 * COMPANION_HP_PER_LEVEL,
    );

    // Level-up heals the leveler to full.
    const list = await listInRunCompanions(db, sessionId);
    const fresh = list.find((c) => c.slug === "fresh")!;
    expect(fresh.currentHp).toBe(fresh.maxHp);
    // Veteran unchanged.
    const vet = list.find((c) => c.slug === "veteran")!;
    expect(vet.level).toBe(COMPANION_MAX_LEVEL);
    // Fallen unchanged.
    const fallen = list.find((c) => c.slug === "fallen")!;
    expect(fallen.status).toBe("dead");
  });
});
