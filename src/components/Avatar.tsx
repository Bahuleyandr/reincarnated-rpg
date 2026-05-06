/**
 * Per-form avatar (POLISH_PLAN G.1). 15 inline-SVG glyphs, one per
 * shipped form, using `currentColor` so the form's --form-accent
 * CSS variable tints automatically.
 *
 * Why inline SVG and not a sprite sheet:
 *   - 15 forms × ~200 bytes each = ~3KB total. Bundling the sprite
 *     into JS lets every form's avatar render synchronously without
 *     a network fetch on the run-start screen.
 *   - currentColor + form-accent gives free per-form tinting; no
 *     PNG re-export pipeline.
 *   - Forms are MVP-small enough that authoring 15 by hand beats
 *     building a procedural generator.
 *
 * Design conventions:
 *   - 32×32 viewBox. Strokes 1.5px. Round line caps.
 *   - One color: `currentColor` (the form's --form-accent).
 *   - No text inside the SVG; the displayName is rendered next to
 *     the avatar by the caller.
 *   - Honor each form's identity (slime has no eyes per design rule;
 *     book is closed by default; egg shows hairline crack; etc.).
 *
 * Usage:
 *   <Avatar formId="lesser-slime" size={48} />
 *   <Avatar formId="cursed-book" size={32} className="opacity-70" />
 *
 * Unknown form ids fall through to the generic-creature glyph.
 */

interface AvatarProps {
  formId: string;
  /** Pixel size of the rendered glyph. Default 32. */
  size?: number;
  className?: string;
  /** Aria label override. Default: form id with hyphens stripped. */
  ariaLabel?: string;
}

import type { ReactElement } from "react";

type AvatarSvg = (props: { size: number; className?: string; aria: string }) => ReactElement;

const baseProps = (size: number, aria: string, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  role: "img",
  "aria-label": aria,
  className,
});

// ---- The 15 form glyphs ----

const slime: AvatarSvg = ({ size, aria, className }) => (
  // Translucent blob with internal bubbles. NO eyes — slime has no
  // visual sense, per the form's design rule.
  <svg {...baseProps(size, aria, className)}>
    <path d="M6 18 Q6 9 16 9 Q26 9 26 18 Q26 25 16 25 Q6 25 6 18 Z" />
    <circle cx="13" cy="16" r="1.4" fill="currentColor" />
    <circle cx="19" cy="19" r="1" fill="currentColor" />
    <circle cx="17" cy="14" r="0.8" fill="currentColor" />
  </svg>
);

const cursedBook: AvatarSvg = ({ size, aria, className }) => (
  // Closed book with one mark of marginalia rising off the spine.
  <svg {...baseProps(size, aria, className)}>
    <path d="M7 8 L7 24 L25 24 L25 8 L16 11 L7 8 Z" />
    <path d="M16 11 L16 24" />
    <path d="M22 6 Q24 5 25 7" /> {/* small ribbon mark */}
  </svg>
);

const dragonEgg: AvatarSvg = ({ size, aria, className }) => (
  // Oval egg with a hairline crack and a single inner glow point.
  <svg {...baseProps(size, aria, className)}>
    <ellipse cx="16" cy="17" rx="8" ry="10" />
    <path d="M14 12 L17 16 L14 19" />
    <circle cx="16" cy="17" r="1.2" fill="currentColor" />
  </svg>
);

const dungeonCore: AvatarSvg = ({ size, aria, className }) => (
  // Faceted crystal with rays.
  <svg {...baseProps(size, aria, className)}>
    <path d="M16 7 L22 13 L19 24 L13 24 L10 13 Z" />
    <path d="M16 7 L16 24" />
    <path d="M10 13 L22 13" />
    <path d="M16 4 L16 6 M5 16 L7 16 M27 16 L25 16" /> {/* short rays */}
  </svg>
);

const genericCreature: AvatarSvg = ({ size, aria, className }) => (
  // Hooded silhouette with a single ambiguous mark (the question of
  // what this form even is). Used as the unknown-form fallback.
  <svg {...baseProps(size, aria, className)}>
    <path d="M9 26 L9 16 Q9 8 16 8 Q23 8 23 16 L23 26" />
    <path d="M14 16 Q14 13 16 13 Q18 13 18 15 Q18 17 16 17 L16 19" />
    <circle cx="16" cy="22" r="0.8" fill="currentColor" />
  </svg>
);

const forsakenRevenant: AvatarSvg = ({ size, aria, className }) => (
  // Hooded figure, single visible eye, road behind.
  <svg {...baseProps(size, aria, className)}>
    <path d="M8 26 L8 14 Q8 7 16 7 Q24 7 24 14 L24 26" />
    <circle cx="14" cy="15" r="1.2" fill="currentColor" />
    <path d="M4 28 L28 28" /> {/* the road */}
  </svg>
);

const theStillOne: AvatarSvg = ({ size, aria, className }) => (
  // Lotus posture — three peaks of a meditation glyph.
  <svg {...baseProps(size, aria, className)}>
    <circle cx="16" cy="11" r="3" />
    <path d="M8 25 Q8 19 16 19 Q24 19 24 25" />
    <path d="M11 22 Q11 24 13 25 M21 22 Q21 24 19 25" /> {/* knees */}
  </svg>
);

