# assets/

Runtime-ready assets, served at the site root by Vite (`publicDir: 'assets'`). A file at
`assets/maps/cinder-isle.json` is fetched at runtime as `/maps/cinder-isle.json`.

| Folder | Contents | Formats |
| --- | --- | --- |
| `models/` | Character, weapon, and prop meshes | `.glb` (glTF binary, Draco-compressed) |
| `textures/` | Albedo, normal, roughness, splat maps | `.ktx2` preferred, `.png` accepted |
| `audio/` | SFX and music | `.ogg`, `.webm` |
| `fonts/` | HUD typefaces | `.woff2` |
| `maps/` | Heightmaps, splat maps, POI layouts, manifests | `.png` (16-bit), `.json` |

## Rules

- **Runtime-ready only.** Source files (`.blend`, `.psd`, `.wav`) do not belong here. Keep
  them outside the repository or in a separate asset repository.
- **No third-party game assets.** Nothing ripped, extracted, or datamined from any shipped
  game. See `references/README.md`.
- Budget per `MASTER_SPEC §11.2`: 2.5 M triangles and 1200 draw calls per frame total.
  A single prop above 20 k triangles needs a reason.
- Every new asset gets a line in the relevant `references/` README saying where it is used.

## Current state

No binary assets yet. Until a heightmap exists in `maps/`, `src/world/TerrainGenerator.js`
generates the island procedurally from the map seed (`MAP_SPEC §4.1`, §10 step 4), so the
game runs with an empty `assets/` tree.
