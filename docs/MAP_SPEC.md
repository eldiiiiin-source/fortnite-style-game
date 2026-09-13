# MAP SPEC — Original Battle Royale Island

| Field | Value |
| --- | --- |
| Status | **Authoritative — supplied by the project owner, 2026-09-13** |
| Version | 1.0.0 |
| Supersedes | Baseline v0.1.0 ("Cinder Isle") — void |
| Companion | `docs/MASTER_SPEC.md`, `references/map/` |

**If the implementation conflicts with this document, this document wins.**

## 0. Goal

An **original** battle royale island using early-Chapter-2 *environmental design language* —
not a recreation. Bright, clean, colourful, readable, calm between fights; large smooth
terrain forms, connected rivers, open countryside, clearly separated POIs, stylised
architecture, low visual clutter, strong gameplay readability.

**Never copied:** island shape, POI layouts, buildings, textures, props, logos, assets from
any shipped game. Original geography, locations, names, assets and architecture throughout.

## 1. Development priority [OWNER]

**Do not build the entire final island immediately.** First a smaller polished region
proving terrain scale, movement feel, building scale, combat readability, POI spacing,
water traversal, countryside density and performance.

**Initial playable target: ~1/4 to 1/3 of the final island.**

Expansion happens only after: movement, camera, building, editing, edited collision,
combat, inventory and loot are stable, bots navigate, and performance is acceptable.

## 2. Reference images [OWNER]

`references/map/` images are **authoritative visual references, used by category**. Each
image governs only its assigned category. **Do not combine every image into every
location.**

| Image | Governs | Notes |
| --- | --- | --- |
| `01_full_map_layout` | Macro composition, water network, POI spacing, biome balance, road placement, regional distribution, open space | **Do not copy the island shape** |
| `02_rolling_hills_river` | **Main terrain reference.** Hill scale, smooth slopes, broad forms, long sightlines, river width, vegetation spacing, atmospheric scale, colour feeling | **Higher priority than decorative references** |
| `03_lazy_lake_architecture` | **One** modern/upscale town: clean streets, multi-storey buildings, landscaping, plazas, modern homes, water integration, surrounding hills | Not the whole map |
| `04_pleasant_park_suburbs` | **One** suburban town: detached houses, lawns, roads, sidewalks, central open space, sports field, garages, residential spacing | |
| `05_weeping_woods_forest` | Main forest: large tree silhouettes, clusters, open floor, clearings, cabins, campsites, rivers through forest | **Trees are never uniform** |
| `06_frenzy_farm_fields` | Farmland: open fields, long sightlines, barns, silos, fences, dirt paths, sparse tree groups, large uninterrupted space | |
| `07_sweaty_sands_coast` | Coast: sandy shoreline, small resort buildings, pier, boardwalk, beach structures, bright architecture, open space | |
| `08_misty_meadows_village` | **One** compact lakeside village: grouped buildings, pitched roofs, bridge, water, hills, narrow streets, central landmark | |
| `09_slurpy_swamp_industrial` | **One** darker wetland/industrial region: marsh water, pipes, tanks, bridges, factory geometry, darker vegetation, wet ground | **Keep darkness to this one region** |
| `10_countryside_between_pois` | **Extremely important.** The majority of terrain between named locations | See §7 |

The existing analysis in `references/map/02-chapter2-season1-references.md` remains valid
and is read alongside this spec.

## 3. Environmental design language [OWNER]

**Feel:** peaceful when not fighting, bright, colourful, clean, slightly exaggerated,
readable, stylised, inviting, nostalgic.

**Avoid:** gritty realism, hyper-realistic terrain, cyberpunk, futuristic neon, constant
fog, excessive bloom, grey landscapes, dense clutter, visual noise, overly detailed realism.

## 4. Terrain [OWNER]

**Broad smooth shapes.** Large rolling hills, gentle valleys, river valleys, open slopes,
ridgelines, plateaus, occasional cliffs, occasional steep hills, natural elevation variation.

**Avoid: tiny procedural bumps, noisy terrain, random elevation everywhere, constant steep
slopes, jagged realistic mountains, terrain that catches the player.**

> **This voids the baseline's terrain generator.** It ran a 3-octave detail layer at
> `1/64` frequency with 4 m amplitude — literally "tiny procedural bumps" — on top of a
> 5-octave base. Replaced with few, large, smooth forms and no high-frequency detail layer.

### 4.1 Readability [OWNER]

From medium and long distance the player immediately recognises high ground, low ground,
river routes, roads, POIs, tree lines and open fields. **Silhouette matters more than
detail.**

### 4.2 Height variation [OWNER]

Required: low valleys, mid-level hills, high ridges, occasional cliffs, elevated POIs,
river cuts. **Avoid extreme elevation everywhere.**

### 4.3 Long sightlines [OWNER]

From elevated positions the player should often see a POI, a water feature, a terrain
landmark, a tree line, a road, a distant hill. **Do not hide the world behind constant
terrain walls.**

