# MASTER SPEC — Gameplay

| Field | Value |
| --- | --- |
| Status | **Baseline v0.1 — awaiting the user's authoritative specification** |
| Version | 0.1.0 |
| Owner | eldin.omerhodzic@icloud.com |
| Scope | Player, movement, camera, combat, building, editing, materials, loot, UI, match flow |
| Companion | `docs/MAP_SPEC.md` (world, terrain, POIs, loot distribution) |

> **Read before editing.** This baseline fills the structure with genre-standard,
> internally consistent, playable values so that `src/` can be implemented and tested
> today. It is a placeholder for the full gameplay specification the project owner will
> supply. When that specification arrives, replace the numbers and rules here — keep the
> section numbering so code comments and tests that cite `§3.2` keep resolving — then
> bring `src/core/Config.js` and `tests/` in line in the same change.

---

## 1. Design pillars

1. **Build is a movement verb, not a menu.** Placing a wall, ramp, floor, or cone must be
   as fast and as thoughtless as jumping. Any mechanic that adds a confirmation step to
   placement is wrong.
2. **Every fight is a 3D problem.** Height wins. The map, the weapons, and the build set
   must all reward taking and holding high ground.
3. **Readable at a glance.** Enemy, material type, rarity, and structure ownership must
   be identifiable in under 200 ms from a still frame.
4. **Low time-to-skill-expression, high skill ceiling.** A new player can place a ramp in
   their first minute. Edit courses take hundreds of hours to master.
5. **Deterministic simulation.** Same inputs, same seed, same result. No gameplay logic
   reads `Math.random()` directly (§11.1) and none reads wall-clock frame time (§2.1).

## 2. Simulation model

### 2.1 Tick and timing

| Parameter | Value |
| --- | --- |
| Simulation tick rate | 30 Hz fixed (`33.333 ms`) |
| Max simulation steps per frame | 5 (spiral-of-death guard) |
| Render rate | Uncapped, interpolated between the two latest sim states |
| Interpolation | Position and yaw/pitch lerp; discrete state (e.g. `isEditing`) snaps |
| Units | Metres, seconds, radians, kilograms |

Gameplay code never uses real frame time. `Loop.js` owns an accumulator and calls
`update(FIXED_DT, ctx)`; the renderer reads an interpolation alpha.

### 2.2 Coordinate system

Right-handed, **Y up**. `+X` east, `+Z` south, `-Z` north. Yaw 0 faces `-Z` (north) and
increases clockwise when viewed from above. Pitch is positive looking up.

## 3. Player

### 3.1 Vitals

| Stat | Value |
| --- | --- |
| Max health | 100 |
| Max shield | 100 |
| Starting health | 100 |
| Starting shield | 0 |
| Health regeneration | None (consumables only) |
| Shield regeneration | None (consumables only) |
| Damage order | Shield absorbs first, then health. Overflow carries into health in the same hit. |
| Fall damage | `max(0, (fallDistance - 3.5 m)) * 10` HP, ignores shield, capped at 100 |
| Down-but-not-out | Disabled in v0.1 (solo-only). Reserved for §12. |

### 3.2 Movement

Horizontal movement is velocity-driven with separate ground and air acceleration.

| Parameter | Value |
| --- | --- |
| Walk speed | 4.6 m/s |
| Sprint speed | 7.6 m/s |
| Crouch speed | 2.4 m/s |
| Ground acceleration | 60 m/s² |
| Ground friction | 10 (exponential damping coefficient) |
| Air acceleration | 12 m/s² |
| Air control cap | 1.6 m/s of lateral steering authority per tick |
| Air drag | 0.4 |
| Gravity | 22 m/s² |
| Jump velocity | 7.4 m/s (apex 1.24 m, 0.67 s airtime — derived from gravity above) |
| Terminal velocity | 60 m/s |
| Step height | 0.45 m (auto-step, no jump required) |
| Max walkable slope | 48° |
| Capsule | radius 0.4 m, standing height 1.85 m, crouched height 1.25 m |
| Coyote time | 100 ms |
| Jump buffer | 120 ms |
| Sprint ramp | Instant to sprint, 250 ms decay back to walk |

Notes:
- Sprint requires forward input within ±60° of the movement vector and is cancelled by
  firing, aiming, or entering build mode with a piece placed (§6.6).
