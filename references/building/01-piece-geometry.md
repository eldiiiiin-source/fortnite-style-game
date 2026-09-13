# Build piece geometry

Local-space vertex layout for the four pieces (`MASTER_SPEC §6.2`) at the §6.1 grid size.

```
TILE = 5.12 m   (footprint, X and Z)
WALL = 3.84 m   (height, Y)
THICK = 0.20 m  (piece thickness)
```

A cell `(cx, cy, cz)` has its **minimum corner** at world
`(cx * TILE, cy * WALL, cz * TILE)`. All geometry below is in cell-local space with the
origin at that minimum corner.

## Wall

Occupies one of four cell faces, full height. Example: the **north** face (`-Z`).

```
Local AABB: (0, 0, 0) → (TILE, WALL, THICK)

     Y
     ^  0,WALL,0 ────────── TILE,WALL,0
     |     │                    │
     |     │      (north)       │        Z into the page
     |     │                    │
     +-- 0,0,0 ────────────── TILE,0,0  ──> X
```

East face: `(TILE − THICK, 0, 0) → (TILE, WALL, TILE)`
South face: `(0, 0, TILE − THICK) → (TILE, WALL, TILE)`
West face: `(0, 0, 0) → (THICK, WALL, TILE)`

## Floor

Occupies the cell base, full footprint.

```
Local AABB: (0, 0, 0) → (TILE, THICK, TILE)
```

A floor is simultaneously the ceiling of the cell below. There is no separate ceiling piece.

## Ramp (stair)

Rises `WALL` over `TILE` — 3.84 / 5.12 = **36.87°**. Example: a ramp facing **north**
(ascending toward `-Z`, i.e. the player walks up in the `-Z` direction).

```
Side view (X into the page), north is to the left:

  Y
  ^   0,WALL ──┐
  |            │  ← ramp surface, THICK thick, measured perpendicular
  |            ╲
  |             ╲
  |              ╲
  +-- 0,0 ─────── TILE,0   ──> Z
```

Collision is the sloped plane plus a thin under-shell. The walkable surface is exactly
36.87°, well inside the 48° walkable limit (`MASTER_SPEC §3.2`), so a player runs up it
without jumping.

## Cone (pyramid)

Four triangular faces meeting at the cell centre top.

```
Apex:  (TILE/2, WALL, TILE/2)
Base:  (0,0,0), (TILE,0,0), (TILE,0,TILE), (0,0,TILE)
Face slope: atan(WALL / (TILE/2)) = 56.3° — not walkable, which is the point
```

The cone's non-walkable slope is what makes it a ramp-push counter: an attacker's ramp
cannot land on top of a defender's cone.

## Common structures

Piece and material counts for the shapes players build constantly.

| Structure | Pieces | Cost | Notes |
| --- | --- | --- | --- |
| 1×1 box (4 walls) | 4 | 40 | The panic build |
| 1×1 box + floor + cone | 6 | 60 | Full protection, the standard reset |
| Ramp rush (10 tiles) | 10 ramps + 10 floors | 200 | Floors under ramps prevent a ramp-under |
| Double ramp | 20 | 200 | Two parallel ramps, cannot be cut with one shot |
| Tunnel (10 tiles) | 10 floors + 20 walls + 10 cones | 400 | Fully enclosed ground rotation |
| 90s (one rotation) | 2 ramps + 2 walls | 40 | Wall, ramp, turn 90°, repeat |

At 500 material cap (`MASTER_SPEC §4.1`) a full stack of one material buys **50 pieces**.

## Open items

- THICK = 0.20 m is a guess. It must be thin enough that a 5.12 m cell still fits a player
  capsule (0.8 m diameter) comfortably in a 1×1 box, which it does with huge margin.
- Verify the ramp's under-shell does not let a player stand inside the ramp volume.