## 5. Water system [OWNER]

**Water is a major part of the island identity** and acts as a **major navigation
structure**.

Required: **one major lake**, **several branching rivers**, smaller ponds, river bends,
bridges, docks, **waterfalls where elevation changes**, coastal water, riverbanks, wetland
areas. Water connects regions naturally.

> **Entirely absent from the baseline**, which had ocean and a heightmap and no inland
> water whatsoever. Built from scratch; rivers are carved into the heightfield so banks and
> valleys are part of the terrain rather than decals on top of it.

**Style:** stylised bright water — blue, turquoise, clean, readable, reflective but not
mirror-like. Avoid dark photorealistic water, muddy water everywhere, excessive
transparency, expensive simulation.

## 6. POIs [OWNER]

Each major POI has a **distinct identity**. Major buildings are never scattered randomly.
POIs are **separated by meaningful countryside**.

Each POI needs: unique silhouette, recognisable landmark, several loot routes, multiple
entrances, vertical gameplay, nearby natural terrain, roads connecting it to the map, and
**combat-friendly building scale**.

### 6.1 Initial region POIs [OWNER]

| # | Type | Required | Notes |
| --- | --- | --- | --- |
| 1 | Suburban town | Yes | Detached houses, lawns, garages, roads, sidewalks, trees, sports field, open central green, small shop. **Spacious — do not cram houses together.** |
| 2 | Modern town | Yes | Modern homes, apartments, shops, plazas, parking, fountains, landscaping, nearby water, surrounding hills. **Compact — not a giant city.** |
| 3 | Farm | Yes | Fields, farmhouse, barns, silos, fences, dirt paths, farm props, few tree groups. **Long sightlines.** |
| 4 | Forest | Yes | Dense clusters, clearings, cabins, campsites, streams, bridges, trails, hidden loot. Visibility reduced but playable. |
| 5 | Coastal area | Yes | Beach, pier, boardwalk, small hotel, beach houses, shops, parking, docks. Bright and open. |
| 6 | Lake / river hub | Yes | The major lake and the river confluence |
| 7 | Small industrial / wetland | Optional | Marsh channels, factory buildings, tanks, pipes, bridges, darker vegetation, wet terrain, warehouses. **One region only.** |
| 8 | Small lakeside village | Optional | Compact houses, pitched roofs, bridge, central street, tower landmark, lake access, nearby hills |

**Do not try to build every final biome immediately.**

## 7. Countryside between POIs [OWNER]

> "This is one of the most important parts of the map. Most of the world should NOT be
> named locations."

Between POIs the player should often see only: grass, rolling terrain, a few trees, one
road, a river, rocks, one small house, a bridge, a cabin, distant landmarks.

**Empty space is intentional. Do not fill every empty area.**

Never used as filler: random towers, unnecessary factories, excessive props, dense
buildings, huge numbers of rocks, clutter every few metres.

### 7.1 Landmarks [OWNER]

Memorable but **sparse**: isolated house, cabin, gas station, radio tower, campsite,
fishing hut, roadside shop, barn, warehouse, bridge, dock, waterfall, tiny island.
**Do not spam landmarks.**

## 8. Roads [OWNER]

Roads connect POIs, follow terrain, **curve naturally**, cross rivers using bridges, use
intersections, and include small country roads and dirt roads.

**Avoid perfectly straight road grids outside towns.**

## 9. Vegetation [OWNER]

Stylised. Required types: large deciduous trees, pine trees, bushes, hedges, flowers,
reeds, grass, occasional fallen logs.

**Placement must be intentional** — clusters, tree lines, clearings, isolated trees.
**Never uniformly scattered.**

> **This voids the baseline's vegetation model**, which placed trees by a flat per-cell
> biome density — uniform scatter, exactly what the spec forbids.

**Density:** preserve open sightlines. Some hills have almost no trees. Some valleys have
tree lines. Forests feel dense only where intended. **Do not fill the island with foliage.**

## 10. Colour and lighting [OWNER]

**Palette:** lush medium-green grass, bright blue sky, turquoise water, warm brown dirt,
soft grey rocks, rich but controlled foliage, colourful buildings.
Avoid washed-out colours, muddy realism, neon, monochrome terrain, excessive saturation.

**Lighting:** a clear pleasant afternoon — soft sunlight, readable shadows, bright sky,
moderate contrast, clear silhouettes.
Avoid heavy fog, dark exposure, orange sunset everywhere, extreme bloom, harsh realism.

## 11. Architecture [OWNER]

Stylised proportions: chunky walls, simple readable roofs, large windows, **large
doorways**, clean shapes, simplified materials, slightly exaggerated scale.

**Buildings must support combat.** Important buildings include multiple entrances, multiple
exits, windows, roof access, stairs, loot spaces and vertical combat options.