- Crouch does not slow the mantle or edit speed.
- Mantling: a ledge between 0.45 m and 1.7 m above the capsule base, with 0.6 m of
  clearance behind it, is vaulted in 350 ms.

### 3.3 Camera

Third-person orbit camera behind the right shoulder.

| Parameter | Value |
| --- | --- |
| Default distance | 3.2 m |
| Shoulder offset | +0.55 m X (right), +1.55 m Y |
| FOV (hip) | 80° |
| FOV (ADS) | 55°, or weapon-specific (§5.4) |
| Pitch clamp | −85° to +85° |
| Look sensitivity | 0.0022 rad per mouse count at 1.0 user sensitivity |
| ADS sensitivity multiplier | 0.6 |
| Collision | Sphere-cast radius 0.25 m; camera pulls in to the hit point minus 0.1 m |
| Build-mode distance | 3.6 m (pulls back slightly for placement readability) |
| Transition | 120 ms critically-damped spring on distance and FOV |

Camera never clips through owned or enemy structures; it pulls in instead.

### 3.4 Player states

`Grounded`, `Airborne`, `Sprinting`, `Crouched`, `Mantling`, `Building`, `Editing`,
`Harvesting`, `Downed` (reserved), `Dead`.

`Building` and `Editing` are mutually exclusive. Entering either preserves movement state;
the player can run, jump, and fall while building or editing.

## 4. Materials and harvesting

### 4.1 Material types

| Material | Cap | Build HP (full) | Build time | Character |
| --- | --- | --- | --- | --- |
| Wood | 500 | 150 | 3.5 s to full | Fastest to full HP, weakest ceiling |
| Stone | 500 | 300 | 11 s to full | Middle |
| Metal | 500 | 500 | 20 s to full | Slowest, strongest |

A freshly placed piece starts at its **initial HP** and ramps linearly to full HP over its
build time (§6.4).

| Material | Initial HP | Full HP | Ramp |
| --- | --- | --- | --- |
| Wood | 90 | 150 | 3.5 s |
| Stone | 90 | 300 | 11.0 s |
| Metal | 90 | 500 | 20.0 s |

### 4.2 Harvesting

| Parameter | Value |
| --- | --- |
| Tool | Harvesting tool, always equipped in slot 0, cannot be dropped |
| Swing interval | 0.55 s |
| Damage to harvestables | 75 |
| Damage to players | 20 |
| Damage to structures | 100 (enemy), 0 (own — own builds are never damaged by your tool) |
| Weak-point bonus | Hitting the highlighted weak point yields ×2 materials and destroys faster |
| Range | 3.0 m |

Yield per swing (see `docs/MAP_SPEC.md` §6 for which sources appear where):

| Source | Material | Per swing | Total before depletion |
| --- | --- | --- | --- |
| Tree | Wood | 12 | 50 |
| Wooden pallet / fence | Wood | 10 | 30 |
| Boulder / rock | Stone | 14 | 60 |
| Brick wall | Stone | 11 | 40 |
| Vehicle wreck | Metal | 12 | 70 |
| Shipping container | Metal | 14 | 90 |
| Streetlight / rail | Metal | 10 | 30 |

Materials above the 500 cap are discarded. Harvestables respawn only between matches.

## 5. Combat

### 5.1 Damage model

Damage is applied to shield first, then health (§3.1).

| Hit region | Multiplier |
| --- | --- |
| Head | ×2.0 (×1.5 for shotguns) |
| Torso / arms | ×1.0 |
| Legs | ×1.0 |

Structures take flat weapon damage with no location multiplier and no falloff.

### 5.2 Weapon rarity

| Rarity | Colour | Damage multiplier vs Common |
| --- | --- | --- |
| Common | `#B0B0B0` grey | ×1.00 |
| Uncommon | `#4CD94C` green | ×1.05 |
| Rare | `#3B8EEA` blue | ×1.10 |
| Epic | `#B14CE8` purple | ×1.16 |
| Legendary | `#E8A33B` gold | ×1.22 |

Rarity affects damage only. Fire rate, magazine, spread, and reload are identical across
rarities of the same weapon so that weapon feel is learnable.

### 5.3 Weapon classes

Base values are for **Common** rarity. `DPS` is sustained, ignoring reload.

