import "./load-env";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  templatesForms,
  templatesItems,
  templatesLocations,
  templatesNpcs,
  templatesQuests,
} from "../src/lib/db/schema";

type AnyTemplate = { id: string; _meta?: { version?: number } } & Record<
  string,
  unknown
>;

function readTemplateDir(absDir: string): AnyTemplate[] {
  if (!existsSync(absDir)) return [];
  const out: AnyTemplate[] = [];
  for (const f of readdirSync(absDir)) {
    if (!f.endsWith(".json")) continue;
    const raw = readFileSync(join(absDir, f), "utf8");
    const parsed = JSON.parse(raw) as
      | AnyTemplate
      | { items?: AnyTemplate[]; npcs?: AnyTemplate[]; entries?: AnyTemplate[] };
    // Bundle form: { _meta, items: [...] } (or npcs/entries) — flatten.
    const bundle = parsed as {
      items?: unknown;
      npcs?: unknown;
      entries?: unknown;
    };
    const list =
      (Array.isArray(bundle.items) && (bundle.items as AnyTemplate[])) ||
      (Array.isArray(bundle.npcs) && (bundle.npcs as AnyTemplate[])) ||
      (Array.isArray(bundle.entries) && (bundle.entries as AnyTemplate[])) ||
      null;
    if (list) {
      for (const t of list) {
        if (typeof t.id !== "string" || t.id.length === 0) {
          throw new Error(`${absDir}/${f} bundle entry is missing string \`id\``);
        }
        out.push(t);
      }
      continue;
    }
    const single = parsed as AnyTemplate;
    if (typeof single.id !== "string" || single.id.length === 0) {
      throw new Error(`${absDir}/${f} is missing string \`id\``);
    }
    out.push(single);
  }
  return out;
}

async function main() {
  const url =
    process.env.DATABASE_URL ??
    "postgres://reincarnated:reincarnated@localhost:5433/reincarnated";

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  const repoRoot = process.cwd();
  const contentDir = join(repoRoot, "content");

  const forms = readTemplateDir(join(contentDir, "forms"));
  const locations = readTemplateDir(join(contentDir, "locations"));
  const npcs = readTemplateDir(join(contentDir, "npcs"));
  const items = readTemplateDir(join(contentDir, "items"));
  const quests = readTemplateDir(join(contentDir, "quests"));

  for (const f of forms) {
    await db
      .insert(templatesForms)
      .values({
        id: f.id,
        version: f._meta?.version ?? 1,
        data: f,
      })
      .onConflictDoUpdate({
        target: templatesForms.id,
        set: {
          version: f._meta?.version ?? 1,
          data: f,
          updatedAt: new Date(),
        },
      });
  }

  for (const l of locations) {
    await db
      .insert(templatesLocations)
      .values({ id: l.id, data: l })
      .onConflictDoUpdate({
        target: templatesLocations.id,
        set: { data: l, updatedAt: new Date() },
      });
  }

  for (const n of npcs) {
    await db
      .insert(templatesNpcs)
      .values({ id: n.id, data: n })
      .onConflictDoUpdate({
        target: templatesNpcs.id,
        set: { data: n, updatedAt: new Date() },
      });
  }

  for (const i of items) {
    await db
      .insert(templatesItems)
      .values({ id: i.id, data: i })
      .onConflictDoUpdate({
        target: templatesItems.id,
        set: { data: i, updatedAt: new Date() },
      });
  }

  for (const q of quests) {
    await db
      .insert(templatesQuests)
      .values({ id: q.id, data: q })
      .onConflictDoUpdate({
        target: templatesQuests.id,
        set: { data: q, updatedAt: new Date() },
      });
  }

  await client.end();

  console.log(
    `seeded: ${forms.length} forms, ${locations.length} locations, ${npcs.length} npcs, ${items.length} items, ${quests.length} quests`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
