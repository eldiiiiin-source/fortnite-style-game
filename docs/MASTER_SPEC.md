# MASTER SPEC — Gameplay

| Field | Value |
| --- | --- |
| Status | **Authoritative — supplied by the project owner, 2026-09-13** |
| Version | 1.1.0 |
| Owner | eldin.omerhodzic@icloud.com |
| Supersedes | Baseline v0.1.0 (temporary placeholder, now void) |
| Companion | `docs/MAP_SPEC.md`, `references/map/02-chapter2-season1-references.md` |

**If the implementation conflicts with this document, this document wins.** Do not
preserve wrong architecture merely because it already exists. Refactor properly.

Original assets, branding, characters, world geometry and code throughout. No proprietary
source, assets, sounds, music, maps, skins, animations or textures from any shipped game.

---

## 0. How to read this document

The owner's specification is overwhelmingly **behavioural and architectural**. It fixes a
small number of hard values and a large number of required behaviours. Two markers
separate them, and the distinction is load-bearing:

| Marker | Meaning |
| --- | --- |
| **[OWNER]** | Stated by the owner. Authoritative. Changing it requires the owner. |
| **[PROV]** | Provisional tuning. The owner's spec is silent; the value is carried over from the baseline or derived so the system can be built and tested. **Expected to change.** Flagged for sign-off in §46. |

Every `[PROV]` number lives in `src/core/Config.js` like any other, so retuning is a
one-file change. No `[PROV]` value may contradict an `[OWNER]` behaviour.

## 1. Global priorities [OWNER]

1. Input responsiveness
2. Movement
3. Camera
4. Building
5. Editing
6. Edited collision
7. Combat
8. Inventory / loot
9. HUD
10. Match systems
11. Audio
12. Visual polish
13. Large map expansion

**Gameplay feel matters more than graphics.** Stable 60 FPS is a hard target. Core
responsiveness is never traded for visual detail.

## 2. Technical principles [OWNER]

- Modular architecture. No magic numbers spread across the codebase; tuning lives in
  central configuration.
- These concerns stay separated: input, player movement, camera, building, editing,
  collision, combat, weapons, inventory, loot, world, UI, settings, audio, game state.
- Core systems must be testable independently.
- **No structural problem is solved with random offsets or one-off hacks.** If a system is
  fundamentally wrong, rewrite it.

## 3. Simulation model

| Parameter | Value | Marker |
| --- | --- | --- |
| Simulation tick rate | **60 Hz fixed** (16.667 ms) | **[OWNER]** approved 2026-09-13 |
| Max simulation steps per frame | 5 | [PROV] |
| Render | Interpolated between the two latest sim states | [PROV] |
| Units | Metres, seconds, radians | [PROV] |

> **Owner-approved 2026-09-13.** Input, movement, building, editing, collision and combat
> are all designed around responsive 60 Hz gameplay. The baseline's 30 Hz added up to
> 33 ms of latency before a build began; 60 Hz halves that and matches the 60 FPS target.

Gameplay code never reads wall-clock frame time. Coordinate system is right-handed, **Y
up**; yaw 0 faces `-Z`, pitch positive looking up.

## 4. Input system [OWNER]

Input is sampled reliably **every frame**. Build and edit inputs are never dropped.
Keyboard and mouse supported. Mouse buttons are valid binds. **Mouse wheel up and mouse
wheel down are independently bindable.**

### 4.1 Bindable actions — all required

`moveForward`, `moveBackward`, `moveLeft`, `moveRight`, `jump`, `crouch`, `sprint`,
`interact`, `fire`, `aim`, `reload`, `pickaxe`, `weaponSlot1`–`weaponSlot5`, `wall`,
`floor`, `ramp`, `cone`, `edit`, `confirmEdit`, `resetEdit`, `inventory`, `map`,
`settings`.

### 4.2 Required input options [OWNER]

- **Confirm edit on release: ON / OFF**
- Mouse wheel reset editing
- Direct build piece binds
- Rapid switching between combat and building

### 4.3 Architecture requirements

- Edge state (`wasPressed` / `wasReleased`) survives to the tick that consumes it — a
  press between ticks is never lost.
- Mouse look reads raw deltas, never smoothed values.
- Build and edit intents are **buffered**, not discarded (§11).
- Bind conflicts are detected and surfaced clearly (§40).

### 4.4 Default binds [PROV]

| Action | Default | Action | Default |
| --- | --- | --- | --- |
| Move | `W` `A` `S` `D` | Wall | `Q` |
| Jump | `Space` | Floor | `F` |
| Crouch | `Ctrl` | Ramp | `C` |
| Sprint | `Shift` | Cone | `V` |
| Fire | `Mouse0` | Edit | `G` |
| Aim | `Mouse2` | Confirm edit | `Mouse0` |
| Reload | `R` | **Reset edit** | **`WheelDown`** [OWNER] |
| Pickaxe | `1` | Interact | `E` |
| Weapon slots 1–5 | `1`–`5` | Map | `M` |
| Inventory | `Tab` | Settings | `Esc` |

## 5. Player movement [OWNER]

Movement must feel **crisp and responsive**.

Required: walking, sprinting, crouching, jumping, air movement, mantling, slope
traversal, step-up handling, swimming where water is present. Tactical sprint is an
optional later feature and is **not** in scope now.

