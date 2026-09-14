# MAP SPEC — Original Battle Royale Island

| Field | Value |
| --- | --- |
| Status | **Authoritative — supplied by the project owner, 2026-09-13** |
| Version | 1.4.1 |
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

## 20. First playable island — visual overhaul [OWNER, 2026-09-14]

**[OWNER] direction:** *"I want the game to visually jump from prototype field to real
stylized battle royale island."* The characters are ahead of the world; this section is the
world catching up. It supersedes §18's "keep map work limited to what gameplay testing
needs" — that constraint applied while the core systems were being proven, and they now are.

Priority order when any two goals conflict, owner-set:
**1. gameplay readability · 2. third-person combat clarity · 3. visual identity ·
4. traversal quality · 5. beauty · 6. extra detail.**

### 20.1 The architectural decision: POI structures are build pieces

Every building on the island is placed into the **existing build grid** as real
`BuildPiece`s at match start, not as decorative meshes.

This is the single most important choice in the overhaul, because it buys, with no change
to the collision hot path:

- collision — a house stops bullets and bodies because every piece already does;
- destructibility — players harvest and blow through walls exactly as they do their own;
- cover and build interaction — structures participate in build fights natively;
- rendering — the instanced wood/brick/metal meshes already draw them.

The alternative, static world colliders, would mean touching `CollisionWorld`, which is the
one system a visual pass must not destabilise. **No new collision path may be added for
world art.** Anything that must block a player is a build piece; anything that need not is
visual only.

### 20.2 Terrain form

Hand-authored, not noise. The heightfield is a sum of named smooth primitives — domes,
ridges, basins, plateaus and a carved river valley — each with zero gradient at its rim, so
nothing catches the player (§4). A low-amplitude, long-wavelength roll is layered over the
whole island so no area is billiard-table flat, capped well under the step height so it
never affects movement.

Required forms: rolling hills, at least one steeper cliff edge, flat combat plateaus
between elevation shifts, and a valley the water runs through.

### 20.3 Water

A winding river from high ground to the coast, plus a lake. Both are carved **below sea
level** into the heightfield, so the existing single sea plane renders them with no new
water system. Shorelines are graded, not stepped: a sand band, then grass.

### 20.4 Roads

A polyline network joining the POIs. A road flattens the terrain under it toward its own
centreline height, so a road is always walkable and always reads as a route from the air.
Roads are a surface type, not a prop.

### 20.5 Surface types

The terrain reports a surface at every point — `grass`, `dirt`, `sand`, `rock`, `road`,
`field` — driven by height, slope, water proximity and the road network. Terrain meshes are
vertex-coloured from it, and the minimap samples the same function, so the map and the
world can never disagree about where the river or the roads are.

### 20.6 Vegetation

Instanced trees, boulders and bushes, placed by an authored cluster list rather than
scattered uniformly (§9). Placement respects roads, water and POI footprints. Trees and
rocks that are harvestable are the same entries the loot layer already consumes.

### 20.7 POIs for the first island

Six original locations, deliberately small and readable. Names are working identity, not
final branding, and none reproduces any existing game's location.

| POI | Identity | Combat role |
| --- | --- | --- |
| Hollow Farm | Barn, silo, farmhouse, fenced field | Long sightlines, big interior |
| Pumpjack Stop | Roadside service building, canopy, pumps | Fast loot, close quarters |
| Kettle Row | Small cluster of pitched-roof houses | Urban rotation, rooftop fights |
| Riverwatch | Dock and stilted cabin on the water | Low ground, exposed approach |
| Crown Post | Hilltop outpost with a tower | High ground, long range |
| Dray Yard | Warehouse and container yard | Hard cover, industrial interior |

Each must have a distinct silhouette, interior or sheltered loot, cover to fight from, and
enough open ground beside it to build in.

### 20.8 Lighting and atmosphere

Bright stylised daytime. A warm low-angle key light with a cool sky ambient, a sky gradient
rather than a flat fill, and fog tuned to give depth without haze. Characters and build
pieces must stay the highest-contrast things on screen — the world is the backdrop, never
the subject.

