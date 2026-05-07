import type { Event, RollResult } from "./types";

export function rollForLatestTurn(events: readonly Event[]): RollResult | null {
  const turnStart = findLatestTurnStart(events);
  if (turnStart < 0) return null;

  for (let i = events.length - 1; i > turnStart; i -= 1) {
    const event = events[i];
    if (event.kind === "roll.resolved") {
      return event.roll;
    }
  }
  return null;
}

function findLatestTurnStart(events: readonly Event[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].kind === "turn.begun") return i;
  }
  return -1;
}