**Explicitly avoided:** floaty movement, excessive inertia, uncontrolled sliding, overly
realistic physics, sluggish acceleration, sticky movement, accidental slope launches.

### 5.1 Movement must support fast building [OWNER]

The player must be able to do all of the following **without the movement controller
fighting them**:

- sprint while placing builds
- jump while building
- turn quickly
- perform 90s
- perform protected ramp pushes
- perform double edits
- perform triple edits

This is a correctness requirement, not a feel goal. It is tested in §44.

### 5.2 Movement feel [OWNER]

- Responsive acceleration model; intended speed is reached **quickly**.
- Stopping and direction changes feel **deliberate**.
- Air control exists but must not feel like flying.
- Jump arc is **predictable and consistent**.

### 5.3 Movement values [PROV]

| Parameter | Value |
| --- | --- |
| Walk speed | 4.6 m/s |
| Sprint speed | 7.6 m/s |
| Crouch speed | 2.4 m/s |
| Swim speed | 3.4 m/s |
| Ground acceleration | 85 m/s² |
| Ground friction | 12 |
| Air acceleration | 14 m/s² |
| Air control cap | 2.0 m/s per tick |
| Gravity | 22 m/s² |
| Jump velocity | 7.4 m/s (apex 1.24 m, 0.67 s airtime) |
| Terminal velocity | 60 m/s |
| Step height | `WALL_H × 0.1171875` = 0.45 m (derived, §9.1.1) |
| Max walkable slope | 50° |
| Coyote time | 100 ms |
| Jump buffer | 120 ms |

> Ground acceleration is raised from the baseline's 60 and air accel from 12, per §5.2's
> "reaches intended speed quickly" and the §5.1 build-mobility requirement.

### 5.4 Crouch [OWNER]

Crouching reduces player height, **updates the collision capsule**, **updates camera
height**, and remains responsive during build and edit workflows.

| Parameter | Value | Marker |
| --- | --- | --- |
| Standing capsule height | `WALL_H × 0.5` = 1.92 m | derived, §9.1.1 |
| Crouched capsule height | `WALL_H × 0.3125` = 1.20 m | derived, §9.1.1 |
| Capsule radius | `TILE × 0.078125` = 0.40 m | derived, §9.1.1 |
| Crouch transition | 120 ms, camera and capsule together | [PROV] |

### 5.5 Mantling [OWNER]

Mantling triggers **only** when the target ledge is valid, the player is in range, and the
vertical difference is within allowed limits. **No accidental mantling during normal
building.**

| Parameter | Value | Marker |
| --- | --- | --- |
| Min ledge height | 0.45 m (above step height) | [PROV] |
| Max ledge height | 1.7 m | [PROV] |
| Required clearance behind ledge | 0.6 m | [PROV] |
| Forward reach | 0.9 m | [PROV] |
| Duration | 350 ms | [PROV] |
| **Suppressed while** | build mode active, edit mode active, or a build was placed in the last 200 ms | [OWNER] |

The suppression rule is the direct implementation of "no accidental mantling during normal
building" and is tested.

## 6. Player collision [OWNER]

Stable capsule (or equivalent). Collision must behave **predictably** with floors, ramps,
stairs, edited walls, edited ramps, terrain, roofs and props.

- The player must not snag on tiny geometry unnecessarily.
- Step-up handling allows traversal of small height changes **without jumping**.
- Step-up and step-down are distinct cases; a falling player never takes the step path.

## 7. Third-person camera [OWNER]

**Close, over-the-right-shoulder.** The character sits **slightly left of screen centre**.

Must support: smooth mouse look, adjustable sensitivity, adjustable FOV, camera collision,
obstruction handling, crouch height adjustment, jumping, building, editing, ADS
transitions, weapon alignment.

**The camera must not be too high or too far away.** It must remain precise enough for
fast edits.

| Parameter | Value | Marker |
| --- | --- | --- |
| Distance | 4.0 m | [PROV] |
| Shoulder offset (right) | 0.8 m | [PROV] |
| Height above player base | 1.55 m | [PROV] |
| Pitch clamp | −85° to +85° | [PROV] |
| Base FOV | 80° (user-adjustable, §39) | [PROV] |
| Crouch camera drop | 0.6 m, 120 ms | [PROV] |
| Build-mode distance | 2.6 m — **unchanged**, edit precision | [OWNER-derived] |

> **Change from baseline:** the baseline pulled the camera *back* in build mode, which
> directly contradicts "precise enough for fast edits" — that behaviour is removed.
>
> **Retuned 2026-09-13 against the rendered view.** Distance was briefly set to 2.6 m to
> honour "close", but at that range a 1.92 m avatar fills the frame and occludes the
> crosshair — which §8 forbids in effect, since the player cannot see what they are aiming
> at. 4.0 m with a 0.8 m shoulder offset keeps the camera close and the character
> "slightly left of screen centre" while leaving the aim point clear.

### 7.1 Camera collision [OWNER]

The camera must not clip through walls or terrain. When blocked:

- move the camera **closer to the player**
- **avoid hard snapping** where possible
- **restore distance smoothly** when clear
- geometry must not fully obscure the player for long periods

