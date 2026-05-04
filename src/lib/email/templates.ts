/**
 * Email templates — Phase 8 Day 68.
 *
 * Pure functions returning {subject, text, html?}. Each template
 * is short, plaintext-first, with a single optional CTA. No HTML
 * required for any flow — html is opt-in for richer renders.
 *
 * Unsubscribe links are appended by the caller at send time using
 * the unsubscribe-token system (planned).
 */
export interface EmailContent {
  subject: string;
  text: string;
}

export function lapsed7d(args: {
  username: string;
  chapterTitle: string;
}): EmailContent {
  return {
    subject: "the world has been quiet without you",
    text: `${args.username},\n\na week. the cycle moved without you. ${args.chapterTitle} is open. someone will read your epitaph eventually; come back before they have to.\n\nreturn → /\n`,
  };
}

export function lapsed30d(args: {
  username: string;
  chapterTitle: string;
}): EmailContent {
  return {
    subject: "the world is rearranging itself",
    text: `${args.username},\n\nthirty days. things are different now. ${args.chapterTitle}. factions have moved. names have stuck. you would not recognize the room you last died in.\n\nreturn → /\n`,
  };
}

export function returningWelcome(args: {
  username: string;
  chapterTitle: string;
}): EmailContent {
  return {
    subject: "you came back",
    text: `${args.username},\n\nyou came back. the cycle noticed.\n\nthe codex is at /world/codex if you want to know what you missed. ${args.chapterTitle} is the current chapter. enter when you want.\n`,
  };
}

export function yearEnd(args: {
  username: string;
  endingLabel: string;
  year: number;
}): EmailContent {
  return {
    subject: `Year ${args.year} ended: ${args.endingLabel}`,
    text: `${args.username},\n\nthe year closed. it ended like this: ${args.endingLabel}.\n\nthe full archive is at /world/year/${args.year}. Year ${args.year + 1} has already begun.\n`,
  };
}
