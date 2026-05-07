import { PARTIAL_THRESHOLD, SUCCESS_THRESHOLD } from "./rules";
import { SAFETY_CAPS } from "./safety";

export const MANUAL_TOPIC_IDS = [
  "basics",
  "actions",
  "dice",
  "energy",
  "inventory",
  "map",
  "forms",
  "npcs",
] as const;

export type ManualTopicId = (typeof MANUAL_TOPIC_IDS)[number];

export interface ManualTopic {
  id: ManualTopicId;
  label: string;
  summary: string;
  bullets: string[];
  keepInMind?: string;
}

export const MANUAL_TOPICS: ManualTopic[] = [
  {
    id: "basics",
    label: "Basics",
    summary:
      "Reincarnated is turn based: choose a form-aware action, let the world answer, then adapt.",
    bullets: [
      "Preset choices are the safest path. They use authored verbs for your current form and usually cost no AI call.",
      "Free text is for anything unusual. The backend still validates what happens, even when the remote narrator writes the prose.",
      "Ordinary actions advance cleanly. Dice are reserved for danger, force, major self-cost, or big world-changing moves.",
      "Every run is event logged. If the projection says you lost health, gained an item, moved, or died, it came from accepted events.",
      "The first goal ribbon is your current short-term nudge. It is not the only valid thing to do.",
    ],
    keepInMind:
      "When stuck, pick the verb that matches your body, not the verb a normal human would use.",
  },
  {
    id: "actions",
    label: "Actions",
    summary:
      "Actions are interpreted as intent first, then resolved into clean progress or a risky roll.",
    bullets: [
      "Button actions send a known verb such as absorb, squeeze, hatch, claim, or read.",
      "Typed actions are sanitized, classified, and passed to the narrator with your exact cleaned input.",
      "Movement, sensing, waiting, examining, reading, and other normal form-native actions usually do not roll dice.",
      "A turn can move you, change vitals, change form state, add or remove items, reveal rooms, advance goals, or only narrate.",
      "Tool calls are validated together. If one tool is invalid, the turn should not leave a half-applied log.",
    ],
    keepInMind:
      "Short inputs are fine. A single strong verb often works better than a long paragraph.",
  },
  {
    id: "dice",
    label: "Dice",
    summary: `Only risky actions roll dice plus modifiers: ${SUCCESS_THRESHOLD}+ is success, ${PARTIAL_THRESHOLD}-${SUCCESS_THRESHOLD - 1} is partial, ${PARTIAL_THRESHOLD - 1} or less is miss.`,
    bullets: [
      "No dice display means the action was ordinary: the game treated it as clean progress, not a wasted attempt.",
      "Risky rolls appear for attacks, coercion, forced control, self-damage, hatching, summoning, wyrm moves, and other high-stakes actions.",
      "Most forms roll 2d6. The displayed total already includes any modifier.",
      "Success means you get what you wanted cleanly or with strong advantage.",
      "Partial means you get something, but the world takes a cost, pressure, damage, time, or position.",
      "Miss means the world makes a harder move. It is not always nothing happens; often something happens against you.",
      "Some forms use different dice: cursed book rolls 3d6 keep highest 2, dragon egg rerolls 1s once, and dungeon core rolls 1d12.",
    ],
    keepInMind:
      "Hover or tap the modifier when it is underlined; it names the bonus or penalty sources.",
  },
  {
    id: "energy",
    label: "Energy",
    summary:
      "Energy limits active turns and refills over time, with daily streaks and blessings raising the ceiling.",
    bullets: [
      "The energy bar shows current energy, max energy, tier, refill timing, and daily streak.",
      "Most submitted turns spend energy. Some side interactions, such as chat or tutorial helpers, may be free.",
      "When energy is empty, the turn endpoint refuses the action and the bar updates with the next refill time.",
      "Daily streak bonuses can grant extra energy up to the configured streak cap.",
    ],
    keepInMind:
      "Use preset turns for cheap, crisp progress; save free text for the moments where you need nuance.",
  },
  {
    id: "inventory",
    label: "Inventory",
    summary: `Inventory counts item quantity against capacity: base ${SAFETY_CAPS.inventoryBase}, hard cap ${SAFETY_CAPS.inventoryHardMax}.`,
    bullets: [
      "The left number is used slots. The right number is current capacity.",
      "Capacity starts at the base cap and can rise through form state such as bag slots, but never above the hard cap.",
      "When full, item grants, gathering, buying, or crafting outputs can be rejected by backend validation.",
      "Custom item names appear first; the original item id stays in parentheses for clarity and replay safety.",
      "NPCs you know are listed below inventory with their relationship score.",
    ],
    keepInMind: "If an action should create an item and nothing appears, check capacity first.",
  },
  {
    id: "map",
    label: "Map",
    summary: "The map shows your current location, discovered rooms, and room-to-room topology.",
    bullets: [
      "Only discovered rooms are counted in the room tally.",
      "Movement is validated against connected rooms; the narrator cannot teleport you to an unconnected room.",
      "Sensing, exploring, squeezing, claiming, or similar form verbs can discover more of the map.",
      "Some locations have authored tile maps; others use the simpler graph map.",
    ],
    keepInMind: "If movement fails, pick a connected room or use a sensing/exploration verb first.",
  },
  {
    id: "forms",
    label: "Forms",
    summary:
      "Each reincarnated body has its own vitals, stats, verbs, dice, hard moves, and language limits.",
    bullets: [
      "A slime, book, egg, core, revenant, and generic creature do not share the same action vocabulary.",
      "Vitals can mean different things per form. Empty essence may not be death, while another vital may be lethal.",
      "Stats influence the roll modifier chosen for a verb mapping.",
      "The UI accent, opening text, dice variant, and suggested verbs all come from the current form.",
    ],
    keepInMind:
      "The best move usually sounds like something your current body could physically or metaphysically do.",
  },
  {
    id: "npcs",
    label: "NPCs",
    summary: "Nearby players, NPCs, companions, and known relationships are separate surfaces.",
    bullets: [
      "Known NPCs live under inventory because they are part of your run projection.",
      "Nearby presence shows live players or entities in your current room when available.",
      "Companions can react to the run and are tracked separately from ordinary known NPCs.",
      "Relationship scores can rise or fall through accepted events and may affect future choices.",
    ],
    keepInMind:
      "If someone is not shown nearby, they may still be known, elsewhere, offline, or only present in narration.",
  },
];

export function isManualTopicId(value: unknown): value is ManualTopicId {
  return typeof value === "string" && MANUAL_TOPIC_IDS.includes(value as ManualTopicId);
}

export function getManualTopic(id: ManualTopicId): ManualTopic {
  return MANUAL_TOPICS.find((topic) => topic.id === id) ?? MANUAL_TOPICS[0];
}