| Parameter | Value | Marker |
| --- | --- | --- |
| Probe radius | 0.25 m | [PROV] |
| Padding off hit surface | 0.10 m | [PROV] |
| Pull-in response | immediate (no lag into geometry) | [OWNER] |
| Restore rate | smoothed, ~8 m/s | [PROV] |

Asymmetric by design: pulling in is instant (clipping is never acceptable), restoring is
smoothed (per "restore distance smoothly").

## 8. Aiming and crosshair alignment [OWNER]

**The crosshair and weapon ray must agree.** Targeting uses the **camera aim direction**.
Projectile and hitscan logic resolve consistently with what the player sees.

There must never be a case where the crosshair is on target and the weapon fires beside it.

ADS tightens FOV, shifts the camera if needed, **maintains the correct aim ray**, and
transitions smoothly.

> **This is a bug in the current implementation.** `Game._resolveShot` traces from the
> player's eye position along the player's look vector. The camera is offset to the right
> shoulder, so the traced ray does not match the rendered crosshair — exactly the failure
> the spec forbids. The fix is architectural: a single shared aim ray, originating at the
> camera, used by shooting, build targeting and edit targeting alike.

### 8.1 The shared aim ray [OWNER-derived]

One function produces the aim ray. Every system consumes it:

```
aimRay = { origin: camera.position, direction: camera.forward }
```

Weapon tracing, build placement targeting and edit targeting all use it. No system
computes its own aim direction.

## 9. Building system [OWNER]

Required pieces: **WALL**, **FLOOR**, **RAMP**, **CONE / ROOF**.

Building must feel **immediate**. Required behaviours: snap to grid, preview before
placement, place instantly, support rapid repeated placement, support building while
moving, support building while jumping, support rotation where appropriate, support
material selection, support ownership, support build health, support destruction, support
editing.

### 9.1 Build grid [OWNER]

Consistent grid. All pieces align correctly. Placement is **deterministic**.
**No cumulative drift. No arbitrary per-piece offsets.**

Grid logic supports: builds above, builds below, builds to the side, chaining pieces
rapidly, and **building through fast camera turns**.

| Parameter | Value | Marker |
| --- | --- | --- |
| **Tile footprint (`TILE`)** | **5.12 m × 5.12 m** | **[OWNER]** approved 2026-09-13 |
| **Wall height (`WALL_H`)** | **3.84 m** | **[OWNER]** approved 2026-09-13 |
| Piece thickness | `TILE × 0.0390625` = 0.20 m | [PROV] |
| Ramp slope | 36.87° (`atan(WALL_H / TILE)`) | derived |

### 9.1.1 The build module is the unit of scale [OWNER]

> "These values MUST remain centralized and configurable. Do not scatter these dimensions
> through geometry, collision or edit code. The player capsule, doors, wall openings, ramps
> and edit geometry must be dimensioned relative to the build module so we can retune
> player/build scale later without rewriting the architecture."

`TILE` and `WALL_H` are declared **once** in `src/core/Config.js`. Every other spatial
dimension in the game is **derived from them by ratio**, never written as a literal.

**No file outside `Config.js` may contain a spatial literal.** Geometry, collision, edit
tiles, the player capsule and the camera all read derived values. Retuning the module is a
two-number change that rescales the game coherently — that is the whole point of this rule,
and a test asserts the derivation rather than the absolute results.

#### Derived edit-tile dimensions

| Piece | Grid | Tile width | Tile height |
| --- | --- | --- | --- |
| Wall | 3 × 3 | `TILE / 3` = 1.7067 m | `WALL_H / 3` = 1.2800 m |
| Floor | 2 × 2 | `TILE / 2` = 2.5600 m | `TILE / 2` = 2.5600 m (depth) |
| Cone | 2 × 2 | `TILE / 2` = 2.5600 m | `TILE / 2` = 2.5600 m (depth) |
| Ramp | 3 rows × 2 cols | `TILE / 2` = 2.5600 m | `WALL_H / 3` = 1.2800 m rise/row |

#### Derived player capsule

| Dimension | Ratio | Value |
| --- | --- | --- |
| Capsule radius | `TILE × 0.078125` | 0.400 m (0.800 m diameter) |
| Standing height | `WALL_H × 0.5` | 1.920 m |
| Crouched height | `WALL_H × 0.3125` | 1.200 m |
| Step height | `WALL_H × 0.1171875` | 0.450 m |

Crouched height is deliberately just under one wall-edit row (1.28 m), so a crouched player
clears a single-row opening and a standing player does not. That relationship is a
consequence of the ratios and survives any retune of the module.

#### Clearance verification [OWNER requirement]

Computed from the ratios above and asserted by test:

| Opening | Size | Side clearance | Head clearance | Passable |
| --- | --- | --- | --- | --- |
| **Door** (tiles 4,7) | 1.707 × 2.560 m | +0.453 m | +0.640 m | **Standing** ✅ |
| **Three-tile opening** (1,4,7) | 1.707 × 3.840 m | +0.453 m | +1.920 m | **Standing** ✅ |
| Bottom row (6,7,8) | 5.120 × 1.280 m | +2.160 m | −0.640 m | Crouched only |
| Window (tile 4) | 1.707 × 1.280 m | +0.453 m | −0.640 m | Not passable (by design) |

