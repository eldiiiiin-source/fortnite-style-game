# HUD layout

Anchors and safe areas for every element in `MASTER_SPEC §10`.

All positions are given as `(anchor, offsetX, offsetY)` in CSS pixels at a 1920×1080
reference resolution, scaled by `min(width/1920, height/1080)` and clamped to
`[0.75, 1.5]`.

## Safe areas

```
┌──────────────────────────────────────────────────────┐
│ kill feed                storm timer      minimap    │  ← top band, 120 px
│                                                      │
│                                                      │
│                   ┌────────────────┐                 │
│                   │                │                 │
│                   │   NO HUD ZONE  │                 │  ← centre 40% of width
│                   │   (crosshair   │                 │     and height: nothing
│                   │    only)       │                 │     but crosshair, hit
│                   │                │                 │     marker, damage numbers
│                   └────────────────┘                 │
│                                                      │
│                                          materials   │
│  (empty)          health / shield        build bar   │  ← bottom band, 180 px
│                                        inventory bar │
└──────────────────────────────────────────────────────┘
```

## Element table

| Element | Anchor | Offset | Size | Notes |
| --- | --- | --- | --- | --- |
| Health bar | bottom-centre | `(−180, −56)` | 360 × 16 | White fill, numeric right-aligned inside |
| Shield bar | bottom-centre | `(−180, −78)` | 360 × 16 | Cyan `#3FD2E8`, sits directly above health |
| Material counters | bottom-right | `(−392, −196)` | 3 × 120 × 32 | Wood / Stone / Metal, icon + count |
| Build bar | bottom-right | `(−392, −152)` | 4 × 88 × 88 | Wall, Floor, Ramp, Cone; active slot 1.1× scale |
| Inventory bar | bottom-right | `(−560, −56)` | 6 × 88 × 88 | Slot 0 fixed (tool); rarity border 3 px |
| Crosshair | centre | `(0, 0)` | dynamic | Gap in px = `spreadDegrees * 14` |
| Minimap | top-right | `(−236, 20)` | 216 × 216 | North-up, 300 m radius |
| Storm timer | top-centre | `(−120, 20)` | 240 × 56 | Phase, countdown, players alive |
| Kill feed | top-left | `(20, 20)` | 400 × 140 | Max 5 rows, 6 s each, fades out |
| Damage numbers | world-space | at hit point | 24 – 40 px | Rises 40 px over 0.8 s, fades last 0.3 s |
| Hit marker | centre | `(0, 0)` | 32 × 32 | 120 ms; elimination variant is red and 1.4× |

## Colours

| Token | Value | Used for |
| --- | --- | --- |
| `--hud-health` | `#FFFFFF` | Health bar fill, health damage numbers |
| `--hud-shield` | `#3FD2E8` | Shield bar fill, shield damage numbers |
| `--hud-headshot` | `#FFD54A` | Headshot damage numbers |
| `--hud-wood` | `#C9873B` | Wood counter and build ghost |
| `--hud-stone` | `#9AA0A6` | Stone counter and build ghost |
| `--hud-metal` | `#7FB4D9` | Metal counter and build ghost |
| `--hud-valid` | `#4CD94C` | Placeable build ghost |
| `--hud-invalid` | `#E84C4C` | Blocked build ghost |
| `--hud-bg` | `rgba(8,10,14,0.62)` | Panel backing behind every element |

Every foreground token is checked against `--hud-bg` **and** against the four time-of-day
sky palettes (`MAP_SPEC §8`) at 4.5:1 minimum. The panel backing exists precisely so the
bright-sky case passes.

## Build bar states

| State | Treatment |
| --- | --- |
| Idle | 62 % opacity, no border |
| Selected | 100 % opacity, 2 px white border, 1.1× scale |
| Insufficient material | Icon desaturated, count in `--hud-invalid` |
| Placement cooldown | 0.10 s radial sweep over the slot (§6.3 rule 6) |

## Edit overlay

Drawn in **world space** on the target piece's face, not as a screen overlay, so it stays
aligned as the player moves. 3×3 grid, 2 px lines at 70 % opacity; a selected tile fills
with `--hud-valid` at 35 % opacity. The overlay renders on top of the piece with depth
test off but is still frustum-culled.

## Aspect ratios

| Ratio | Change |
| --- | --- |
| 16:9 | Reference layout |
| 21:9 | Bottom-corner clusters stay anchored to the corners; the no-HUD zone widens with the screen |
| 4:3 | Minimap drops to 180 × 180; storm timer moves to top-left under the kill feed |

## Open items

- Minimap vs. storm timer collision at 4:3 — the fix above is provisional, mock it.
- Should the inventory bar hide entirely in build mode? Leaning no: players read their
  weapon before swapping out of build.
