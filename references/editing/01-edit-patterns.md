# Edit patterns

Every valid 3×3 selection, per piece type (`MASTER_SPEC §7.3` – §7.6).

Grid indices, viewed face-on from the editing player:

```
0 1 2
3 4 5
6 7 8
```

In the diagrams below, `#` is **remaining geometry** and `·` is **removed**. The "selected"
tiles are the removed ones — you select what you want gone.

## Walls (§7.3)

```
Full wall          Window (4)         Door (6,7)         Doorway wide (6,7,8)
# # #              # # #              # # #              # # #
# # #              # · #              # # #              # # #
# # #              # # #              · · #              · · ·

Half wall (0-5)    Corner left (2,5,8)  Corner right (0,3,6)
· · ·              # # ·                · # #
· · ·              # # ·                · # #
# # #              # # ·                · # #

Peek left (3)      Peek right (5)
# # #              # # #
· # #              # # ·
# # #              # # #
```

**Door** is the highest-traffic edit in the game — it is how a player exits their own box
without breaking it. It must be reachable as a single downward drag over tiles 6 and 7.

## Floors (§7.4)

Viewed from above, with the player's facing direction toward the top of the grid.

```
Full floor         Centre hole (4)    Quarter hole (0)   Half floor (0,1,3,4)
# # #              # # #              · # #              · · #
# # #              # · #              # # #              · · #
# # #              # # #              # # #              # # #

Full drop (0-8) → the piece is deleted entirely and support is re-evaluated (§6.5)
```

`Quarter hole` is also valid at 2, 6, and 8 — the same pattern rotated.

## Ramps (§7.5)

Viewed from above (footprint), ascending toward the top of the grid.

```
Full ramp          Half left (0,3,6)  Half right (2,5,8)
# # #              · # #              # # ·
# # #              · # #              # # ·
# # #              · # #              # # ·

Ramp + platform (6,7,8)   Inverted step (0,1,2)
# # #                     · · ·
# # #                     # # #
· · ·  ← flat landing     # # #
```

`Half left` / `Half right` are the ramp edits that let a player take the high ground while
keeping a wall's worth of cover on the exposed side.

## Cones (§7.6)

```
Full cone          Half cone (0,1,2)  Quarter cone (0,1,2,3)
# # #              · · ·              · · ·
# # #              # # #              · # #
# # #              # # #              # # #
```

## Rejected selections

Anything not in the tables above leaves the piece unchanged and plays the "invalid edit"
tick. Notable rejections:

- Wall `0,1,2` (top row only) — a floating wall segment with nothing holding the top row.
- Wall `1` alone — a hole with no gameplay purpose that would be a free peek with no
  tradeoff.
- Any diagonal-only selection, e.g. `0,4,8`.
- Floor `1,3,5,7` (a cross) — awkward collision, no use case.

The rejection list is not a blacklist in code. `EditPatterns.js` holds the **allow list**
above; anything not matching is rejected by construction.

## Timing trace target

| Event | Budget |
| --- | --- |
| `G` pressed → edit overlay visible | ≤ 33 ms (one tick) |
| Drag over 2 tiles | player-bound, ~80 ms |
| Release → geometry swapped | ≤ 33 ms |
| **Total, door edit** | **≤ 150 ms** |

Spec ceiling is 250 ms (§7.2). Anything above that and the edit flow feels sticky and the
mechanic loses its place as a combat verb.