> **Correction to the baseline.** The baseline defined the door as tiles `6,7` — a
> *horizontal* pair only 1.28 m tall, which a 1.92 m standing player cannot walk through.
> The door is a **vertical** opening in the middle column, tiles `4,7`. The "three-tile
> opening" the owner requires to fit the player is likewise the **full middle column**
> `1,4,7`, not the bottom row.

Cells are integer `(cx, cy, cz)` addressed from world origin, axis-aligned, never rotated.
Slots per cell: `floor`, `ramp`, `cone`, `wall:north|east|south|west`.

Integer cell addressing is what satisfies "no cumulative drift" — positions are computed
from indices, never accumulated.

### 9.2 Build preview [OWNER]

Translucent preview of **the exact piece that will be placed**. It must match final
geometry, final rotation and final position; reflect valid/invalid placement; and update
immediately.

**Preview collision and final collision must not disagree.** The preview is generated from
the same geometry source as the placed piece — never a separate approximation.

### 9.3 Placement responsiveness [OWNER]

Placement must **not visibly lag behind input**. These sequences must work reliably:

- wall → floor → ramp
- wall → wall → ramp
- 90s
- tunnelling
- protected ramp rushes

**Use input buffering or queued placement if necessary. Do not silently drop build inputs
because a previous placement happened milliseconds earlier.**

> **This is a violation in the current implementation.** The baseline rejects placements
> inside a 0.10 s window with `RATE_LIMITED` and discards the input. That is precisely the
> banned behaviour. Replaced by a **placement queue**: an input arriving during the
> cooldown is buffered and executed when the window opens.

| Parameter | Value | Marker |
| --- | --- | --- |
| Placement cooldown | 0.05 s | [PROV] |
| Queue depth | 3 intents | [PROV] |
| Queued intent lifetime | 0.25 s, then discarded as stale | [PROV] |
| Placement range | 12.0 m | [PROV] |
| Cost per piece | 10 material | [PROV] |

### 9.4 Materials [OWNER]

**WOOD, BRICK, METAL.** Each has different health, distinct visual appearance, different
construction progression, a material count and a placement cost.

> **Change from baseline:** the baseline's second material was `stone`. The spec says
> **BRICK**. Renamed throughout — config, HUD, renderer, tests.

Placeholder material visuals are acceptable while mechanics are correct.

| Material | Initial HP | Full HP | Build time | Marker |
| --- | --- | --- | --- | --- |
| Wood | 90 | 150 | 3.5 s | [PROV] |
| Brick | 90 | 300 | 11.0 s | [PROV] |
| Metal | 90 | 500 | 20.0 s | [PROV] |

Material cap 500 each [PROV].

### 9.5 Build health and damage [OWNER]

Structures have health, receive weapon damage, receive pickaxe damage, are destroyable, and
**correctly remove collision on destruction**.

**No invisible collision after destruction.** Destroying a piece removes its collider in
the same tick the piece is removed — verified by test.

### 9.5.1 Structural integrity is live [OWNER-derived]

A piece stands only while it transitively reaches the ground. When its support goes, it goes
— after `BUILD.supportGraceTime`, which is what makes a collapse read as a collapse rather
than as pieces blinking out.

**One destruction path.** Every cause — weapon fire, the pickaxe, an edit, a collapse —
reports `piece:destroyed`, and a single handler removes the piece from the grid and tells
the support system. Before this the paths disagreed: the weapon path removed the piece, the
pickaxe path only announced it, so a pickaxed wall kept its slot forever and the player could
never rebuild in it.

**Dirty-region, not a world scan.** Support can only change where the grid changed, so a
placement or a destruction re-evaluates the pieces that rest on the changed piece and nothing
else. One global pass runs at match start to establish the baseline; every answer after that
is incremental. An idle frame costs nothing.

This is exact, not an approximation. Every lookup that decides support is inside a piece's
own cell, the cell below, or an orthogonal neighbour, so the set of pieces that can name a
given piece as a supporter is bounded to a five-cell footprint across two layers. Inverting
that precisely is what makes the local answer identical to the global one — and that identity
is asserted by test, not assumed.

**Responsiveness outranks structural simulation.** Support work must never sit between an
input and a placement.

What supports what:

- A **floor** rests on walls at its own cell's edges, on a ramp or cone directly below, on
  the high edge of a ramp in the neighbouring cell one layer down, or on an adjacent floor.
- A **wall** rests on a floor in its cell, on the wall directly below it facing the same way,
  or on a floor in the cell below.
- A **ramp or cone** rests on a floor in its cell, or on anything in the cell below.
- A piece resting ON the ground is grounded. That test carries a tolerance of one piece
  thickness at both ends: POI pads are snapped to a storey line (MAP_SPEC §21.2.1), so a
  whole POI's ground storey sits exactly on the boundary, and an exact comparison would let
  floating-point noise decide whether a building stands.

**Edit patterns do not participate.** What holds a piece up is what it IS and where, never
which tiles survive an edit: a wall cut down to a half wall still carries the floor above it.
Deleting a piece by edit is a removal like any other.

## 10. Editing system [OWNER]

Editing is a **critical system** and must be **extremely responsive**.

On entering edit mode the game must:

