# assets/maps/poi/

Authored POI layouts, one JSON per POI (`MAP_SPEC §10` step 2). Named after the POI in
kebab-case: `cinder-town.json`, `ember-peak.json`.

## Schema

```json
{
  "id": 1,
  "name": "Cinder Town",
  "tier": "major",
  "centre": [-320, -280],
  "base": 22,
  "footprint": [300, 260],
  "props": [
    { "model": "building-a", "position": [-340, 22, -300], "rotation": 0, "scale": 1 }
  ],
  "chestPoints":     [[-330, 25, -290]],
  "floorLootPoints": [[-310, 22, -270]],
  "ammoBoxPoints":   [[-320, 22, -280]],
  "harvestables": [
    { "kind": "container", "position": [-300, 22, -260] }
  ]
}
```

- `chestPoints`, `floorLootPoints` and `ammoBoxPoints` are *candidate* positions. Each one
  rolls independently at match start against the chances in `MAP_SPEC §6.2`, so the counts
  here should exceed the §5.2 target by roughly the inverse of the spawn chance.
- `harvestables` overrides the biome density (`MAP_SPEC §6.1`) inside the footprint. The
  total must meet the tier's material budget in §5.2.
- `kind` must be a key of `HARVEST.sources` in `src/core/Config.js`.

None authored yet — POIs are synthesised from the `MAP_SPEC §5.3` table meanwhile.
