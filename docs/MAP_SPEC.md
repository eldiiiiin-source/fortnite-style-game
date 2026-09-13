# MAP SPEC — World

| Field | Value |
| --- | --- |
| Status | **Baseline v0.1 — awaiting the user's authoritative specification** |
| Version | 0.1.0 |
| Owner | eldin.omerhodzic@icloud.com |
| Scope | World dimensions, terrain, biomes, POIs, harvestables, loot distribution, drop path, streaming |
| Companion | `docs/MASTER_SPEC.md` (gameplay rules that consume these values) |

> **Read before editing.** This is a placeholder island that is internally consistent and
> buildable today, pending the owner's authoritative map specification. Keep the section
> numbering when replacing it — code and tests cite `MAP_SPEC §n`.

---

## 1. Map identity

**Name:** Cinder Isle
**Shape:** Roughly circular island, ocean on all sides, one central massif.
**Tone:** Temperate, bright, high-contrast. Readable silhouettes at 200 m.

## 2. Dimensions

| Parameter | Value |
| --- | --- |
| Playable extent | 2048 m × 2048 m |
| World bounds (incl. ocean skirt) | 2560 m × 2560 m |
| Build grid tiles across playable | 400 × 400 (5.12 m tiles, `MASTER_SPEC §6.1`) |
| Terrain heightmap resolution | 1025 × 1025 (2 m per texel) |
| Sea level | `y = 0 m` |
| Lowest terrain | −8 m (ocean floor near shore) |
| Highest terrain | 190 m (Ember Peak summit) |
| Build ceiling | 260 m above sea level |
| Hard kill floor | −40 m |

Origin `(0, 0, 0)` is the map centre at sea level. The playable square spans
`x, z ∈ [−1024, 1024]`.

## 3. Boundaries and zones

### 3.1 Ocean and edges

Beyond the playable extent the terrain falls to ocean. A player who swims past 1024 m on
either axis takes 10 DPS and is pushed back toward shore. Building is disabled outside
the playable extent.

### 3.2 Safe zone

| Parameter | Value |
| --- | --- |
| Initial safe-zone radius | 980 m (covers the playable island) |
| Initial centre | `(0, 0)` ± 180 m jitter, drawn from the `storm` RNG stream |
| Phase radii | See `MASTER_SPEC §9` (fractions of the initial radius) |

### 3.3 Height bands

| Band | Elevation | Use |
| --- | --- | --- |
| Shore | 0 – 6 m | Beaches, docks, low loot |
| Lowland | 6 – 35 m | Fields, roads, most POIs |
| Upland | 35 – 90 m | Forest, quarry, ridge routes |
| Massif | 90 – 190 m | Ember Peak, high-tier loot, exposed |

### 3.4 Build ceiling

Building is blocked above `y = 260 m`. The ghost turns red and placement is rejected
(`MASTER_SPEC §6.3` rule 4). This is an absolute altitude, not relative to terrain.

## 4. Terrain

### 4.1 Generation

Terrain is authored as a heightmap (`assets/maps/cinder-isle.heightmap.png`, 16-bit
greyscale, 1025²) plus a splat map for materials. Until authored art exists, the
runtime generates an equivalent island procedurally from the map seed:

| Layer | Parameters |
| --- | --- |
| Island falloff | Radial, 1.0 at centre → 0.0 at 1100 m, smoothstep |
| Base noise | fBm, 5 octaves, base frequency `1/512`, lacunarity 2.0, gain 0.5, amplitude 120 m |
| Ridge noise | Ridged fBm, 3 octaves, base frequency `1/256`, amplitude 60 m, masked to the massif |
| Detail | fBm, 3 octaves, base frequency `1/64`, amplitude 4 m |
| Flattening | POI footprints (§5) are flattened to their listed base elevation with a 24 m blend skirt |

### 4.2 Collision

Terrain collision is a heightfield sampled bilinearly. Slopes above 48° are non-walkable
(`MASTER_SPEC §3.2`) and the player slides at 6 m/s down the gradient.

### 4.3 Surface types

| Surface | Footstep | Friction modifier |
| --- | --- | --- |
| Grass | soft | ×1.00 |
| Sand | soft | ×0.92 |
| Rock | hard | ×1.00 |
| Road / concrete | hard | ×1.03 |
| Wood deck | hollow | ×1.00 |
| Water (shallow, < 1.2 m) | splash | ×0.80 |