1. identify the **exact** build piece being aimed at
2. reject invalid target selection cleanly
3. show the edit grid
4. allow precise tile selection
5. allow **click-and-drag** selection
6. highlight selected tiles **immediately**
7. validate the pattern
8. confirm the edit
9. **update geometry**
10. **update collision**
11. exit the edit state correctly

### 10.1 Edit targeting [OWNER]

Editing targets the build **under the player's crosshair**. **Do not guess based on
nearest build if the aimed build is clear.** Uses the §8.1 shared aim ray.

If the player moves too far away: cancel edit mode, remove edit UI, restore normal
controls. **No stuck edit state.**

| Parameter | Value | Marker |
| --- | --- | --- |
| Max edit distance | 8.0 m | [PROV] |
| Targeting method | ray/AABB intersection against piece geometry, nearest hit wins | [OWNER] |

> **Change from baseline:** the baseline marched a ray cell-by-cell and then picked a
> piece from the cell by a type preference order — that is "guessing", which the spec
> forbids. Replaced with true geometric intersection against each piece's bounds.

### 10.2 Edit grids — per piece type [OWNER]

**This is the single largest correction to the baseline.** Grids are **not** uniform:

| Piece | Grid | Tiles | Baseline had |
| --- | --- | --- | --- |
| **Wall** | **3 × 3** | 9 | 3 × 3 ✅ correct |
| **Floor** | **2 × 2** | 4 | 3 × 3 ❌ wrong |
| **Cone / roof** | **2 × 2** | 4 | 3 × 3 ❌ wrong |
| **Ramp / stair** | **3 rows × 2 columns** | 6 | 3 × 3 ❌ wrong |

The edit-pattern module, the pattern tables, the overlay UI, the collision builder and
every edit test are rewritten around per-type grid dimensions.

### 10.3 Wall editing — 3 × 3 [OWNER]

Tile indices, face-on from the editing player:

```
0 1 2
3 4 5
6 7 8
```

Required valid patterns: single window, centred window, side window, door, door + window,
corner opening, half wall, top row removed, three-tile opening, arch-like opening where
appropriate, and common competitive wall edits. **Invalid patterns must be rejected.**

Openings intended to be walked through are **vertical**, because one row is only
`WALL_H / 3` = 1.28 m tall while a standing player is 1.92 m (§9.1.1):

| Pattern | Tiles | Walkable |
| --- | --- | --- |
| Door | `4, 7` | Standing |
| Three-tile opening / arch | `1, 4, 7` | Standing |
| Door + window | `1, 4, 7` with `3` or `5` | Standing |
| Bottom row | `6, 7, 8` | Crouched only |

Implemented as an allow list so anything unlisted is rejected by construction.

### 10.4 Wall collision [OWNER]

**Edited wall collision must match the visible edited shape.** If the wall visually has an
opening, **the player must be able to pass through it**.

**Do not keep the full original wall collider after edit.**

**A three-tile opening must provide enough clearance for the player capsule.** With a
5.12 m tile, one edit tile is 1.706 m wide against a 0.8 m capsule diameter — a
single-tile opening already clears, and a three-tile opening clears comfortably. This is
asserted by test, not assumed.

### 10.5 Floor editing — 2 × 2 [OWNER]

```
0 1
2 3
```

Required: one quarter removed, half floor, directional half variants, reset.
**Edited floor collision must match the remaining geometry.**

### 10.6 Cone editing — 2 × 2 [OWNER]

Required: common directional edit forms. **Collision must update to match transformed
geometry.**

### 10.7 Ramp / stair editing — 3 rows × 2 columns [OWNER]

```
[0][1]
[2][3]
[4][5]
```

Required: normal stair, flipped stair, rotated stair, directional variants, half-stair
style edits where valid, reset.

**The visual stair must correspond directly to the edit grid.**

### 10.8 Ramp collision [OWNER] — MANDATORY

> "If the ramp is flipped or transformed: the previous collision must disappear. Never
> leave stale collision from the old orientation. Collision must be rebuilt or swapped
> immediately."

The old collider is **destroyed**, not hidden, disabled or offset. Rebuild happens in the
same tick as the geometry change. Asserted by a dedicated test.

### 10.9 Edit reset [OWNER]

Instant edit reset. Default bind **MOUSE WHEEL DOWN**.

Workflow: aim at an edited build → trigger reset bind → **structure resets immediately**.

Confirm-on-release must be supported as **ON/OFF**.

### 10.10 Edit performance [OWNER]

These must work repeatedly **without dropped inputs**: wall edit, floor edit, cone edit,
ramp edit, **double edit**, **triple edit**, **edit-reset-edit loops**.

### 10.11 Edit invariants [OWNER-derived]

- Editing never changes a piece's HP, material or owner.
- Editing costs and refunds no material.
- Removing every tile deletes the piece and triggers support re-evaluation.
- Only the owning player may edit a piece.

## 11. Edited collision [OWNER] — priority 6

A first-class system. **It does not exist in the current implementation** — the baseline
renders edits but collides against the unedited piece.

Requirements:

- Collision is generated **from the edit pattern**, so geometry and collision share one
  source and cannot drift apart.
- The old collider is destroyed on every edit, reset and destruction.
- Openings are passable; remaining geometry is solid.
- Rebuild is immediate — same tick.
- No stale collider may survive any edit, flip, reset or destruction.

