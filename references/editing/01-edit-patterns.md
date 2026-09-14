# Edit patterns

Per-piece-type edit grids, per `docs/MASTER_SPEC.md` §10.2 – §10.7.

**The grids are not uniform.** This is the single largest correction the owner's
specification made to the original baseline, which used 3×3 for every piece type.

| Piece | Grid | Tiles | Tile size (at TILE 5.12 / WALL_H 3.84) |
| --- | --- | --- | --- |
| Wall | 3 × 3 | 9 | 1.707 w × 1.280 h |
| Floor | 2 × 2 | 4 | 2.560 × 2.560 |
| Cone | 2 × 2 | 4 | 2.560 × 2.560 |
| Ramp | 3 rows × 2 cols | 6 | 2.560 w, 1.280 rise per row |

`#` is remaining geometry, `·` is removed. You select what you want gone.

## Walkable openings are vertical

One wall row is `WALL_H / 3` = **1.280 m**. A standing player is `WALL_H / 2` = **1.920 m**.
A horizontal opening therefore cannot be walked through, whatever its width.

| Opening | Tiles | Size | Passable |
| --- | --- | --- | --- |
| Door | `4,7` | 1.707 × 2.560 | **Standing** |
| Arch / three-tile | `1,4,7` | 1.707 × 3.840 | **Standing** |
| Bottom row | `6,7,8` | 5.120 × 1.280 | Crouched only |
| Window | `4` | 1.707 × 1.280 | No |

## Wall — 3 × 3

```
 0 1 2          Door (4,7)      Arch (1,4,7)    Window (4)
 3 4 5          # # #           # · #           # # #
 6 7 8          # · #           # · #           # · #
                # · #           # · #           # # #

Half wall (0-5)  Top row (0,1,2)  Left column (0,3,6)  Corner BL (3,4,6,7)
· · ·            · · ·            · # #                # # #
· · ·            # # #            · # #                · · #
# # #            # # #            · # #                · · #
```

## Floor — 2 × 2

```
 0 1      Quarter (0)   Half north (0,1)   Half west (0,2)
 2 3      · #           · ·                · #
          # #           # #                · #
```

Removing all four deletes the piece.

## Cone — 2 × 2

Same grid as the floor, viewed from above. Quadrants of the pyramid; each surviving
quadrant is a sloped face rising to the apex at the cell centre.

## Ramp — 3 rows × 2 columns

```
 [0][1]   top    (highest)
 [2][3]   middle
 [4][5]   bottom (lowest)

Half left (0,2,4)   Half right (1,3,5)   Flipped (0,1)   Landing (4,5)
 · #                 # ·                  · ·             # #
 · #                 # ·                  # #             # #
 · #                 # ·                  # #             · ·
```

## Collision

Collision is **derived from the pattern**, by the same `PieceGeometry` functions that
build the visible mesh. There is no stored collider, so a stale one cannot exist — which
is how `MASTER_SPEC §10.8` ("never leave stale collision from the old orientation") is
satisfied structurally rather than by a cleanup step.

- Wall and floor → one solid box per remaining tile.
- Ramp and cone → **height fields**, not stacked boxes. One ramp row rises 1.280 m against
  a 0.450 m step height, so a stepped collider would wall the player off their own ramp.

## Rejected selections

The tables are allow lists: anything unlisted is rejected by construction. Also rejected
is any tile index outside the piece's own grid — tile `8` is valid on a wall and invalid
on a 2×2 floor, and `EditController.dragTile` refuses it.

Tests: `tests/editing.test.js`, and the collision consequences in `tests/acceptance.test.js`.
