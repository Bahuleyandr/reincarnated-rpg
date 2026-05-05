/**
 * P2 — first-goal tracking.
 *
 * Forms ship a `firstGoal` block in their JSON describing a single
 * starter objective. The goal renders on the play page as a small
 * sticky ribbon, so a new player has something to *do* in their
 * first few turns instead of staring at the input box wondering
 * what the game wants from them.
 *
 * Goal completion is a pure function of the projection — no goal
 * state lives on the server. Each turn the play page checks
 * whether the active goal is satisfied; if it is, the ribbon
 * congratulates the player and disappears.
 */
import type { FormTemplate, Projection } from "./types";

export interface GoalProgress {
  /** Stable id from the form template. */
  id: string;
  /** Imperative label for the ribbon. */
  label: string;
  /** Short flavor explaining the goal. */
  description: string;
  /** 0..target — used to render a tiny progress bar. */
  current: number;
  /** Target value the player must reach. */
  target: number;
  /** True once `current >= target`. */
  completed: boolean;
}

/**
 * Resolve the form's first-goal against the current projection.
 *
 * Returns null if the form has no firstGoal field. Otherwise returns
 * a GoalProgress object with `completed` and `current` derived from
 * the projection's turn / form state / discovered rooms.
 *
 * Pure — no DB writes, no event emission. The play page calls this
 * after every state refresh and renders the ribbon accordingly.
 */
export function resolveFirstGoal(
  form: FormTemplate,
  projection: Projection,
): GoalProgress | null {
  const goal = form.firstGoal;
  if (!goal) return null;
  const { kind, field, target } = goal.completion;
  let current = 0;
  switch (kind) {
    case "form_state":
      if (field) {
        current = Math.max(0, projection.form.state[field] ?? 0);
      }
      break;
    case "vital_min":
      if (field) {
        current = Math.max(0, projection.form.vitals[field] ?? 0);
      }
      break;
    case "rooms_visited":
      current = projection.location.discovered.length;
      break;
    case "turn_min":
      current = Math.max(0, projection.turn ?? 0);
      break;
  }
  return {
    id: goal.id,
    label: goal.label,
    description: goal.description,
    current: Math.min(current, target),
    target,
    completed: current >= target,
  };
}