### 11.1 Representation [PROV]

Each piece resolves to a set of solid boxes in piece-local space, derived from its type and
current edit pattern:

- **Wall** — a 3 × 3 lattice of `(tile/3) × (wallHeight/3) × thickness` boxes; removed
  tiles contribute no box.
- **Floor** — a 2 × 2 lattice of `(tile/2) × thickness × (tile/2)` boxes.
- **Cone** — 2 × 2 quadrants of the pyramid.
- **Ramp** — **an inclined plane per occupied grid column**, not stepped boxes.

> **Correction.** An earlier draft proposed one collision box per ramp edit row. Each row
> rises `WALL_H / 3` = 1.28 m, far above the 0.45 m step height, so a stepped collider
> would wall the player off from their own ramp. Ramp collision is a **sloped surface**:
> each of the 2 columns contributes an inclined plane spanning the rows that remain after
> the edit, at the slope `atan(WALL_H / TILE)` = 36.87°. A flipped or rotated stair
> produces a plane with the corresponding orientation, and the previous plane is destroyed
> (§10.8).

Collision queries test these shapes. The renderer draws the same set, built by the same
function from the same edit pattern. One source, no drift.

## 12. Weapon system [OWNER]

Required categories: **assault rifle, shotgun, SMG, pistol, sniper, utility, healing
consumables**.

Each weapon defines: damage, fire rate, magazine size, **reserve ammo**, reload time,
spread, **recoil**, headshot multiplier, **equip time**, rarity, ammo type, and
hitscan/projectile behaviour.

> **Gaps against baseline:** no `recoil`, no per-weapon `equipTime` (a single global
> 0.25 s switch time was used), no `reserveAmmo` cap per weapon, and no `utility`
> category. All added.

### 12.1 Weapon table [PROV]

Common rarity. Every value here is provisional and expected to be retuned.

| Weapon | Category | Damage | RPS | Mag | Reserve | Reload | Equip | Headshot | Ammo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Assault Rifle | assaultRifle | 30 | 5.5 | 30 | 210 | 2.3 s | 0.55 s | ×2.0 | medium |
| SMG | smg | 17 | 11.0 | 30 | 240 | 2.1 s | 0.45 s | ×2.0 | light |
| Pump Shotgun | shotgun | 9 ×10 pellets | 0.75 | 5 | 60 | 4.5 s | 0.85 s | ×1.5 | shells |
| Tactical Shotgun | shotgun | 6 ×10 pellets | 1.6 | 8 | 60 | 3.6 s | 0.70 s | ×1.5 | shells |
| Bolt Sniper | sniper | 105 | 0.55 | 1 | 20 | 2.8 s | 1.05 s | ×2.5 | heavy |
| Pistol | pistol | 24 | 6.75 | 16 | 180 | 1.5 s | 0.40 s | ×2.0 | light |
| Rocket Launcher | utility | 100 direct / 75 splash | 0.6 | 1 | 12 | 3.2 s | 1.10 s | — | rockets |

Ammo types: light, medium, heavy, shells, rockets.

### 12.2 Weapon firing [OWNER]

Fire must feel **immediate**. On trigger, all of these happen **instantly**: fire event,
muzzle event, hit registration, damage feedback. **No delayed feedback chain.**

Firing resolves in the same tick as the input. Feedback is never deferred to a later tick
or gated behind an animation.

### 12.3 Recoil [OWNER]

Per-weapon recoil. Distinct from spread: recoil moves the **aim point**, spread randomises
**within** it.

| Parameter | Meaning | Marker |
| --- | --- | --- |
| `recoilVertical` | degrees of upward kick per shot | [PROV] |
| `recoilHorizontal` | degrees of random lateral kick per shot | [PROV] |
| `recoilRecovery` | degrees/second returning to the original aim | [PROV] |

### 12.4 Spread [PROV]

Base spread, growing with sustained fire and movement, decaying after a delay. ADS reduces
spread; crouching reduces it further.

### 12.5 Shotguns [OWNER]

Shotguns use **pellet-based spread**. Each pellet must **resolve independently**,
contribute damage correctly, and **support headshot detection**. Total damage may be capped
if balance requires.

**Do not fake shotgun damage as one simple ray if pellet behaviour is intended.**

> **Change from baseline:** the baseline multiplied damage by pellet count in a single
> calculation, with one hit region for the whole shot. Rewritten so each pellet is traced
> and resolved on its own, meaning a shot can land 6 body pellets and 2 head pellets and
> score correctly.

Pellet directions come from a deterministic pattern jittered by the seeded `spread` stream,
so patterns are learnable rather than pure noise.

### 12.6 Headshots [OWNER]

Detected **reliably**. Per-weapon multipliers. **Visually distinct feedback.**

## 13. Damage system [OWNER]

**100 HEALTH, 100 SHIELD.**

Default damage order: **shield first, then health**, unless an explicit damage type
overrides it. Overflow carries into health within the same hit.

**Damage must update the HUD immediately.**

### 13.1 Damage feedback [OWNER]

On a successful hit, all appear **immediately**: hitmarker, damage number, health/shield
reaction, optional impact effect, optional sound. Headshots get **distinct** feedback.

### 13.2 Eliminations [OWNER]