### 20.9 Required tests

1. The island exposes the same terrain API the region did, so every consumer keeps working.
2. Terrain is continuous: sampled 0.1 m apart, no height delta anywhere on the island
   exceeds a step height. Measured at a fine spacing deliberately — a cliff is *steep*, and
   a test at 1 m spacing would either ban cliffs or prove nothing about continuity.
3. Every road point is walkable.
4. Water sits below sea level and land beside it above, so shorelines read.
5. Every POI footprint is on walkable, non-flooded ground.
6. POI structures are build pieces and appear in the grid.
7. Vegetation never spawns on a road, in water, or inside a POI footprint.
8. The spawn point and every bot spawn is on dry walkable land.
9. Loot, props and bot spawns stay inside the island bounds.

## 21. POI architecture, interiors and detail [OWNER, 2026-09-14]

**[OWNER] direction:** make the six existing POIs feel like real, memorable locations
rather than shells. **The macro world layout is frozen** — terrain, river, lake, roads,
minimap surface logic and island architecture are not to be redesigned. This section
governs buildings, interiors, loot, props and POI identity only.

### 21.1 Silhouette identity

From medium distance each POI must be distinguishable without the map:

| POI | Silhouette |
| --- | --- |
| Hollow Farm | Long barn beside a tall capped silo |
| Pumpjack Stop | Flat-roofed station under a wide forecourt canopy |
| Kettle Row | A run of pitched roofs under a neighbourhood water tower |
| Riverwatch | A stilted cabin, a boardwalk to the water, a net-drying frame on the bank |
| Crown Post | A five-storey tower on the skyline |
| Dray Yard | Wide flat warehouses under a loading gantry, with container stacks |

#### 21.1.1 Landmarks [OWNER-derived]

A POI built only from the buildings its function needs reads as a smudge at 70 m. Three of
the six did: Kettle Row, Riverwatch and Dray Yard are all low and horizontal, and a player
could not name them from across the valley. Each therefore carries **one** vertical landmark.

Rules for a landmark:

- **One per POI, and only where it is needed.** Hollow Farm's silo, Pumpjack Stop's canopy
  and Crown Post's tower already do this job; adding more would flatten the contrast between
  POIs rather than sharpen it.
- **It out-tops its own POI by at least a storey, and never out-tops Crown Post.** Crown
  Post is the island's landmark, and that is measured in ABSOLUTE height — it stands on a
  hilltop, so counting storeys above each POI's own base would rank a water tower its equal.
- **It is a silhouette, not a position.** No stair, no internal floor: a landmark is cover
  and a navigation cue, never a tower to hold. Players may still build up to it.
- **It stands clear of the POI's combat space** — off the street, off the yard floor, out of
  the interiors and loot route.
- **It is founded on dry, grounded cells.** A post over even 0.2 m of water never reaches
  terrain, so support propagation would delete its column and leave the span hanging.

Landmarks are assembled from shared primitives — `shaft`, `beam` — so a water tower, a
gantry and a drying frame are the same two parts at different scales and materials.

### 21.2 Architecture comes from the edit system

A doorway is **not** a missing wall. It is a wall carrying the edit pattern `4,7`; a window
is one carrying `3,5`; a counter or a fence rail is `0,1,2,3,4,5`.

This matters beyond looks: `PieceGeometry` derives the mesh **and** the collider from the
same pattern, so a framed opening is automatically walkable and a window automatically
blocks the body but not the sightline. Building façades this way added no collision code.

Openings in use: door `4,7`, arch `1,4,7`, door-with-window `3,4,7`, window `4`, paired
windows `3,5`, clerestory `1`, half wall `0,1,2,3,4,5`, open top `0,1,2`.

### 21.2.1 Buildings settle on flat, storey-aligned ground [OWNER-derived]

The build grid is discrete in storeys; the terrain is not. A POI founded on one height
sample therefore stands partly in its own ground. Kettle Row is a 67 m street whose centre
sat on level ground while its far houses stood **7.3 m into the hill** — an entire ground
floor underground, only the roofs showing.

