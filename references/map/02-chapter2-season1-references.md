# Chapter 2 Season 1 — reference image notes

Observations from the five reference images supplied by the project owner on 2026-09-13.

> **These are observations, not specification.** They record what the reference images
> show so that the authoritative `docs/MAP_SPEC.md` can be written against them. Nothing
> here is binding until it appears in the spec. Do not implement from this file.

---

## Image 1 — River through pine country

Ground-level shot along a watercourse.

| Observation | Consequence for the spec |
| --- | --- |
| A flowing river with rapids and white water cuts through the terrain | The map needs a **river system**. The current spec has ocean and a heightmap, and no inland water at all. |
| Riverbed is lined with large angular boulders, grey-blue, low-poly faceted | Harvestable rock is a riverbank feature, not only a quarry feature |
| Conifers (pine/spruce) on grassy banks, moderate density | Matches a pine-forest biome |
| Water is bright turquoise-green, clearly shallow at the edges | Water depth varies; shallow wading vs. swimming matters (current spec has a single 1.2 m threshold) |
| Terrain is a shallow V-valley — the river sits in carved ground | Terrain generation must carve river channels, not just add noise |
| A small cabin with a dark roof sits on the right bank | Landmark-scale props sit next to water |
| Bright blue sky, scattered cumulus, strong soft shadows | Lighting: high sun, soft shadowing |

## Image 2 — Farmland (Frenzy Farm)

Aerial over an agricultural POI.

| Observation | Consequence for the spec |
| --- | --- |
| Large tilled crop fields in brown parallel rows | A **farmland biome** — absent from the current spec |
| Grass reads orange-yellow, distinct from the green elsewhere | Biomes are colour-separated for readability at altitude |
| Central two-storey farmhouse, white walls, dark roof | Multi-storey enterable buildings |
| Red barn and several outbuildings, plus silos | Prop kit: barn, silo, farmhouse, fence |
| Scattered broad deciduous/willow trees, low density | Farmland is open — long sightlines |
| A small pond at the field's edge | Inland ponds, not just the river |
| Footprint is large and flat, several hundred metres across | Major POIs are big and heavily flattened |

## Image 3 — Forest camp

Aerial over a wooded clearing.

| Observation | Consequence for the spec |
| --- | --- |
| Very dense deciduous canopy, near-continuous green | A **deciduous forest biome** distinct from pine; highest tree density on the map |
| Central clearing with cabins (teal/green roofs), tents, and RVs | Prop kit: cabin, tent, trailer |
| A fire pit with seating logs at the centre of the clearing | Small set-piece landmarks inside POIs |
| Small pond with a wooden dock/bridge | Wood-harvestable structures near water |
| Dirt paths radiate from the clearing | Paths, narrower than roads |
| Canopy almost fully occludes the ground | Sightlines here are very short — the opposite of farmland |

## Image 4 — Urban / commercial POI

Ground-to-low-air view of a built-up block.

| Observation | Consequence for the spec |
| --- | --- |
| Flat-roofed commercial buildings, roughly 1–3 storeys | Urban buildings are **low-rise**, not towers |
| Rooftops are walkable and hold AC units / solar panels | Roofs are playable space — matters for the camera and for build approaches |
| Large blue-glass windows on the main building | Breakable/see-through surfaces |
| Paved roads, sidewalks, a parking lot with parked cars | Vehicles as metal harvestables; roads as traversal |
| Ramps and short stair runs between levels | Level geometry needs sub-step traversal |
| Snow-capped mountains and pines in the background | A **snow/alpine biome** exists at the map edge |
| Terracotta plaza paving against tan concrete | Surface-type variety beyond grass/rock/sand |

## Image 5 — Full island map

The Chapter 2 Season 1 island. **Thirteen** named locations, read off the map:

| # | Name | Rough position |
| --- | --- | --- |
| 1 | Craggy Cliffs | North |
| 2 | Steamy Stacks | North-east |
| 3 | Pleasant Park | North-west of centre |
| 4 | Frenzy Farm | East of centre |
| 5 | Sweaty Sands | West coast |
| 6 | Salty Springs | Centre |
| 7 | Dirty Docks | East coast |
| 8 | Holly Hedges | West |
| 9 | Weeping Woods | West of centre, south |
| 10 | Retail Row | East, south of centre |
| 11 | Lazy Lake | South of centre |
| 12 | Slurpy Swamp | South-west |
| 13 | Misty Meadows | South |

Further structural observations:

- The island is **roughly circular** with a heavily indented coastline — bays, headlands,
  and a small archipelago off the north-west. The current spec's smooth radial falloff
  produces nothing like this shape.
- A **branching river network** runs from the north-east through the centre and out to the
  south and west, visibly connecting most POIs. It is the map's main structural spine.
- The **centre of the map is a lake with an island in it**, not high ground. The current
  spec puts a 190 m mountain (`Ember Peak`) at the centre, which is structurally opposite.
- **Snow and mountains sit in the south-east corner**, and appear as background in image 4.
- Sand beaches ring parts of the west and south coasts.
- POIs are distributed fairly evenly rather than clustered, with unnamed landmarks in the
  gaps.
- Named POI count is **13**, against the current spec's 15 (5 major / 5 minor / 5 landmark).

---

## Mismatches these images already establish

Recorded so the migration has a starting list even before the written spec lands.

| # | Current spec (`MAP_SPEC.md` v0.1) | Reference images | Severity |
| --- | --- | --- | --- |
| 1 | No inland water of any kind | A branching river system is the map's spine | **Structural** |
| 2 | 190 m mountain at map centre (`Ember Peak`) | Centre is a lake with an island | **Structural** |
| 3 | Smooth circular radial falloff coastline | Heavily indented coast, bays, offshore islands | **Structural** |
| 4 | Biomes: coastal, grassland, pine, quarry, massif | Needs farmland, deciduous forest, swamp, snow/alpine, urban | High |
| 5 | 15 invented POIs (`Cinder Town`, `Ember Peak`, …) | 13 named POIs, all different | High |
| 6 | No prop or building system; terrain only | Multi-storey enterable buildings, walkable roofs | High |
| 7 | Single 1.2 m swim threshold | Shallow wading vs. deep swimming are visibly distinct | Medium |
| 8 | Flat single-colour Lambert terrain | Stylised, saturated, biome-coloured, soft shadows | Medium |
| 9 | Roads only, 8 m wide | Roads, sidewalks, parking, dirt paths, plazas | Low |

## Still needed before any of this can be implemented

The written map specification. These images establish **shape and content**; they cannot
establish **numbers** — playable extent in metres, river width and depth, POI footprints
and coordinates, tile size, biome boundaries, or loot distribution. Those must come from
`docs/MAP_SPEC.md`.