At zero health, immediately: elimination triggers, elimination counter updates, kill feed
updates, **loot drops**, target becomes inactive/removed, optional elimination effect.

**Optional siphon system:** when enabled, restore configured health/shield immediately.
Default off [PROV].

## 14. Pickaxe [OWNER]

A functional pickaxe is required: equip, swing, structure hit, prop hit, damage, harvesting
where applicable, impact feedback, swing sound, impact sound.

> The baseline had harvest *values* in config but **no pickaxe implementation** — no swing,
> no hit resolution, no equip. Built from scratch.

| Parameter | Value | Marker |
| --- | --- | --- |
| Swing interval | 0.55 s | [PROV] |
| Range | 3.0 m | [PROV] |
| Damage to structures | 100 enemy / 0 own | [PROV] |
| Damage to players | 20 | [PROV] |
| Harvest per swing | 12 wood / 14 brick / 12 metal | [PROV] |

The pickaxe occupies its own slot, separate from the five combat slots (§15).

## 15. Inventory [OWNER]

**Five-slot combat inventory.**

> **Change from baseline:** the baseline used six slots with slot 0 permanently holding the
> tool. The spec specifies five combat slots and binds `pickaxe` as an action distinct from
> `weaponSlot1`–`weaponSlot5`. Restructured: **5 combat slots + a separate pickaxe slot**.

The player must be able to: pick up items, drop items, swap items, **reorder slots**, equip
by number key, **switch by mouse wheel**, see rarity, see ammo, see the current item, and
replace occupied slots when appropriate.

**Inventory operations must never randomly delete items.** Every operation is total: an
item leaving a slot is either placed in another slot or dropped into the world as a
pickup. Asserted by test.

## 16. Loot [OWNER]

**World loot must exist physically in the world.** Items have a world position, are
interactable, display rarity readably, enter inventory on pickup, and are droppable.

Optional polish: subtle rotation, hover, glow by rarity.

> The baseline generated loot *tables* but had **no world loot entities** — no position, no
> interaction, no pickup. Built from scratch.

### 16.1 Chests [OWNER]

3D chest object, interact prompt, opening state, opening sound, loot spawn, ammo,
materials, healing chance, rarity-weighted weapon chance.

**Loot appears in the world. Chest contents are NOT injected directly into inventory.**

### 16.2 Ammo boxes [OWNER]

Interactable, open, spawn ammo pickups, play audio, enter an opened state.

### 16.3 Rarity [OWNER]

**COMMON, UNCOMMON, RARE, EPIC, LEGENDARY.**

Rarity may influence damage, reload, spread, magazine size or other tuning.
**Do not overcomplicate balance before the systems are stable** — rarity affects damage
only for now [PROV].

### 16.4 Consumables [OWNER]

At minimum: **small shield, large shield, medkit or equivalent health item.**

Consumables occupy inventory, require use time where designed, apply correct health/shield
limits, and are interruptible where appropriate.

| Item | Use time | Effect | Cap | Marker |
| --- | --- | --- | --- | --- |
| Small Shield | 2.0 s | +25 shield | 50 | [PROV] |
| Large Shield | 5.0 s | +50 shield | 100 | [PROV] |
| Medkit | 8.0 s | health to full | 100 | [PROV] |

## 17. Bots / test targets [OWNER]

Lightweight bots supporting movement, jumping, shooting, taking damage, dying and dropping
loot. **Complex AI is not a priority.** Simple, performant logic.

## 18. HUD [OWNER]

Required: health, shield, ammo, inventory slots, materials, selected build piece, selected
material, minimap, **compass**, **player count**, **elimination count**, kill feed,
**interaction prompts**, **edit state indicators**.

**The HUD must look like game UI, not generic website UI.**

> Missing from baseline: compass, player count, elimination count, interaction prompts,
> edit state indicators.

### 18.1 HUD responsiveness [OWNER]

Updates happen **immediately** on state change: health, shield, ammo, weapon swap, material
use, elimination, inventory reorder, build piece selection. Event-driven, never polled on a
delay.

## 19. Settings [OWNER]

**Video:** resolution, fullscreen, graphics quality, shadows, effects, render distance, FPS
limit, FOV.
**Input:** mouse sensitivity, ADS sensitivity, scope sensitivity, invert Y.
**Gameplay:** sprint settings, **confirm edit on release**, **reset edit bind**, build
immediately.
**Audio:** master, music, SFX, environment/dialogue.
**HUD:** HUD scale, crosshair, minimap toggle, damage numbers.

> No settings system exists in the baseline. Built from scratch.

## 20. Keybind customisation [OWNER]

All important gameplay actions rebindable. Mouse buttons and **mouse wheel** are valid
binds. **Conflicts are detected and handled clearly.**

## 21. Audio [OWNER]

Original or royalty-free/generated audio only.

Required categories: weapon fire, reload, empty weapon, hitmarker, headshot, elimination,
pickaxe swing, pickaxe impact, footsteps, jump, landing, building placement, editing, reset
edit, chest, ammo box, pickup, UI navigation, storm if implemented, victory if implemented.

Audio must be crisp and not excessively loud.

**Footsteps:** surface-based types where feasible (grass, wood, metal, stone, water).
Lower priority than core movement.

## 22. Small test environment first [OWNER]

