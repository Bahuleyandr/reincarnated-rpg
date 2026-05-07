import {
  getManualTopic,
  isManualTopicId,
  MANUAL_TOPICS,
  MANUAL_TOPIC_IDS,
} from "@/lib/game/manual";
import { PARTIAL_THRESHOLD, SUCCESS_THRESHOLD } from "@/lib/game/rules";
import { SAFETY_CAPS } from "@/lib/game/safety";

describe("manual topics", () => {
  test("has one topic for every declared topic id", () => {
    expect(MANUAL_TOPICS.map((topic) => topic.id).sort()).toEqual([...MANUAL_TOPIC_IDS].sort());
  });

  test("topic ids are unique", () => {
    const ids = MANUAL_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("dice manual mirrors the roll thresholds", () => {
    const dice = getManualTopic("dice");
    expect(dice.summary).toContain(`${SUCCESS_THRESHOLD}+`);
    expect(dice.summary).toContain(`${PARTIAL_THRESHOLD}-${SUCCESS_THRESHOLD - 1}`);
    expect(dice.summary).toContain(`${PARTIAL_THRESHOLD - 1} or less`);
  });

  test("inventory manual mirrors inventory caps", () => {
    const inventory = getManualTopic("inventory");
    expect(inventory.summary).toContain(`${SAFETY_CAPS.inventoryBase}`);
    expect(inventory.summary).toContain(`${SAFETY_CAPS.inventoryHardMax}`);
  });

  test("topic id guard accepts known ids only", () => {
    expect(isManualTopicId("dice")).toBe(true);
    expect(isManualTopicId("unknown")).toBe(false);
    expect(isManualTopicId(null)).toBe(false);
  });
});
