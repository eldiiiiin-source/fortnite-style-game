# references/building/

Reference material behind `docs/MASTER_SPEC.md` §6.

## What belongs here

- Build-piece geometry: exact vertex layouts for wall, floor, ramp, cone at the §6.1 tile size
- Snapping studies: which cell/slot the crosshair should resolve to at each camera angle
- Structure-integrity cases: diagrams of support graphs and what should cascade
- Common structures: 1×1 box, ramp rush, double ramp, tunnel, 90s — with piece counts and
  material costs
- Build-piece HP ramp timing notes

## Index

| File | What it is | Spec section |
| --- | --- | --- |
| `01-piece-geometry.md` | Local-space vertex layout for all four pieces | §6.1, §6.2 |

## Open questions

- Should the cone share a cell with a floor and walls (current spec) or occupy exclusively?
- 12 m placement range: verify a player can reliably place the floor above them while
  jumping (needs ~4 m of vertical reach from the camera).