**Do NOT prioritise the full island yet.**

A compact, polished test environment supporting: building tests, edit tests, weapon tests,
movement tests, elevation tests, simple interior spaces, open field, ramp/floor/wall
chains, basic loot, one or two bots.

This environment exists for **gameplay validation**.

## 23. Performance [OWNER]

**Stable 60 FPS minimum.** Higher preferred.

When performance degrades, reduce: distant terrain, decorative props, particles, shadow
quality, excessive foliage, draw calls, expensive post-processing.

**Never reduce:** input polling, building responsiveness, edit responsiveness, collision
correctness, hit feedback.

## 24. Quality assurance [OWNER]

Every major system has tests. Required validation:

**Movement** — rapid WASD changes, jump, sprint, crouch, jump-turn, slope traversal,
step-up, collision stability.
**Camera** — wall collision, terrain collision, crouch adjustment, ADS alignment,
crosshair/weapon-ray alignment.
**Building** — rapid walls, rapid floors, rapid ramps, rapid cones, wall-floor-ramp, 90s,
tunnelling, **no dropped placement**.
**Editing** — wall window, door, corner edit, three-tile opening, floor half edit, cone
edit, ramp flip, reset edit, double edit, triple edit, edit distance cancellation.
**Collision** — walk through edited openings, edited ramp traversal, reset collision,
destroyed build collision removal, **no stale collider after edit**.
**Combat** — bodyshot, headshot, shotgun pellets, reload, weapon swap, empty magazine,
damage number, elimination.
**Inventory** — pickup, drop, replace, reorder, equip, chest loot, ammo pickup.

## 25. No false "done" [OWNER]

A feature is **not** complete because code compiles, tests compile, UI exists, or
placeholder logic exists.

A feature is complete only when: **it works**, **tests pass**, **no obvious edge-case bug
remains**, and **it integrates with related systems**.

## 26. Bug fixing rule [OWNER]

If a core system is wrong, **refactor it**.

- Build pieces misalign → fix grid maths.
- Edit collision wrong → rebuild collision geometry.
- Camera aim wrong → fix ray architecture.
- Rapid inputs drop → fix input processing.

**Do not accumulate hacks.**

## 27. Implementation order [OWNER]

| Phase | Work |
| --- | --- |
| 1 | Input + movement |
| 2 | Camera |
| 3 | Building placement |
| 4 | Editing |
| 5 | Edited collision |
| 6 | Combat |
| 7 | Inventory / loot |
| 8 | HUD |
| 9 | Settings / keybinds |
| 10 | Audio |
| 11 | Bots / simple match loop |
| 12 | Small polished test environment |
| 13 | Performance pass |
| 14 | **Only then** expand world / map |

## 28. Final standard [OWNER]

These must feel excellent: movement, camera, building, editing, edit reset, edited
collision, combat, weapon switching, damage feedback.

**Acceptance gates — if any fail, core gameplay is not finished:**

1. A fast 90 works repeatedly.
2. A double edit works repeatedly.
3. A triple edit works repeatedly.
4. A three-tile wall opening lets the player through.
5. A flipped stair does not retain its old collision.
6. Rapid building does not drop inputs.
7. Crosshair and shot direction agree.

Each is a named test in the suite.

---

## 46. Provisional values needing owner sign-off

The owner's specification is behavioural; these numbers were not supplied and are carried
or derived. Listed highest-impact first.

**Signed off by the owner on 2026-09-13:**

| Value | Approved as |
| --- | --- |
| Simulation tick rate | 60 Hz |
| Build tile / wall height | 5.12 m / 3.84 m, centralised and derived from (§9.1.1) |

**Still outstanding:**

| # | Value | Current | Why it matters |
| --- | --- | --- | --- |
| 3 | Camera distance / shoulder offset | 4.0 m / 0.8 m | "Close", "not too far", edit precision — retuned against the rendered view |
| 4 | Movement speeds and acceleration | 4.6 / 7.6 / 2.4 m/s, 85 m/s² | Whole feel of the game |
| 5 | Weapon damage / fire rate table | §12.1 | All combat balance |
| 6 | Placement cooldown and queue depth | 0.05 s, 3 | "No dropped inputs" |
| 7 | Edit range | 8.0 m | Edit reachability |
| 8 | Material HP and build times | §9.4 | Build fight pacing |
| 9 | Recoil values | §12.3 | Not specified at all |
| 10 | Consumable use times | §16.4 | Heal pacing |

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.1.0 | 2026-09-14 | Adds §9.5.1: structural integrity runs live, via dirty-region support propagation rather than a per-frame world scan. Unifies the destruction path so every cause removes the piece from the grid. Adds the ramp-landing support relationship and a ground-contact tolerance. |
| 1.0.0 | 2026-09-13 | Replaced the placeholder baseline with the owner's authoritative specification. Key corrections: per-type edit grids (floor 2×2, cone 2×2, ramp 3×2), edited collision as a first-class system, five-slot inventory with a separate pickaxe, BRICK replacing stone, shared camera aim ray, placement queue replacing input-dropping rate limits, per-pellet shotgun resolution, recoil and equip time, world loot entities, settings, audio, bots. |
| 0.1.0 | 2026-09-13 | Initial baseline placeholder. Void. |