Water deeper than 1.2 m is swimmable: speed 3.4 m/s, no building, no firing, no fall damage.

## 5. Biomes and points of interest

### 5.1 Biomes

| Biome | Region | Character |
| --- | --- | --- |
| Coastal | Outer ring, 0 – 6 m | Sand, dunes, palms, boat wrecks |
| Grassland | North and east lowland | Open fields, hedgerows, long sightlines |
| Pine Forest | West upland | Dense wood, short sightlines, best wood income |
| Quarry Badlands | South upland | Exposed rock, terraces, best stone income |
| Ember Massif | Centre | Bare rock, cliffs, the map's height advantage |

### 5.2 POI tiers

| Tier | Chests | Floor loot | Loot quality | Materials |
| --- | --- | --- | --- | --- |
| Major | 12 – 18 | 22 – 30 | High (`§6.3` table) | ≥ 4000 total |
| Minor | 5 – 8 | 10 – 15 | Medium | ≥ 2000 total |
| Landmark | 1 – 3 | 3 – 6 | Low | ≥ 800 total |

### 5.3 POI list

Coordinates are the POI centre `(x, z)` in metres; `base` is the flattened elevation.

| # | Name | Tier | Centre | Base | Footprint | Biome | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Cinder Town** | Major | `(−320, −280)` | 22 m | 300 × 260 m | Grassland | Dense multi-storey blocks, metal-rich, the map's primary hot drop |
| 2 | **Ember Peak** | Major | `(40, 60)` | 150 m | 260 × 240 m | Ember Massif | Summit complex, highest ground on the map, exposed approach |
| 3 | **Pinehollow** | Major | `(−520, 340)` | 48 m | 280 × 220 m | Pine Forest | Cabins and a sawmill, huge wood income, tight sightlines |
| 4 | **Greyshale Quarry** | Major | `(310, 470)` | 62 m | 320 × 280 m | Quarry Badlands | Terraced pit, enormous stone income, vertical fights |
| 5 | **Harbour Point** | Major | `(620, −180)` | 5 m | 260 × 200 m | Coastal | Cranes, containers, metal-rich, long water flank |
| 6 | **Copper Mill** | Minor | `(−80, 560)` | 30 m | 160 × 140 m | Grassland | Industrial, metal |
| 7 | **Lakeside Cabins** | Minor | `(−640, −80)` | 14 m | 150 × 120 m | Coastal | Wood, shallow lake to the west |
| 8 | **Ridge Station** | Minor | `(240, 140)` | 96 m | 140 × 110 m | Ember Massif | Cable-car station, route to Ember Peak |
| 9 | **Windmill Fields** | Minor | `(−280, 700)` | 26 m | 170 × 150 m | Grassland | Open, farmhouses, wood |
| 10 | **Saltflat Docks** | Minor | `(760, 420)` | 3 m | 150 × 130 m | Coastal | Boats, wood and metal |
| 11 | **The Overlook** | Landmark | `(120, −520)` | 74 m | 70 × 70 m | Grassland | Single tower, sightline over Cinder Town |
| 12 | **Stone Circle** | Landmark | `(−760, 620)` | 52 m | 60 × 60 m | Pine Forest | Ruins, stone |
| 13 | **Crashed Freighter** | Landmark | `(880, −540)` | 2 m | 90 × 60 m | Coastal | Metal-heavy wreck |
| 14 | **Radio Mast** | Landmark | `(520, 780)` | 58 m | 50 × 50 m | Quarry Badlands | Climbable mast, metal |
| 15 | **Old Bridge** | Landmark | `(−120, −760)` | 12 m | 180 × 40 m | Coastal | River crossing, stone |

Distance between any two Major POI centres is at least 420 m so that early fights are not
forced.

### 5.4 Roads

A ring road follows roughly `r = 620 m` and connects POIs 1, 5, 4, 9, 3. Two spur roads
climb to Ridge Station and Ember Peak. Roads are 8 m wide, flattened, and provide long
sightlines with harvestable streetlights every 40 m.

## 6. Harvestables and loot distribution

### 6.1 Harvestable density

Per 100 m × 100 m cell, by biome. Yields are in `MASTER_SPEC §4.2`.

