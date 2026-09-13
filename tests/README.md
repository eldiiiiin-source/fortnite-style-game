# tests/

Vitest, running in Node with no browser and no WebGL context.

```bash
npm test          # run once
npm run test:watch
```

## What these tests are for

They assert the code against the numbers in `docs/MASTER_SPEC.md` and `docs/MAP_SPEC.md`.
Expected values are quoted from the specs, and each `describe` names the spec section it
covers. **A spec change that the code has not caught up with shows as a failing test — that
is the point.** When one fails, fix the code or the spec, never the expected value in
isolation.

| File | Covers |
| --- | --- |
| `config.test.js` | Every tunable in `Config.js` against both specs |
| `building.test.js` | Grid addressing, placement rules, HP ramp, support cascade (§6) |
| `editing.test.js` | Edit pattern allow list and the edit state machine (§7) |
| `combat.test.js` | Damage, falloff, TTK table, spread, inventory, consumables (§3.1, §5) |
| `movement.test.js` | Movement, jumping, fall damage, camera, fixed-step loop (§2.1, §3) |
| `world.test.js` | Terrain generation, POI layout constraints, storm phases (MAP_SPEC) |
| `loot.test.js` | RNG determinism, rarity and class weights, loot guarantees (§8, §11.1) |
| `maploader.test.js` | Manifest loading, spawn candidates, harvestable density (MAP_SPEC §10) |
| `game.test.js` | End-to-end: the wired `Game` ticks headlessly and replays deterministically |

## Rules

- **No WebGL, no DOM.** Everything under test must run in plain Node. If a system cannot be
  tested without a renderer, the system is wired wrong — move the three.js parts behind the
  view layer (`src/world/Renderer.js`, `src/ui/HUD.js`, both untested by design).
- **No snapshot tests** of large objects. Assert the specific number the spec states.
- **Determinism is a test target.** Anything using the match RNG gets a same-seed replay
  assertion (`§11.1`).
- Tests that assert a table in `references/` cite it in a comment, so the two move together.
