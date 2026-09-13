# Fortnite Style Game

A third-person building/shooter in the Fortnite mould: run a large open map, harvest
materials, place and edit build pieces in real time, loot weapons, fight. Browser game,
WebGL via three.js, bundled with Vite.

Original maps, art, weapon names, and tuning — the genre's mechanics, none of its content.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Click the overlay to lock the pointer. `WASD` move, `Space` jump, `Shift` sprint,
`F1`–`F4` wall/floor/ramp/cone, `Q` toggle build, `F5` cycle material, `G` edit,
`R` rotate (build) or reset (edit), `1`–`6` inventory slots.

```bash
npm test         # 237 tests, Node, no browser
npm run lint
npm run build
```

Add `?seed=1234` to the URL to play a specific deterministic match.

## The specs are the source of truth

| Document | Governs |
| --- | --- |
| [`docs/MASTER_SPEC.md`](docs/MASTER_SPEC.md) | Player, movement, combat, building, editing, loot, UI, match flow |
| [`docs/MAP_SPEC.md`](docs/MAP_SPEC.md) | World size, terrain, biomes, POIs, loot distribution, streaming |

Every gameplay number in `src/` lives in `src/core/Config.js` and traces back to a spec
section. The test suite asserts the code against values quoted from the specs, so a spec
change that the code has not followed shows up as a failing test.

**Both specs are currently marked `Baseline v0.1`** — genre-standard placeholder values,
internally consistent and playable, standing in until the project owner's authoritative
specification replaces them. See [`CLAUDE.md`](CLAUDE.md) for how to do that replacement.

## Layout

```
CLAUDE.md          Contributor and agent guide — read before changing anything
docs/              The two specifications
references/        Research behind the specs (map, gameplay, building, editing, ui)
src/               Game source
  core/            Loop, config, input, events, RNG, maths
  player/          Controller, camera
  building/        Grid, pieces, placement, structure integrity, targeting
  editing/         Edit pattern allow list, edit state machine
  combat/          Damage model, weapons, inventory, health
  world/           Terrain, POIs, storm, map loading, renderer
  loot/            Loot tables
  ui/              HUD
assets/            Runtime-ready assets (procedural fallback until art exists)
tests/             Vitest suite
```

## Design notes

- **Fixed 30 Hz simulation**, interpolated render. Gameplay code never sees frame time.
- **Deterministic.** Four named RNG streams from one match seed; same seed, same match.
- **Simulation is headless.** Everything outside `world/Renderer.js` and `ui/HUD.js` runs
  in Node, which is why the whole build/edit/combat model is unit-tested.
- **Build pieces are instanced**, one `InstancedMesh` per piece type and material.
