# references/

Research and reference material for humans. **Nothing in `src/` may import from here.**

Each subfolder collects the material behind one area of the specs. When you add a
reference, add a line to that subfolder's README saying what it is and which spec section
it informs — an undocumented image in here is noise.

| Folder | Area | Spec it informs |
| --- | --- | --- |
| `map/` | Layouts, heightmaps, POI studies | `docs/MAP_SPEC.md` |
| `gameplay/` | Movement feel, TTK, weapon tuning | `docs/MASTER_SPEC.md` §3, §5 |
| `building/` | Piece geometry, snapping, structures | `docs/MASTER_SPEC.md` §6 |
| `editing/` | Edit grid patterns, edit timing | `docs/MASTER_SPEC.md` §7 |
| `ui/` | HUD layout, build bar, inventory | `docs/MASTER_SPEC.md` §10 |

## Rules

- **No copyrighted game assets.** Do not commit rips, extracted models, textures, or
  datamined data from any shipped game. Original sketches, your own screenshots of your
  own build, measurements, and written notes are fine.
- Prefer text and diagrams over large binaries. Keep images under 2 MB.
- Name files `NN-short-description.ext` so they sort in a sensible reading order.