**Do not create cramped realistic interiors. Gameplay scale beats architectural realism.**

## 12. World scale [OWNER]

The environment respects the approved gameplay module: **build grid 5.12 m, wall height
3.84 m** (`MASTER_SPEC §9.1`).

World scale must be compatible with player movement, building, doors, roads, rooms, stairs,
windows and combat spaces. **Do not build real-world-scale architecture that feels too
small for fast gameplay.**

### 12.1 Architecture derives from the build module [OWNER-derived]

Per `MASTER_SPEC §9.1.1`, architectural dimensions are expressed as multiples of the build
module so world and build scale can never drift apart:

| Element | Derivation | Value |
| --- | --- | --- |
| Storey height | `WALL_H` | 3.84 m |
| Room module | `TILE` | 5.12 m |
| Doorway width | `TILE / 3` | 1.71 m |
| Doorway height | `WALL_H × 2/3` | 2.56 m |
| Road width | `TILE × 1.5` | 7.68 m |
| Bridge width | `TILE` | 5.12 m |

A doorway therefore matches an edited wall door exactly, and a storey matches one build
layer — so a player can build inside a building and have it line up.

### 12.2 Map scale [OWNER]

The first region must be large enough for several minutes of traversal, multiple fights,
loot routes, different terrain types, bot navigation and storm testing — yet small enough
to maintain performance, test quickly, iterate quickly and keep POIs polished.

| Parameter | Value | Marker |
| --- | --- | --- |
| Initial region extent | 1024 m × 1024 m (200 × 200 build tiles) | [PROV] |
| Implied final island | ~2048–3072 m (region is ~1/4 to ~1/9 of area) | [PROV] |

> The baseline's 2048 m island is retained as the *eventual* target, not as what gets
> built now.

## 13. Navigation [OWNER]

Players navigate by roads, rivers, landmarks, hill silhouettes, POIs and coastline.
**The world should not require the minimap for every decision.**

## 14. Loot distribution [OWNER]

Loot exists in POIs, isolated houses, small landmarks, chests, floor loot, industrial
buildings, farm structures and cabins. **POIs have more loot than countryside, but
countryside still rewards exploration.**

## 15. Bot navigation [OWNER]

Terrain and architecture must support bots.

**Avoid:** overly complex collision, tiny doorways, cluttered nav spaces, impossible
ledges, narrow stairs, geometry traps.

Bots must traverse roads, enter and exit buildings, **move through edited builds where
appropriate**, cross bridges, move around rivers, reach POIs and rotate through the storm.

## 16. Performance [OWNER]

**Stable 60 FPS is a hard target.**

When performance drops, reduce: distant props, shadow complexity, foliage density,
particles, small decorative meshes, draw calls, terrain detail.

**Never reduce:** movement update rate, build responsiveness, edit responsiveness,
collision correctness, shooting feedback.

**LOD:** far objects simplify — trees, rocks, buildings, distant props. No detail outside
combat-relevant distance.

**Streaming:** region/chunk streaming when size requires it. **Streaming must not cause
visible gameplay hitches during combat.**

## 17. Map validation tests [OWNER]

| Area | Required |
| --- | --- |
| Terrain | Smooth traversal, no snagging, no impossible slopes, no random holes, no floating props |
| Roads | Continuous, readable, bridges align, no collision traps |
| Water | Correct shoreline, no broken transitions, swim traversal works where intended |
| POIs | Multiple entrances, multiple routes, loot path works, bots navigate, roofs reachable where intended |
| Countryside | Not overcrowded, meaningful open space, good sightlines |
| Performance | Stable frame rate, no major stutters, distant areas simplified |

## 18. Implementation workflow [OWNER]

1. Rewrite this document ✅
2. Inspect current map implementation
3. Compare baseline against this spec
4. List major mismatches briefly
5. **Preserve useful existing terrain systems only if compatible**
6. **Do not expand the island**
7. **Begin Phase 1 of the gameplay implementation**
8. **Keep map work limited to what gameplay testing needs**
9. Create the first polished test region only after core systems are stable
10. Run tests, lint and build after each major phase

## 19. Final standard [OWNER]

> "An original bright, peaceful, readable battle royale island with strong early Chapter 2
> environmental DNA."

Most important: broad smooth hills, long sightlines, connected rivers, clear POI spacing,
open countryside, bright palette, controlled vegetation, readable architecture, low
clutter, stable performance.

**When in doubt: less clutter, bigger terrain shapes, more open space, clearer POIs,
stronger landmarks, better performance.**

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-09-13 | Replaced the "Cinder Isle" baseline with the owner's authoritative map specification. Voids: the 190 m central massif, the high-frequency detail noise layer, uniform vegetation scatter, the 15 invented POIs, and the absence of any water system. Adds the reference-image category rules, the connected water network, countryside-first philosophy, and architecture derived from the build module. |
| 0.1.0 | 2026-09-13 | Initial baseline placeholder. Void. |