const saltKeeper: AvatarSvg = ({ size, aria, className }) => (
  // Salt crystal cluster — three rhombi.
  <svg {...baseProps(size, aria, className)}>
    <path d="M16 6 L20 12 L16 18 L12 12 Z" />
    <path d="M9 14 L13 19 L9 24 L5 19 Z" />
    <path d="M23 14 L27 19 L23 24 L19 19 Z" />
  </svg>
);

const deepMark: AvatarSvg = ({ size, aria, className }) => (
  // Downward arrow descending into rippling water.
  <svg {...baseProps(size, aria, className)}>
    <path d="M16 6 L16 18" />
    <path d="M12 14 L16 18 L20 14" />
    <path d="M5 22 Q9 20 13 22 T21 22 T29 22" />
    <path d="M5 26 Q9 24 13 26 T21 26 T29 26" />
  </svg>
);

const cantorOfTheLongSong: AvatarSvg = ({ size, aria, className }) => (
  // Three radiating sound arcs from a still center.
  <svg {...baseProps(size, aria, className)}>
    <circle cx="16" cy="16" r="2" fill="currentColor" />
    <path d="M11 16 Q11 11 16 9 Q21 11 21 16" />
    <path d="M7 16 Q7 8 16 5 Q25 8 25 16" />
    <path d="M3 16 Q3 5 16 1" /> {/* outermost arc partial */}
  </svg>
);

const choristerAscendant: AvatarSvg = ({ size, aria, className }) => (
  // Profile silhouette with a music note rising from the mouth.
  <svg {...baseProps(size, aria, className)}>
    <path d="M10 25 L10 14 Q10 8 16 8 Q22 8 22 14 L22 18 Q22 19 21 19 L19 19" />
    <path d="M22 12 L22 5 L26 7" /> {/* musical note stem */}
    <ellipse cx="20.5" cy="12.5" rx="1.5" ry="1.1" fill="currentColor" />
  </svg>
);

const furnaceWarden: AvatarSvg = ({ size, aria, className }) => (
  // Banked flame on a hearth-line.
  <svg {...baseProps(size, aria, className)}>
    <path d="M16 5 Q12 11 14 16 Q14 20 16 20 Q18 20 18 16 Q20 11 16 5 Z" />
    <path d="M11 22 L21 22" /> {/* hearth */}
    <path d="M8 26 L24 26" /> {/* base */}
  </svg>
);

const gardenKeeperOfTheSpire: AvatarSvg = ({ size, aria, className }) => (
  // Small tree above a spire silhouette.
  <svg {...baseProps(size, aria, className)}>
    <circle cx="16" cy="9" r="4" />
    <path d="M16 13 L16 18" />
    <path d="M11 26 L13 18 L19 18 L21 26 Z" /> {/* spire base */}
  </svg>
);

const ironHandAscended: AvatarSvg = ({ size, aria, className }) => (
  // Hammer head over an anvil.
  <svg {...baseProps(size, aria, className)}>
    <rect x="9" y="6" width="14" height="5" />
    <path d="M16 11 L16 18" />
    <path d="M7 22 L25 22 L23 26 L9 26 Z" /> {/* anvil */}
  </svg>
);

const rustHandAscendant: AvatarSvg = ({ size, aria, className }) => (
  // Two interlocking chain links with a weathered patina dot.
  <svg {...baseProps(size, aria, className)}>
    <ellipse cx="11" cy="16" rx="5" ry="3.5" />
    <ellipse cx="21" cy="16" rx="5" ry="3.5" />
    <circle cx="16" cy="11" r="0.9" fill="currentColor" />
    <circle cx="16" cy="22" r="0.9" fill="currentColor" />
  </svg>
);

const REGISTRY: Record<string, AvatarSvg> = {
  "lesser-slime": slime,
  "cursed-book": cursedBook,
  "dragon-egg": dragonEgg,
  "dungeon-core": dungeonCore,
  "generic-creature": genericCreature,
  "forsaken-revenant": forsakenRevenant,
  "the-still-one": theStillOne,
  "salt-keeper": saltKeeper,
  "deep-mark": deepMark,
  "cantor-of-the-long-song": cantorOfTheLongSong,
  "chorister-ascendant": choristerAscendant,
  "furnace-warden": furnaceWarden,
  "garden-keeper-of-the-spire": gardenKeeperOfTheSpire,
  "iron-hand-ascended": ironHandAscended,
  "rust-hand-ascendant": rustHandAscendant,
};

/** Form ids the avatar registry knows about. Exposed for tests. */
export function knownAvatarFormIds(): string[] {
  return Object.keys(REGISTRY).sort();
}

/** True iff a hand-authored avatar exists for this form. */
export function hasAvatar(formId: string): boolean {
  return formId in REGISTRY;
}

export function Avatar({ formId, size = 32, className, ariaLabel }: AvatarProps) {
  const Svg = REGISTRY[formId] ?? genericCreature;
  const aria = ariaLabel ?? formId.replace(/-/g, " ");
  return <Svg size={size} className={className} aria={aria} />;
}