| Class | Damage | Fire rate (rps) | Mag | Reload | Range profile | Structure dmg |
| --- | --- | --- | --- | --- | --- | --- |
| Assault Rifle | 30 | 5.5 | 30 | 2.3 s | Hitscan, falloff §5.5 | 30 |
| SMG | 17 | 11.0 | 30 | 2.1 s | Hitscan, falloff §5.5 | 17 |
| Pump Shotgun | 9 × 10 pellets | 0.75 | 5 | 4.5 s | Hitscan cone, §5.6 | 100 |
| Tactical Shotgun | 6 × 10 pellets | 1.6 | 8 | 3.6 s | Hitscan cone, §5.6 | 80 |
| Bolt Sniper | 105 | 0.55 | 1 | 2.8 s | Hitscan, no falloff | 125 |
| Pistol | 24 | 6.75 | 16 | 1.5 s | Hitscan, falloff §5.5 | 24 |
| Rocket Launcher | 100 direct / 75 splash | 0.6 | 1 | 3.2 s | Projectile 45 m/s | 400 |

### 5.4 ADS

| Class | ADS FOV | ADS time | Hip spread | ADS spread |
| --- | --- | --- | --- | --- |
| Assault Rifle | 55° | 0.24 s | 3.2° | 0.6° |
| SMG | 62° | 0.18 s | 4.4° | 1.4° |
| Shotguns | 65° | 0.28 s | (pellet cone, §5.6) | (pellet cone × 0.7) |
| Bolt Sniper | 28° (scoped) | 0.40 s | 12.0° | 0.0° |
| Pistol | 58° | 0.20 s | 2.8° | 0.5° |
| Rocket Launcher | 60° | 0.35 s | 1.5° | 0.4° |

### 5.5 Spread and falloff

Spread grows with sustained fire and with movement:

```
spread = base
       + bloomPerShot * min(shotsInBurst, bloomCap)
       + movementPenalty
```

| Parameter | Value |
| --- | --- |
| `bloomPerShot` | 0.45° (AR), 0.30° (SMG), 0.35° (Pistol) |
| `bloomCap` | 8 shots |
| Bloom decay | 9°/s, starts 0.25 s after the last shot |
| Movement penalty | `0.55° * (horizontalSpeed / walkSpeed)`, doubled while airborne |
| Crouch bonus | ×0.75 on the final spread |

Damage falloff by distance (linear interpolation between stops, applied to hitscan
classes marked "falloff §5.5"):

| Distance | Multiplier |
| --- | --- |
| 0 – 35 m | ×1.00 |
| 35 – 60 m | ×1.00 → ×0.80 |
| 60 – 90 m | ×0.80 → ×0.65 |
| 90 m+ | ×0.65 |

### 5.6 Shotgun pellets

Pellets are fired in a deterministic sunflower pattern (not uniform random) so spread is
learnable, jittered by ±15 % of the ring spacing using the match RNG stream (§11.1).

| Parameter | Pump | Tactical |
| --- | --- | --- |
| Pellets | 10 | 10 |
| Cone half-angle | 4.5° | 6.0° |
| Falloff | ×1.0 to 8 m, → ×0.55 at 22 m, ×0.35 beyond | ×1.0 to 6 m, → ×0.5 at 18 m, ×0.3 beyond |
| Headshot multiplier | ×1.5 | ×1.5 |

Pellets share one structure-damage budget: a shotgun deals its listed structure damage
once per shot, not once per pellet.

### 5.7 Inventory

| Parameter | Value |
| --- | --- |
| Slots | 6 — slot 0 is the harvesting tool (fixed), slots 1–5 are free |
| Slot switching | 0.25 s, cancels reload, cannot be cancelled by firing |
| Stack sizes | Light/Medium/Heavy ammo 999, Shells 60, Rockets 12, consumables 3–6 |
| Drop | Dropping a weapon drops it with its current magazine |
| Pickup | 0.4 s hold; swaps into the selected slot if the inventory is full |

Ammo types: Light (SMG, Pistol), Medium (AR), Heavy (Sniper), Shells (Shotguns),
Rockets (Rocket Launcher).

### 5.8 Consumables

| Item | Use time | Effect | Stack |
| --- | --- | --- | --- |
| Bandage | 3.0 s | +15 HP, caps at 75 HP | 5 |
| Medkit | 8.0 s | Health to 100 | 3 |
| Small Shield | 2.0 s | +25 shield, caps at 50 | 6 |
| Shield Potion | 5.0 s | +50 shield, caps at 100 | 3 |

