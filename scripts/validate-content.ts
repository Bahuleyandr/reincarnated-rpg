import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTENT = join(process.cwd(), "content");
const PLACEHOLDER_ROOM_IDS = new Set(["$WRONG_ROOM", "$COOLER_ROOM", "$DEEPER_ROOM"]);

type JsonObject = Record<string, unknown>;

const errors: string[] = [];

function readJson(path: string): JsonObject {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`${path}: ${message}`);
    return {};
  }
}

function jsonFiles(dir: string): string[] {
  return readdirSync(join(CONTENT, dir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(CONTENT, dir, name));
}

const npcIds = new Set<string>();
for (const file of jsonFiles("npcs")) {
  const json = readJson(file);
  const expected = file
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.json$/, "");
  if (json.id !== expected) errors.push(`${file}: id must match filename`);
  if (typeof json.id === "string") npcIds.add(json.id);
}

for (const file of jsonFiles("locations")) {
  const json = readJson(file);
  const rooms = Array.isArray(json.rooms) ? (json.rooms as JsonObject[]) : [];
  if (rooms.length === 0) errors.push(`${file}: rooms must be non-empty`);
  const roomIds = new Set(
    rooms.map((room) => room.id).filter((id): id is string => typeof id === "string"),
  );
  if (typeof json.entryRoomId !== "string" || !roomIds.has(json.entryRoomId)) {
    errors.push(`${file}: entryRoomId must reference a room`);
  }
  for (const room of rooms) {
    if (typeof room.id !== "string") errors.push(`${file}: room missing id`);
    const exits = Array.isArray(room.exits) ? (room.exits as JsonObject[]) : [];
    for (const exit of exits) {
      if (typeof exit.toRoomId !== "string" || !roomIds.has(exit.toRoomId)) {
        errors.push(
          `${file}: exit from ${String(room.id)} points to unknown room ${String(exit.toRoomId)}`,
        );
      }
    }
  }
}

for (const file of jsonFiles("forms")) {
  const json = readJson(file);
  const expected = file
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.json$/, "");
  if (json.id !== expected) errors.push(`${file}: id must match filename`);
  const verbs = Array.isArray(json.verbs)
    ? new Set(json.verbs.filter((verb): verb is string => typeof verb === "string"))
    : new Set<string>();
  if (verbs.size === 0) errors.push(`${file}: verbs must be non-empty`);

  const mappings = isObject(json.verbMappings) ? json.verbMappings : {};
  for (const verb of verbs) {
    if (!isObject(mappings[verb])) {
      errors.push(`${file}: verbMappings missing ${verb}`);
    }
  }
  for (const verb of Object.keys(mappings)) {
    if (!verbs.has(verb)) errors.push(`${file}: mapping for unknown verb ${verb}`);
  }

  const hardMoves =
    isObject(json.hardMoves) && Array.isArray(json.hardMoves.moves)
      ? (json.hardMoves.moves as JsonObject[])
      : [];
  for (const move of hardMoves) {
    const tools = Array.isArray(move.tools) ? (move.tools as JsonObject[]) : [];
    for (const tool of tools) {
      if (tool.name === "introduce_npc" && typeof tool.templateId === "string") {
        if (!npcIds.has(tool.templateId)) {
          errors.push(
            `${file}: hard move ${String(move.id)} references unknown npc template ${tool.templateId}`,
          );
        }
      }
      if (tool.name === "move_to" && typeof tool.roomId === "string") {
        if (tool.roomId.startsWith("$") && !PLACEHOLDER_ROOM_IDS.has(tool.roomId)) {
          errors.push(
            `${file}: hard move ${String(move.id)} uses unknown room placeholder ${tool.roomId}`,
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error("[content] validation failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("[content] validation passed");

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