Three rules, together, make a POI buildable:

1. **The pad covers the footprint.** The flat core is sized and centred on the blueprint's
   own footprint, not on a fraction of the POI radius. It is measured from the footprint's
   CENTRE and per axis — a blueprint's origin is a corner, so a radius taken from it is
   twice what the buildings need, and pads that large overlap their neighbours.
2. **The pad lands on a storey line.** Snapped to a multiple of `WALL_H`, so a building's
   base storey coincides with its ground exactly rather than up to a storey below it.
3. **The pad's apron stays walkable.** The blend from pad to natural ground carries the
   whole drop at under `MOVEMENT.maxWalkableSlopeDeg`; a short apron turned the spine road
   onto a 54° ramp and it stopped being a road.

Where two pads overlap they are averaged by an influence weight that diverges at the core,
so each POI's own ground stays dead flat while the ground between them stays continuous.
Picking the nearer pad outright is discontinuous and leaves a one-storey cliff.

A POI whose footprint lands in water is **settled**: its marker stays exactly where the map
puts it and its buildings step to the nearest dry origin within `WORLD.poiSettleReach`. A
`waterside` POI is exempt — it is meant to stand over water — but is founded on the median
of its DRY cells, so a stilted cabin sits on its bank with the dock reaching out over the
channel, rather than 10.9 m below the bank it belongs to.

#### 21.2.2 A building over water stands on real pilings [OWNER-derived]

Riverwatch's cabin spans a ravine. It was drawn as a stilted cabin but built without stilts:
a floor slab in mid-air with a house on top, held up by nothing. Under live structural
integrity (MASTER_SPEC §9.5.1) the support model was right to reject all 67 of its pieces.

A building that stands over water carries **pilings** — a stack of walls from the riverbed
to the underside of its floor, at the corners that bear the load. They are built from
ARCH-patterned walls, which cut the middle column out, so a stack reads as a pair of posts
rather than as a solid slab boxing in the space beneath.

This is not a workaround for the support rules. It is the geometry the POI was always
described as having, and the structure is now honestly load-bearing: cut the pilings and the
cabin comes down, which is the correct answer.

### 21.3 Roofs

Cones are banned as the primary roof form — one per cell gives a field of spikes.

- **Pitched roof:** ramp rows at the eaves with a flat deck spanning the ridge. One storey
  of rise across the whole roof, and the deck is standable.
- **Flat industrial roof:** a slab with a half-wall parapet to fight from behind.

The ramp direction is the easy thing to get backwards: a ramp is HIGH at the edge it faces,
so the near eave faces `south` and the far eave `north` for the ridge to land in the middle.

### 21.4 Interiors

Every major building has a clear entrance, a second route where the shape allows, windows,
stairs where it is multi-storey, and room to fight in third person.

**Combat readability outranks realism.** One cell is 5.12 m, so rooms are generous by
design; a realistically-scaled hallway is unplayable over the shoulder.

### 21.5 Loot routes

Loot is authored per POI, never scattered in a ring. Each POI has multiple chests across
different rooms and floors, ammo and floor loot spread away from them, and exactly one
`risk` chest: the best position in the most exposed place — a hay loft, a dock head, a
tower deck, a warehouse roof.

Loot carries its own storey, so an upper-floor chest lands on that floor.

### 21.6 Prop dressing

Props are **visual only**. Anything a player must be able to take cover behind is a build
piece; a prop that looks like cover but is not is worse than no prop. Props stay low and
sparse so they never fight movement or building.

Rendered as one InstancedMesh per kind with a shared material, so the whole dressing layer
costs about a dozen draw calls.

### 21.7 Environmental storytelling

One readable idea per place, carried by the props: the farm is still worked, the service
stop is recently abandoned, the cabin is fished from, the yard still moves goods, the
outpost watches the island.

### 21.8 Required tests