Using a consumable locks movement to walk speed and is cancelled by taking damage
(progress is lost, the item is not consumed).

## 6. Building

### 6.1 Grid

The world is divided into a uniform build grid.

| Parameter | Value |
| --- | --- |
| Tile size | 5.12 m × 5.12 m footprint |
| Tile height | 3.84 m (wall height) |
| Grid origin | World origin `(0, 0, 0)`, axis-aligned, never rotated |
| Snapping | Pieces snap to the nearest cell face/edge; no free placement |
| Vertical layers | Unlimited up to the build ceiling (`MAP_SPEC §3.4`) |

A cell is addressed by integer `(cx, cy, cz)`. Within a cell, a piece occupies one of:
- **Floor** slot (1 per cell, at the cell's base)
- **Wall** slots (4 per cell — N, E, S, W faces)
- **Ramp** slot (1 per cell, with a direction N/E/S/W)
- **Cone** slot (1 per cell, "pyramid", shares the cell volume with a floor and walls)

### 6.2 Piece set

| Piece | Occupies | Purpose |
| --- | --- | --- |
| Wall | One cell face, full height | Block line of sight and movement |
| Floor | Cell base | Platform, ceiling for the cell below |
| Ramp (stair) | Cell volume, directional | Gain height; 3.84 m rise over 5.12 m run (36.9°) |
| Cone (pyramid) | Cell volume | Head protection, ramp-push protection |

All four are available in all three materials. There are no other piece types in v0.1.

### 6.3 Placement rules

1. **Cost:** 10 material per piece, deducted at placement.
2. **Placement range:** 12.0 m from the camera to the target cell centre.
3. **Preview:** A translucent ghost shows the target piece every frame. Green = placeable,
   red = blocked.
4. **Blocked if:** the slot is occupied by any piece; the piece would intersect a player
   capsule (any player, including the builder); the target cell is above the build ceiling
   or outside the playable boundary; the player lacks 10 of the selected material.
5. **Terrain intersection is allowed** — pieces clip into terrain and are simply partially
   buried. Terrain never blocks placement.
6. **Placement rate:** unlimited on distinct slots; `0.10 s` minimum between placements
   to bound network and input spam.
7. **Turbo build:** holding the fire button while a build piece is selected places into
   every valid slot the crosshair crosses, at a minimum interval of `0.15 s`.

### 6.4 Build health and the ramp

A placed piece starts at 90 HP and ramps linearly to its material's full HP over the
material's build time (§4.1). While ramping, the piece renders with a build-in shader
sweep. Damage taken during the ramp does not reset the ramp; the piece's HP is
`min(currentHP, rampedMaxHP)`.

### 6.5 Structure integrity

Pieces are connected in a support graph. A piece is **supported** if it transitively
connects to the terrain.

- Floors are supported by: a wall on any of their four edges, a ramp or cone in the cell
  below, the terrain beneath them, or an adjacent supported floor.
- Walls are supported by: the terrain at their base, a floor at their base, or a supported
  wall directly below.
- Ramps and cones are supported by: the terrain, a floor in their cell, or a supported
  piece in the cell below.

When a piece is destroyed, its dependents are re-evaluated. Unsupported pieces are
destroyed after a `0.35 s` grace period, cascading outward. Cascade destruction deals no
damage to players; falling structures do not crush.

### 6.6 Build mode

| Parameter | Value |
| --- | --- |
| Enter | Press a build key (`F1`–`F4` or `Q` to toggle to last-used) |
| Exit | Weapon slot key, or `Q` toggle |
| Enter/exit time | 0 s — instant, no animation lock |
| Rotation | `R` cycles ramp/cone direction through N → E → S → W |
| Material swap | `Mouse wheel` or `F5` cycles Wood → Stone → Metal |
| Movement | Unrestricted; sprint is allowed while a piece is selected but not while placing |

Selected piece and material persist across deaths within a match.

### 6.7 Damage to structures

- Weapons deal their listed structure damage (§5.3), no falloff, no headshot.
- The harvesting tool deals 100 to enemy structures, 0 to own.
- Destroying a piece yields **no** material refund.
- A piece under construction (§6.4) takes the same damage as a finished one.
- Friendly fire on own structures is disabled; team structures take 0 damage from
  teammates in team modes (reserved, §12).

## 7. Editing

### 7.1 Edit grid

Every piece exposes a 3×3 edit grid on its face (walls, floors, cones) or a 3×3 grid on
the ramp's footprint. The player selects a subset of the nine tiles; the resulting shape
is looked up in the piece's pattern table. Invalid selections are rejected and the piece
is unchanged.

Tile indices, viewed face-on from the editing player:

```
0 1 2
3 4 5
6 7 8
```

### 7.2 Edit flow and timing

| Step | Input | Time |
| --- | --- | --- |
| Enter edit | Hold or press `G` while aiming at an own piece within 8 m | 0.10 s |
| Select tiles | Drag with fire held, or click tiles | — |
| Confirm | Release fire / press `G` | 0.10 s |
| Reset | Press `R` while editing | instant |
| Cancel | Press the build key or move out of range | instant |

Total floor-to-confirmed-edit time for a practised player must be under 0.25 s. Nothing in
the edit flow may block movement — the player runs and jumps normally throughout.

Editing is allowed only on pieces the player owns (`ownerId === localPlayerId`). Enemy
pieces cannot be edited in v0.1.

### 7.3 Wall patterns

| Name | Selected tiles | Result |
| --- | --- | --- |
| Full wall | — (reset) | Solid wall |
| Door | 6, 7 | Ground-level doorway, 1 tile wide |
| Window | 4 | Centre window |
| Half wall (bottom) | 0,1,2,3,4,5 | Lower third remains |
| Corner (left) | 2, 5, 8 | Right column removed |
| Corner (right) | 0, 3, 6 | Left column removed |
| Doorway wide | 6,7,8 | Full-width bottom opening |
| Peek left | 3 | Single left mid-tile removed |
| Peek right | 5 | Single right mid-tile removed |

### 7.4 Floor patterns

| Name | Selected tiles | Result |
| --- | --- | --- |
| Full floor | — | Solid floor |
| Quarter hole | 0 (or 2, 6, 8) | One-quarter drop-through |
| Half floor | 0,1,3,4 | Half the floor removed |
| Centre hole | 4 | Centre drop-through |
| Full drop | 0–8 | Floor removed entirely (piece is deleted) |

### 7.5 Ramp patterns

| Name | Selected tiles | Result |
| --- | --- | --- |
| Full ramp | — | Standard ramp |
| Half ramp (left) | 0,3,6 | Left half only |
| Half ramp (right) | 2,5,8 | Right half only |
| Ramp with platform | 6,7,8 | Flat landing at the top |
| Inverted step | 0,1,2 | Upper row removed |

### 7.6 Cone patterns

| Name | Selected tiles | Result |
| --- | --- | --- |
| Full cone | — | Standard pyramid |
| Half cone | 0,1,2 | One face removed |
| Quarter cone | 0,1,2,3 | Two faces removed |

### 7.7 Edit rules

1. Editing never changes a piece's HP, material, or owner.
2. Editing does not refund or cost material.
3. A "full drop" floor edit and any edit that removes every tile deletes the piece and
   triggers support re-evaluation (§6.5).
4. Placing a new piece into an edited piece's slot is blocked — the slot is still occupied.
5. An edited piece reverts to its full form when the editing player edits it again with a
   reset, at no cost.

## 8. Loot

### 8.1 Sources

| Source | Items | Notes |
| --- | --- | --- |
| Floor loot | 1 weapon or 1 consumable + ammo | Scattered per `MAP_SPEC §6.2` |
| Chest | 2 items + 2 ammo stacks + 1 consumable | Audible hum within 12 m |
| Ammo box | 2 ammo stacks | — |
| Player drop | Everything the player held | Materials drop as a single stack, capped at 500 |

### 8.2 Rarity weights

| Source | Common | Uncommon | Rare | Epic | Legendary |
| --- | --- | --- | --- | --- | --- |
| Floor loot | 45 % | 32 % | 16 % | 5.5 % | 1.5 % |
| Chest | 18 % | 34 % | 30 % | 14 % | 4 % |

Weapon class within a roll is selected by the class weights in `MAP_SPEC §6.3`, which vary
by POI tier.

### 8.3 Guarantees

- A chest never rolls two weapons of the same class.
- The first chest a player opens in a match is guaranteed to contain at least one weapon.
- Ammo dropped alongside a weapon always matches that weapon's ammo type.

## 9. Match flow

| Phase | Duration | Behaviour |
| --- | --- | --- |
| Warmup | Until start | Free movement, no damage, no building |
| Drop | 45 s | Players glide in from the drop path (`MAP_SPEC §7`) |
| Storm phases | 8 phases, see below | Playable circle shrinks |
| End | — | Last player standing |

| Phase | Wait | Shrink | Radius after | Storm DPS |
| --- | --- | --- | --- | --- |
| 1 | 180 s | 120 s | 60 % | 1 |
| 2 | 120 s | 100 s | 45 % | 1 |
| 3 | 100 s | 90 s | 33 % | 2 |
| 4 | 90 s | 80 s | 24 % | 3 |
| 5 | 75 s | 70 s | 17 % | 5 |
| 6 | 60 s | 60 s | 11 % | 7 |
| 7 | 45 s | 45 s | 6 % | 10 |
| 8 | 30 s | 60 s | 0 % | 10 |

Radii are a fraction of the initial safe-zone radius (`MAP_SPEC §3.2`). The storm damages
on a 1 s tick and ignores shield. Each circle's centre is chosen inside the previous
circle with the match RNG (§11.1).

## 10. UI / HUD

Full layout references live in `references/ui/`.

| Element | Position | Contents |
| --- | --- | --- |
| Health / shield bars | Bottom-centre | Shield above health, numeric values inline |
| Material counters | Bottom-right, above the build bar | Wood / Stone / Metal with icons |
| Build bar | Bottom-right | 4 piece slots + material selector, active slot highlighted |
| Inventory bar | Bottom-right | 6 slots, rarity-coloured borders, ammo count per slot |
| Crosshair | Centre | Dynamic — opens with spread (§5.5); build mode shows a dot + ghost |
| Edit overlay | On the target piece | 3×3 grid, selected tiles highlighted, world-space |
| Minimap | Top-right | North-up, storm circle, player arrow |
| Damage numbers | At the hit point | White = health, blue = shield, yellow = headshot |
| Hit marker | Centre | X on hit, sound-matched; thicker on elimination |
| Storm timer | Top-centre | Phase, countdown, "X players left" |
| Kill feed | Top-left | Last 5 eliminations |

Rules: the HUD never occludes the centre 40 % of the screen. All HUD colours meet a 4.5:1
contrast ratio against both the day and night sky palettes (`MAP_SPEC §5`).

## 11. Technical constraints

### 11.1 Determinism and RNG

All gameplay randomness comes from seeded streams derived from the match seed:
`loot`, `storm`, `spread`, `cosmetic`. `Math.random()` is banned outside `cosmetic`.
Streams are xorshift128+ and are advanced only by gameplay code, never by rendering.

### 11.2 Performance budget (per frame, 1080p, mid-range GPU)

| Budget | Target |
| --- | --- |
| Frame time | 16.6 ms (60 fps), 8.3 ms on high-end |
| Simulation | ≤ 4 ms |
| Draw calls | ≤ 1200 |
| Build pieces rendered | ≤ 6000 (instanced per material × piece type) |
| Triangles | ≤ 2.5 M |

Build pieces are instanced. One `InstancedMesh` per `(pieceType, material, editPattern)`
combination, rebuilt incrementally, never per-frame from scratch.

### 11.3 Input

Rebindable. Defaults:

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Sprint | `Shift` |
| Crouch | `Ctrl` |
| Fire | `Mouse1` |
| ADS | `Mouse2` |
| Reload | `R` |
| Harvest tool | `1` |
| Weapon slots | `2`–`6` |
| Wall / Floor / Ramp / Cone | `F1` / `F2` / `F3` / `F4` |
| Toggle build | `Q` |
| Material cycle | `F5` / mouse wheel |
| Edit | `G` |
| Rotate piece | `R` (in build mode) |
| Interact | `E` |
| Map | `M` |

Mouse input is read from raw deltas (Pointer Lock), never from smoothed values.

## 12. Out of scope for v0.1

Recorded here so they are not implemented by accident: teams and squads, revives,
vehicles, emotes, cosmetics, matchmaking, dedicated-server netcode, voice, progression,
battle pass, replays, creative mode, mobile input.

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 0.1.0 | 2026-09-13 | Initial baseline. Placeholder pending the owner's authoritative spec. |
