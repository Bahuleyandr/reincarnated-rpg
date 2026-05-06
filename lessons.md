# Lessons

Reusable heuristics distilled from build cycles. Read before starting a new feature; add an entry when something teaches a new pattern. Pure principles, not project-specific status.

---

## 2026-05-05 / 2026-05-06 cycle

### Build validators alongside content, not after

When authoring a large batch of structured content (arcs, tile-maps, form verb banks), write the static validator or smoke harness in the same commit batch as the first authored item. The arc smoke harness caught trigger-path typos in the same session that the first ascended-form arcs were written; the tile-map row-width check caught off-by-one grid errors on three of 22 maps before they hit the renderer.

### Inline SVG + currentColor beats a PNG/sprite pipeline at this scale

For a fixed set of ~15 hand-authored icons where per-form color-tinting is needed, inline SVG with `currentColor` (resolved from a CSS custom property) costs ~3KB bundled, renders synchronously, and needs zero re-export when the palette changes. Prefer this over a PNG sprite pipeline until the icon count is large enough that authoring by hand is the bottleneck.

### ASCII tile grids over PNG sprites for authored interior maps

ASCII grids (one character per tile, legend of fill/glyph/walkable per char) are author-friendly, diff-readable, and trivially validatable for row-width consistency. The 22-location tile-art rollout was batched in 4 commits with no renderer changes; the same approach won't scale to procedural maps but is the right fit for a hand-authored world of fixed locations.

### No-SDK observability wrappers: keep them narrow, document the upgrade path

A fetch-based Sentry envelope wrapper (no `@sentry/nextjs`) ships faster, adds zero transitive deps, and is auditable line-by-line. Make it a strict no-op when the DSN env var is absent (so production code calls `captureException` unconditionally), add a 2s abort timeout on the ingest fetch so it never blocks the response path, and annotate exactly what the SDK upgrade adds. This approach is appropriate pre-launch; schedule the SDK swap before any sustained traffic.

### Streaming reasoning-tag filters need chunk-boundary buffering

A batch `stripReasoningTags(text)` isn't sufficient when the model output is streamed. A `<think>` tag can arrive split across chunk boundaries, so the streaming variant needs to buffer the last `N-1` characters of each visible segment (where N = tag length) and re-scan on the next chunk. Write the streaming filter alongside the batch one the first time you add a reasoning model — retrofitting it later when streaming is live is harder.

### E2E against a production build: `next start` + `NODE_ENV=test`, not `next dev`

Next.js 16 loads `.env.local` unconditionally in dev mode regardless of other env overrides. For a CI E2E leg that needs to point at a test DB (not the dev tailnet DB), use `next start` (serving the already-built `.next` bundle) with `NODE_ENV=test` and explicit env vars injected at the process level. Boot on a non-default port (e.g. 3100) to avoid colliding with a running `next dev` session.

### Per-form-keyed `suggestedVerbs` record avoids arc duplication

When an arc needs different suggested verbs per form (e.g. a location used by multiple form arcs), use a `Record<formId, SuggestedVerb[]>` on the beat's `suggestedVerbs` field with a `"default"` fallback key rather than copying the beat across arcs. The arc smoke harness audits each key against that form's actual verb list and phrase bank, so coverage errors surface immediately.

### Predicate-based nudge catalog: pure match functions, evaluated every turn

Onboarding hints that fire contextually (first turn, low vital, fog-of-war unexplored, branch taken) are best modeled as a sorted catalog of `{ id, priority, match(events, projection) }` entries evaluated cheaply on every turn. Keep predicates pure (no LLM calls, no DB writes); swallow predicate exceptions rather than letting them break the turn. Dismissal via localStorage is anon-friendly and survives page reloads without a DB row — appropriate until authenticated sessions exist.

### Static-parse a routing table instead of importing it from a test harness

When a runtime config table (like `arc-routing.ts`'s ROUTES) sits in a module that touches `node:crypto` or other side-effectful deps at import time, regex-parse the source file directly in the test harness rather than dynamic-importing the module. The harness stays fast and side-effect-free; the regex is brittle to syntax changes but cheaper than spinning up the full module graph.