1. Every POI's buildings are build pieces in the grid, with valid types and materials.
2. Every building sits on the ground: nothing floats, nothing is buried.
3. Every POI has a walkable entrance — at least one opening pattern marked walkable.
4. Every multi-storey building has a ramp connecting its storeys.
5. No POI is roofed over so completely that its interior is unreachable.
6. Loot is spread: no POI has all its chests in one cell, and each has a `risk` chest.
7. Every chest, ammo box and floor-loot position is inside its POI and above its ground.
8. Props stay inside their POI and out of the water. They may stand on road surface
   inside a POI — a service station's pumps belong on its forecourt.
9. Piece counts stay inside the build budget.
10. Each POI is distinguishable by piece-type mix — no two share a silhouette recipe.
11. Interior lighting keeps its fill below the key light, so §21.9's floor cannot be raised
    into a second key that flattens exterior shading.
12. Every building cell — not just the POI centre — sits within one wall edit row of its
    ground, and each POI's pad is flat across its whole footprint and on a storey line.
13. Openings reach the geometry: a patterned wall renders fewer solid tiles than a full one,
    and a half wall stands one edit row high.
14. Crown Post is the tallest POI in ABSOLUTE height, and every POI carrying a landmark
    stands at least five storeys above its own base (§21.1.1).

### 21.9 Interior lighting [OWNER-derived]

An enclosed room lit only by a key light and a sky-normal hemisphere term goes black: the
inward-facing surfaces take the ground ambient, and the roof shadows everything beneath it.
That contradicts §21.4 — a room you cannot read is not a room you can fight in.

- A flat ambient term sets a **floor on shadowed and interior surfaces** so an interior
  reads as a dim room rather than a black void.
- The floor is a fill, not a second key: exteriors must keep their directional shading and
  visible cast shadows, and interiors must stay clearly darker than open ground so stepping
  inside still reads as cover.
- Lighting intensities are tunables and live in `Config.js` under `LIGHTING`, not as
  literals in the renderer.

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
| 1.4.1 | 2026-09-14 | Adds §21.2.2: a building standing over water carries real pilings. Riverwatch's cabin, deck, net store and boardwalk are now structurally supported rather than floating. |
| 1.4.0 | 2026-09-14 | Adds §21.1.1 landmarks: one vertical anchor each for Kettle Row (water tower), Riverwatch (net-drying frame) and Dray Yard (loading gantry), assembled from shared `shaft`/`beam` primitives. Hollow Farm, Pumpjack Stop and Crown Post reviewed and left unchanged. Riverwatch's boardwalk is now founded per-cell on the ground beneath it, fixing six dock cells that sat 11.5 m inside the far bank. |
| 1.3.0 | 2026-09-14 | Adds §21.2.1: POI pads are sized to the blueprint footprint, snapped to a storey line, and aproned at a walkable grade; overlapping pads blend by influence weight; a POI whose footprint lands in water settles onto dry ground while its marker stays put. Fixes buildings standing up to 7.3 m inside their own ground. |
| 1.2.1 | 2026-09-14 | Adds §21.9 interior lighting: a flat ambient floor so enclosed rooms are readable per §21.4, with lighting intensities moved into `Config.LIGHTING`. |
| 1.2.0 | 2026-09-14 | [OWNER] POI architecture, interiors and detail pass (§21): openings via the edit system, ramp-based roofs, interiors with stairs and second routes, authored per-POI loot routes with a risk chest, visual prop dressing, and silhouette identity. Macro layout frozen. |
| 1.1.0 | 2026-09-14 | [OWNER] First playable island visual overhaul (§20): hand-authored terrain form, river and lake carved below sea level, road network, surface types, authored vegetation clusters, six original POIs, and the decision that POI structures are build pieces so no new collision path is added. |
| 1.0.0 | 2026-09-13 | Replaced the "Cinder Isle" baseline with the owner's authoritative map specification. Voids: the 190 m central massif, the high-frequency detail noise layer, uniform vegetation scatter, the 15 invented POIs, and the absence of any water system. Adds the reference-image category rules, the connected water network, countryside-first philosophy, and architecture derived from the build module. |
| 0.1.0 | 2026-09-13 | Initial baseline placeholder. Void. |