| Biome | Trees | Rocks | Metal objects |
| --- | --- | --- | --- |
| Coastal | 6 | 4 | 5 |
| Grassland | 10 | 3 | 2 |
| Pine Forest | 34 | 2 | 1 |
| Quarry Badlands | 3 | 26 | 4 |
| Ember Massif | 2 | 18 | 1 |

Inside a POI footprint, density is replaced by the POI's authored material budget (§5.2).

### 6.2 Chest and floor-loot placement

Spawn points are authored per POI and fixed for the map. Each spawn point rolls
independently at match start from the `loot` RNG stream:

| Spawn kind | Spawn chance |
| --- | --- |
| Chest point | 60 % |
| Floor-loot point | 75 % |
| Ammo box point | 55 % |

Outside POIs, floor loot spawns at landmark props (vehicles, campsites, sheds) at 35 %.

Total expected loot at match start: 95 – 125 chests, 210 – 260 floor items.

### 6.3 Weapon class weights by POI tier

Rolled after rarity (`MASTER_SPEC §8.2`).

| Class | Major | Minor | Landmark | Outside |
| --- | --- | --- | --- | --- |
| Assault Rifle | 24 % | 24 % | 26 % | 26 % |
| SMG | 20 % | 21 % | 22 % | 22 % |
| Pump Shotgun | 13 % | 13 % | 12 % | 12 % |
| Tactical Shotgun | 13 % | 13 % | 12 % | 12 % |
| Pistol | 12 % | 14 % | 18 % | 19 % |
| Bolt Sniper | 11 % | 10 % | 8 % | 8 % |
| Rocket Launcher | 7 % | 5 % | 2 % | 1 % |

### 6.4 Material budget check

A player who lands at a Major POI and harvests for 60 s should reach roughly 300 – 400 of
the local material. A player in the open should reach 150 – 220. If tuning drifts outside
those bands, adjust §6.1 densities rather than `MASTER_SPEC §4.2` yields.

## 7. Drop path

| Parameter | Value |
| --- | --- |
| Path | A straight chord across the map, entry and exit points on the 1300 m circle |
| Path bearing | Random per match from the `storm` stream |
| Drop altitude | 600 m |
| Glide speed | 26 m/s horizontal, 22 m/s descent; dive 55 m/s descent, 34 m/s horizontal |
| Auto-deploy | Glider deploys at 60 m above terrain |
| Landing | No fall damage from a glider landing |

## 8. Lighting and atmosphere

| Parameter | Value |
| --- | --- |
| Time of day | Fixed per match, drawn from `cosmetic` stream: Morning, Noon, Golden, Dusk |
| Sun elevation | 22° / 68° / 12° / 4° respectively |
| Shadow cascades | 4, max distance 220 m |
| Fog | Exponential-squared, density 0.0018, tinted to the sky palette |
| Draw distance | 1400 m for terrain, 400 m for props, 300 m for build pieces |

HUD contrast must hold against all four palettes (`MASTER_SPEC §10`).

## 9. Streaming and performance

| Parameter | Value |
| --- | --- |
| Terrain chunk | 128 m × 128 m, 16 × 16 grid over the playable extent |
| Terrain LODs | 4 (full, ½, ¼, ⅛), switched at 200 / 450 / 800 m |
| Prop streaming | Chunk-based, load radius 500 m, unload radius 650 m |
| Build-piece culling | Frustum + 300 m distance, instanced per `MASTER_SPEC §11.2` |
| Chunk budget | ≤ 6 ms to build one chunk's collision + mesh; build off the main thread |

Every chunk must be independently loadable; no chunk may depend on a neighbour having
loaded except for LOD-seam stitching.

## 10. Authoring workflow

1. Heightmap and splat map are authored externally and written to `assets/maps/`.
2. POI layouts are authored as JSON in `assets/maps/poi/<name>.json`: prop transforms,
   chest points, floor-loot points, harvestable overrides.
3. `src/world/MapLoader.js` reads the manifest `assets/maps/cinder-isle.json`, which lists
   the heightmap, splat map, POI files, and the values in §2 and §3.
4. Until authored assets exist, `src/world/TerrainGenerator.js` produces §4.1 procedurally
   from the map seed and `MapLoader` synthesises POIs from the §5.3 table.

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-09-13 | Initial baseline. Placeholder pending the owner's authoritative spec. |
