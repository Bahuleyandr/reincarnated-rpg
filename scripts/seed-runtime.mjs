import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[seed] DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const contentDir = join(process.cwd(), "content");

function readTemplateDir(name) {
  const dir = join(contentDir, name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (!parsed.id) throw new Error(`${name}/${file} missing id`);
      return parsed;
    });
}

async function upsert(table, template) {
  await sql`
    INSERT INTO ${sql(table)} (id, data)
    VALUES (${template.id}, ${sql.json(template)})
    ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data,
          updated_at = now()
  `;
}

try {
  const forms = readTemplateDir("forms");
  const locations = readTemplateDir("locations");
  const npcs = readTemplateDir("npcs");
  const items = readTemplateDir("items");
  const quests = readTemplateDir("quests");

  for (const form of forms) {
    await sql`
      INSERT INTO templates_forms (id, version, data)
      VALUES (${form.id}, ${form._meta?.version ?? 1}, ${sql.json(form)})
      ON CONFLICT (id) DO UPDATE
        SET version = EXCLUDED.version,
            data = EXCLUDED.data,
            updated_at = now()
    `;
  }
  for (const location of locations) await upsert("templates_locations", location);
  for (const npc of npcs) await upsert("templates_npcs", npc);
  for (const item of items) await upsert("templates_items", item);
  for (const quest of quests) await upsert("templates_quests", quest);

  console.log(
    `[seed] ${forms.length} forms, ${locations.length} locations, ${npcs.length} npcs, ${items.length} items, ${quests.length} quests`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
