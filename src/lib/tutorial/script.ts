/**
 * Tutorial script — Phase 5.5 Day 36-37.
 *
 * The first three turns of a new user's tutorial session get an
 * explicit hint above the input box. The hint teaches the wedge
 * ("each form plays differently") by suggesting verbs only this
 * form has — for the slime tutorial: ooze, sense, absorb.
 *
 * After the third turn, the orchestrator graduates the player.
 */
export interface TutorialHint {
  turn: number;
  /** Short prompt above the input. */
  hint: string;
  /** Optional suggested input the user can click to auto-fill. */
  example: string;
}

export const TUTORIAL_HINTS: ReadonlyArray<TutorialHint> = [
  {
    turn: 1,
    hint: "you wake. you have no eyes. how do you move?",
    example: "i ooze toward the slope",
  },
  {
    turn: 2,
    hint: "things make tremors. listen for them.",
    example: "i sense the room",
  },
  {
    turn: 3,
    hint: "small things can be made part of you.",
    example: "i absorb the moss",
  },
];

/** Returns the hint for the given turn (1..3) or null after. */
export function getTutorialHint(turn: number): TutorialHint | null {
  return TUTORIAL_HINTS.find((h) => h.turn === turn) ?? null;
}

/** Total turns of guided hints — graduate the player after this. */
export const TUTORIAL_LENGTH = TUTORIAL_HINTS.length;
