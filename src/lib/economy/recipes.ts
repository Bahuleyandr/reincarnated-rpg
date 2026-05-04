/**
 * Recipe catalog + craft validator — Phase 5 Day 22.
 *
 * Recipes live in `content/recipes.json`. Each carries inputs, output,
 * a skill, a requiredLevel, optional requiresLocation, and an xp
 * reward. The `craft_recipe` tool runs every craft (smelt, smith,
 * mill, alchemy, cook, etc.) — the recipe id determines what's
 * produced and which skill XP gets awarded.
 *
 * Skill levels (Day 23-24) gate access via requiredLevel; until skills
 * land the validator treats `currentSkillLevels[recipe.skill] ?? 0`
 * as 0, so requiredLevel >= 1 recipes are blocked. The tutorial
 * recipes (smelt-iron-ingot, mill-oak-planks, etc.) are level-1 so
 * the player can taste crafting before learning a skill from a trainer
 * — Day 24 makes "you don't know that skill yet" the message.
 *
 * NOTE: as of Day 22, the requiredLevel check is bypassed when no
 * skillLevels map is passed. This lets Day 22 ship with crafting
 * functional and Day 23-24 turn on the gate without code changes.
 */
import recipesData from "../../../content/recipes.json";

import { isResource } from "./resources";

export interface RecipeInput {
  itemId: string;
  qty: number;
}

export interface RecipeOutput {
  itemId: string;
  qty: number;
}

export interface Recipe {
  id: string;
  skill: string;
  requiredLevel: number;
  inputs: RecipeInput[];
  output: RecipeOutput;
  xp: number;
  requiresLocation?: string;
}

interface RawRecipe {
  id?: unknown;
  skill?: unknown;
  requiredLevel?: unknown;
  inputs?: Array<{ itemId?: unknown; qty?: unknown }>;
  output?: { itemId?: unknown; qty?: unknown };
  xp?: unknown;
  requiresLocation?: unknown;
}

interface RawCatalog {
  recipes: RawRecipe[];
}

function normalize(raw: RawRecipe): Recipe | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.skill !== "string" ||
    typeof raw.requiredLevel !== "number" ||
    !Array.isArray(raw.inputs) ||
    !raw.output ||
    typeof raw.output.itemId !== "string" ||
    typeof raw.output.qty !== "number" ||
    typeof raw.xp !== "number"
  ) {
    return null;
  }
  const inputs: RecipeInput[] = [];
  for (const i of raw.inputs) {
    if (typeof i.itemId !== "string" || typeof i.qty !== "number") return null;
    inputs.push({ itemId: i.itemId, qty: Math.max(1, Math.floor(i.qty)) });
  }
  if (inputs.length === 0) return null;
  return {
    id: raw.id,
    skill: raw.skill,
    requiredLevel: Math.max(1, Math.floor(raw.requiredLevel)),
    inputs,
    output: {
      itemId: raw.output.itemId,
      qty: Math.max(1, Math.floor(raw.output.qty)),
    },
    xp: Math.max(0, Math.floor(raw.xp)),
    ...(typeof raw.requiresLocation === "string"
      ? { requiresLocation: raw.requiresLocation }
      : {}),
  };
}

const CATALOG: ReadonlyArray<Recipe> = (recipesData as unknown as RawCatalog).recipes
  .map(normalize)
  .filter((r): r is Recipe => r !== null);

const BY_ID = new Map<string, Recipe>(CATALOG.map((r) => [r.id, r]));

export function listRecipes(): readonly Recipe[] {
  return CATALOG;
}

export function getRecipe(id: string): Recipe | null {
  return BY_ID.get(id) ?? null;
}

export function listRecipesBySkill(skill: string): readonly Recipe[] {
  return CATALOG.filter((r) => r.skill === skill);
}

export interface ValidateRecipeInputs {
  recipeId: string;
  /** Player's current inventory. */
  inventory: ReadonlyArray<{ itemId: string; qty: number }>;
  /** Current location id; checked when recipe.requiresLocation set. */
  locationId: string;
  /** Skill levels keyed by skill id. Day 23-24 fills this in.
   *  Empty / undefined treats requiredLevel as soft-pass for level-1
   *  recipes only — level >=2 always blocks until a skill is known. */
  skillLevels?: Readonly<Record<string, number>>;
}

export interface ValidateRecipeOk {
  recipe: Recipe;
}

export type ValidateRecipeResult =
  | ValidateRecipeOk
  | { error: string };

/**
 * Pure validator — does the player have inputs, the right skill at
 * the right level, and the right location? Caller pairs this with
 * the actual inventory/skill mutation events.
 */
export function validateRecipe(
  args: ValidateRecipeInputs,
): ValidateRecipeResult {
  const recipe = BY_ID.get(args.recipeId);
  if (!recipe) {
    return { error: `craft_recipe: unknown recipe '${args.recipeId}'` };
  }

  // Skill gate. If skillLevels is provided, enforce; otherwise allow
  // level-1 recipes (the tutorial gradient) and block level >=2.
  const playerLevel = args.skillLevels?.[recipe.skill] ?? 0;
  if (args.skillLevels !== undefined) {
    if (playerLevel < recipe.requiredLevel) {
      return {
        error: `craft_recipe: ${recipe.skill} level ${recipe.requiredLevel} required (you have ${playerLevel})`,
      };
    }
  } else if (recipe.requiredLevel > 1) {
    return {
      error: `craft_recipe: ${recipe.skill} level ${recipe.requiredLevel} required — find a trainer first`,
    };
  }

  // Location gate.
  if (recipe.requiresLocation && args.locationId !== recipe.requiresLocation) {
    return {
      error: `craft_recipe: must be at '${recipe.requiresLocation}' to craft ${recipe.id}`,
    };
  }

  // Inputs available?
  for (const need of recipe.inputs) {
    const held = args.inventory.find((i) => i.itemId === need.itemId);
    if (!held || held.qty < need.qty) {
      return {
        error: `craft_recipe: missing input ${need.itemId} (need ${need.qty}, have ${held?.qty ?? 0})`,
      };
    }
  }

  // Outputs must be a recognized item OR a recognized resource — we
  // don't have a global item registry yet, so accept resources +
  // anything ending in standard suffixes; trust the recipe author
  // otherwise. (This relaxes for crafted artifacts like 'small-knife'
  // that aren't in the resource catalog.)
  // No hard guard — resource catalog check is informational.
  void isResource;

  return { recipe };
}
