# CLAUDE.md

Guidance for Claude Code (and any other agent or contributor) working in this repository.

## What this project is

A third-person building/shooter game in the Fortnite mould: a player runs around a
large open map, harvests materials, places and edits build pieces in real time, loots
weapons, and fights. Built as a browser game (WebGL via three.js), bundled with Vite.

The game is **not** a Fortnite clone in content. It borrows the genre's mechanics
(build/edit/combat loop) but uses original maps, art, weapon names, and tuning. Never
copy Epic Games assets, names, or data into this repository.

## Source of truth — read this first

Two documents govern all implementation work:

| Document | Governs |
| --- | --- |
| `docs/MASTER_SPEC.md` | Gameplay: player, movement, combat, building, editing, loot, materials, UI, progression |
| `docs/MAP_SPEC.md` | The world: dimensions, biomes, POIs, terrain, loot distribution, streaming |

**Rules:**

1. If code and spec disagree, the spec wins — change the code, not the spec, unless the
   user explicitly asks for a spec change.
2. Never invent a gameplay number. Every tunable constant in `src/` must trace back to a
   value in `docs/MASTER_SPEC.md` or `docs/MAP_SPEC.md`. Put the constants in
   `src/core/Config.js` and reference the spec section in a comment.
3. When the user supplies a new or revised spec, update the spec document **first**, in
   the same commit or an earlier one, then bring the code in line.
4. Do not silently widen scope. Implement the spec section you were asked for.

Spec documents carry a `Status` and `Version` header. Bump the version on every
substantive change and add a line to the Changelog at the bottom of the document.

## Repository layout

```
CLAUDE.md              This file
docs/
  MASTER_SPEC.md       Gameplay specification (source of truth)
  MAP_SPEC.md          Map specification (source of truth)
references/            Research + reference material, not shipped code
  map/                 Layout sketches, POI references, heightmap studies
  gameplay/            Movement/combat feel notes, TTK tables, tuning research
  building/            Build piece geometry, snapping, structure references
  editing/             Edit grid patterns, edit-flow timing notes
  ui/                  HUD mockups, build bar, inventory, minimap references
src/                   Game source (ES modules)
  core/                Loop, config, input, events, RNG, settings, performance
  player/              Controller, camera, state machine, stats
  building/            Build grid, pieces, placement, structure integrity
  editing/             Edit grid, edit patterns, edit state machine
  combat/              Weapons, firing, damage, pickaxe, health/shields
  world/               Terrain, renderer, bots, test environment
  loot/                Loot tables and world loot entities
  audio/               Synthesised cues, event-driven
  ui/                  HUD, build bar, inventory, crosshair, compass
assets/                Runtime assets (models, textures, audio, fonts, maps)
tests/                 Vitest unit tests
```

## Commands

```bash
npm install       # install dependencies
npm run dev       # Vite dev server with hot reload
npm run build     # production build to dist/
npm run preview   # serve the production build
npm test          # run the Vitest suite once
npm run test:watch
npm run lint      # ESLint
```

## Code conventions

- **ES modules only.** `import`/`export`, no CommonJS. `.js` files, no build-step types.
- **No magic numbers in systems code.** Tunables live in `src/core/Config.js`, grouped by
  spec section, each with a comment naming the spec section it comes from.
- **Units are metres and seconds.** Angles are radians internally; degrees only at the
  spec/UI boundary.
- **The build module is the unit of scale.** `TILE` and `WALL_H` are declared once in
  `Config.js` and every other spatial value derives from them by ratio (`MASTER_SPEC
  §9.1.1`). **No file outside `Config.js` may contain a spatial literal.** Tests assert
  the derivation, not the absolute, so retuning the module does not break them.
- **Geometry has one source.** `building/PieceGeometry.js` produces both the visible mesh
  and the collider from the same edit pattern. Never write a second shape definition —
  that is what makes stale collision impossible rather than merely unlikely.
- **Systems are plain classes** with `update(dt, ctx)`. No system reaches into another
  system's internals — communicate through the event bus (`src/core/EventBus.js`) or
  through explicitly passed context.
- **Simulation is frame-rate independent.** Never scale by an assumed 60 fps; always use
  the `dt` passed into `update`. Fixed-step systems use the accumulator in `src/core/Loop.js`.
- **Rendering stays out of simulation.** `src/building`, `src/combat`, `src/editing` must
  be testable in Node without a WebGL context. Anything touching three.js scene graph
  objects goes behind a thin view layer.
- **Naming:** classes `PascalCase`, functions/variables `camelCase`, constants
  `SCREAMING_SNAKE_CASE`, files match their default export.

## Testing

Vitest, run in Node with no browser. Every pure-logic system gets tests:
build grid snapping, edit pattern validity, damage/falloff maths, loot rarity rolls,
structure support propagation. Tests assert against numbers quoted from the specs, so a
spec change that is not reflected in the code shows up as a failing test — that is
intentional and desirable.

Do not test three.js rendering or DOM output. Do not add snapshot tests of large objects.

## Working agreements

- Commit in coherent units with a message that names the spec section implemented.
- Do not add dependencies without a reason stated in the commit message. Prefer the
  standard library and the three deps already present.
- Assets: keep source files out of `assets/` if they are large binaries; `assets/` holds
  runtime-ready files only. Document any new asset in the relevant `references/` README.
- `references/` is for humans. Nothing in `src/` may import from it.
