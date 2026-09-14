# SKIN / CHARACTER APPEARANCE SPEC

| Field | Value |
| --- | --- |
| Status | **Authoritative — from the project owner's skin-system brief, 2026-09-14** |
| Version | 1.1.0 |
| Covers | Character rig, skin definitions, palette roles, silhouette features, the skin roster, harvesting tools, rarity presentation, render fidelity, and where cosmetics render |
| Companion | `docs/ITEM_SHOP_SPEC.md` (ownership, shop, locker), `docs/MASTER_SPEC.md` (player dimensions) |
| Implementation | Complete |

> **Originality is a hard requirement.** Every name, silhouette, palette and theme in this
> document is original to this project. Nothing here reproduces any shipped game's
> characters, outfit designs, names, logos or art. Where the brief names a genre reference
> ("battle-royale-style"), it refers to the *readability standard* — clean silhouettes,
> stylised proportions, saturated palettes — not to any specific existing character.

---

## 1. Goal

Outfits are the most-looked-at cosmetic in the game: the player sees their own from behind
for an entire match, and sees everyone else's at a distance under time pressure. A skin
therefore has two jobs, in this order:

1. **Read instantly.** Distinct silhouette first, colour second, detail last.
2. **Look appealing.** Stylised, cartoon-adjacent proportions with clean shapes — not
   realistic, not crude.

A skin that is merely a recoloured default fails this spec even if it is pretty.

## 2. Target style

- Bright, stylised third-person battle-royale aesthetic.
- Clean readable silhouettes — identifiable as a black shape at 40 m.
- Polished, slightly heroic proportions; cartoony but not chibi, except where a skin's
  theme deliberately chooses stubby proportions (mascots).
- Saturated primaries with a restrained accent, rather than many competing hues.
- Distinctive rarity presentation in the UI (§8).

## 3. The character rig

### 3.1 One geometry source

A skin is **data**. Both the in-match 3D character and the 2D shop/locker/lobby preview are
generated from that same data by `cosmetics/CharacterRig.js`, which emits an ordered list of
abstract parts. Neither renderer defines a shape of its own.

This mirrors `building/PieceGeometry.js` (`CLAUDE.md`: *"Geometry has one source"*): the
preview and the in-match character cannot drift apart, because there is only one shape
definition and two consumers of it.

```
SkinDefinitions.js  →  CharacterRig.buildCharacterRig(skin)  →  parts[]
                                                                  ├── world/CharacterView.js  (three.js, in match)
                                                                  └── ui/components/CharacterPainter.js  (canvas, previews)
```

### 3.2 Rig space

Parts are emitted in **metres**, in a right-handed space whose origin is the character's
foot centre: `+Y` up, `+Z` forward (the direction the character faces), `+X` to the
character's left.

Every dimension derives from `CHARACTER` in `src/core/Config.js`, which derives in turn from
`MOVEMENT.standHeight` and `MOVEMENT.capsuleRadius` — themselves derived from the build
module (`MASTER_SPEC §9.1.1`). Retuning `TILE` or `WALL_H` rescales every character
coherently. **No skin file contains an absolute dimension.**

### 3.3 Part shape vocabulary

| Shape | Fields | Notes |
| --- | --- | --- |
| `box` | `size {x,y,z}` | The workhorse; most armour and limbs |
| `sphere` | `radius` | Heads, puffs, lantern globes |
| `cone` | `radius`, `height` | Hoods, horns, fins |
| `cylinder` | `radius`, `radiusTop`, `height` | Tanks, poles, ponytails |
| `wedge` | `size {x,y,z}` | Visors, brims, shoulder slopes |

Every part also carries `pos {x,y,z}`, an optional `rot {x,y,z}` in radians, a `role`
naming which palette colour paints it (§4), and a `tag` naming the body region it belongs to
(`torso`, `head`, `armL`, `legR`, …) so animation can address parts without knowing the
skin.

### 3.4 Collision is untouched

The rig is **visual only**. The collision capsule remains `MOVEMENT.capsuleRadius` /
`MOVEMENT.standHeight` for every skin without exception, satisfying `ITEM_SHOP_SPEC §4.4`
(*"all outfits share one collision profile"*). A skin with a tall hat is not taller. This is
asserted by test, not merely stated.

## 4. Palette roles

A skin declares a **role map**, not a colour list. Roles let one feature builder paint
itself correctly across every skin.

| Role | Paints |
| --- | --- |
| `primary` | The dominant outfit mass — torso, upper legs |
| `secondary` | Supporting garment — sleeves, lower legs, hood lining |
| `accent` | The loud, small-area colour — stripes, glow, trim, laces |
| `skin` | Exposed skin — face, hands, neck |
| `hair` | Hair, fur, plumes |
| `detail` | Straps, buckles, boots, belts — the dark unifier |
| `visor` | Visors, goggles, lenses, eyes |

**Rule:** `accent` must occupy a small fraction of the silhouette. A skin whose accent is
also its primary has no accent.

## 5. Build archetypes

`build` sets the body proportions before features are applied. This is where silhouette
separation begins — two skins with different builds are distinguishable as shapes before a
single feature is added.

| Build | Character | Shoulder | Torso | Leg | Head |
| --- | --- | --- | --- | --- | --- |
| `lean` | Slight, quick | narrow | narrow, long | thin | standard |
| `athletic` | Default heroic | medium | medium | medium | standard |
| `heavy` | Armoured, imposing | broad | broad, short | thick | slightly small |
| `stout` | Mascot, comic | medium | short, round | short | oversized |

## 6. Silhouette features

Features are named, reusable builders. A skin lists the ones it wears. Each is a shape that
changes the **outline**, which is what makes skins readable — a decal never would.

| Feature | Silhouette change |
| --- | --- |
| `hood` | Raised cone-back over the head, shoulders squared |
| `helmet` | Hard shell above the brow line, flat crown |
| `visorBand` | Horizontal lens band across the eyes |
| `goggles` | Two lenses on a strap, sat on the brow |
| `ponytail` | Long mass swinging off the back of the skull |
| `longHair` | Broad mass down past the shoulders, asymmetric |
| `hairTuft` | Short upward tuft |
| `earPuffs` | Two round masses either side of the head (mascot) |
| `mascotHead` | Oversized round head that dominates the outline |
| `shoulderPads` | Rounded pads widening the shoulder line |
| `plateCarrier` | Boxy chest slab with a raised collar |
| `chestRig` | Pouch row across the chest |
| `scarf` | Neck mass with a trailing tail |
| `cape` | Hanging back panel |
| `hemSkirt` | Flared panel below the waist |
| `tatteredHem` | Ragged asymmetric hanging strips |
| `shinGuards` | Hard plates on the lower leg |
| `bracers` | Forearm cuffs |
| `backTank` | Cylindrical canister on the back |
| `spineFin` | Vertical fin running up the spine |
| `antenna` | Thin stalk with a tip bulb |
| `stitchSeams` | Contrast seam lines across torso and limbs |

### 6.1 Operator kit

The premium tier needs denser kit than a hood and a pair of bracers. These features are
what let an outfit read as *equipment* rather than as clothing.

| Feature | Silhouette change |
| --- | --- |
| `aviatorCap` | Leather skull cap with ear flaps down the jaw and a chin strap |
| `browGoggles` | Goggles pushed **up** onto the brow, leaving the face readable |
| `headWrap` | Soft cloth wrap, taller than a cap, knotted off to one side |
| `tankTop` | Sleeveless — repaints the arms as bare skin and adds a narrower vest |
| `fingerlessGloves` | Glove at the wrist and palm, skin below it |
| `thighRig` | Strapped thigh pouches, deliberately on one leg only |
| `kneePads` | Hard caps at the knee |
| `combatBoots` | Tall boots with a cuff and a raised sole |
| `utilityBelt` | Belt, buckle and a hip pouch at the waist line |
| `shoulderStrap` | One diagonal baldric across the chest, breaking the mirror |
| `neckWrap` | Thick neck wrap with a fold |
| `faceMarkings` | Painted brow flashes, cheek marks and a jaw line |
| `skullMask` | Face plate with deep sockets |
| `bonePattern` | Self-lit ribs, sternum, spine and limb bones |

A feature may **repaint** parts the base body placed, not only add to them. Some garments
are defined by what they remove — a tank top is bare arms, not an added sleeve — and
without repainting, a sleeveless outfit would need a second base body.

### 6.2 Self-lit parts

Any part may be marked `glow`. The 3D view gives it an emissive material; the 2D painter
draws a bloom behind it. This is a **material flag, not a rarity effect**: a common item
may use it and a legendary one need not. It never changes how visible a player is to
another player at gameplay distance.

Features compose: a skin is its build plus three to six features. **No two skins in the
roster may share the same (build, feature-set) pair** — asserted by test (§9).

## 7. The roster

Sixteen outfits. IDs are permanent — profiles store them (`ITEM_SHOP_SPEC §4.2`).

### 7.1 Founding eight

Carried over from the launch catalog, now rigged rather than recoloured.

| ID | Name | Rarity | Theme |
| --- | --- | --- | --- |
| `outfit_recruit` | Recruit | Common | Standard issue field gear |
| `outfit_drifter` | Drifter | Common | Long-road traveller |
| `outfit_signal` | Signal | Uncommon | High-visibility work crew |
| `outfit_tidewatch` | Tidewatch | Uncommon | Coastal patrol |
| `outfit_ironleaf` | Ironleaf | Rare | Forest plating (Wildline set) |
| `outfit_emberkin` | Emberkin | Rare | Banked-fire warmth |
| `outfit_nightvane` | Nightvane | Epic | Final-circle specialist |
| `outfit_aurelian` | Aurelian | Legendary | Gilded champion |

### 7.2 New eight

| ID | Name | Rarity | Theme | Silhouette hook |
| --- | --- | --- | --- | --- |
| `outfit_dunewake` | Dunewake | Common | Desert drifter | Wrapped scarf with a long trailing tail |
| `outfit_voltrun` | Voltrun | Uncommon | Sporty, bright | High ponytail, track-stripe legs |
| `outfit_bramblejack` | Bramblejack | Uncommon | Feral woodland scrapper | Hood with a spine fin |
| `outfit_greyline` | Greyline | Rare | Tactical urban | Helmet, plate carrier, shin guards |
| `outfit_rustward` | Rustward | Rare | Rugged scavenger | Hood, goggles, back tank, heavy build |
| `outfit_hexwilt` | Hexwilt | Epic | Spooky revenant | Long teal hair, tattered hem, stitch seams |
| `outfit_sprocket` | Sprocket | Epic | Fun mascot | Oversized round head, ear puffs, antenna |
| `outfit_paleaxis` | Pale Axis | Legendary | Sleek futurist | Full visor band, cape, lean plating |

**Hexwilt** is the brief's named request: teal hair, pink accents, a stitched patchwork
revenant. It is an original character — the theme (a cheerful undead in a stitched coat) is
a genre staple, and the specific design, name, palette and silhouette here are this
project's own.

### 7.3 The signature four

The premium tier: denser kit, stronger colour identity, more silhouette per figure. These
carry the shop. Each was designed from a mood brief as an **original character** built from
this project's own rig, palette roles and feature vocabulary.

| ID | Name | Rarity | Theme |
| --- | --- | --- | --- |
| `outfit_vexbloom` | Vexbloom | Epic | Neon revenant |
| `outfit_goldspar` | Goldspar | Legendary | Elite aviator |
| `outfit_voidmarrow` | Voidmarrow | Legendary | Glowing skeleton |
| `outfit_coalcrest` | Coalcrest | Epic | Gilded operator |

**Vexbloom** — hot pink skin against cyan cloth, two saturated hues at opposite ends of the
wheel with everything else pushed neutral so they stay the whole story. Head wrap, goggles
on the brow, sleeveless vest, painted face markings, utility belt. Lean frame.

**Goldspar** — matte black carries the mass; gold appears only at buckles, soles and trim,
which is what keeps it reading as expensive rather than as costume. Aviator cap, brow
goggles, sleeveless, fingerless gloves, thigh rig, combat boots. Lean frame.

**Voidmarrow** — a near-black base so the self-lit violet bones are the only thing the eye
lands on. Skull mask, bone pattern, thigh rig, knee pads, combat boots. Athletic frame.

**Coalcrest** — Goldspar's palette on a heavy frame: same colours, different mass, so the
two read as a matched set (`Gilded Vanguard`) without either looking like a recolour.
Helmet, neck wrap, sleeveless, shoulder strap, utility belt, knee pads.

### 7.4 Rarity distribution

| Rarity | Count |
| --- | --- |
| Common | 3 |
| Uncommon | 4 |
| Rare | 4 |
| Epic | 5 |
| Legendary | 4 |

Legendary stays the scarcest earned tier relative to the whole roster; the premium tier is
where the shop's appeal lives, so epic carries the most weight.

## 8. Rarity presentation

Rarity affects **presentation only** (`ITEM_SHOP_SPEC §4.3`) — never stats, never
silhouette, never size.

| Tier | Preview backdrop | Pedestal | Extra |
| --- | --- | --- | --- |
| Common | Flat dark wash | Plain disc | — |
| Uncommon | Soft radial in rarity hue | Plain disc | — |
| Rare | Radial + horizon band | Ringed disc | — |
| Epic | Radial + band + corner rays | Ringed disc | Slow shimmer sweep |
| Legendary | Full aura + rays | Double ring | Shimmer sweep + drifting motes |

The 3D in-match character receives **no** rarity effect. A legendary skin must not glow in
the world — it would be a gameplay tell and hand paying players an advantage, violating
`ITEM_SHOP_SPEC §4.4` in spirit if not in letter.

## 9. Required tests

1. Every skin in the roster produces a rig with at least one part in every body region.
2. No skin's rig exceeds the collision capsule's dimensions in a way that would imply a
   different hitbox — the capsule constants are identical for every equipped skin.
3. Every skin's (build, features) pair is unique.
4. Every skin declares all seven palette roles, with valid hex colours.
5. `accent` never paints more than a quarter of a rig's **non-glow** parts.

   > Amended in 1.1.0. The original rule counted every accent part, which a deliberate
   > glow pattern breaks by construction — Voidmarrow's ribs, spine and limb bones are
   > accent-coloured and are the entire design. The rule's intent is that a loud colour
   > must not sprawl across the base garment, and that still holds: glow parts are thin
   > strips over a dark base, and §9.10 checks that base is actually dark.

6. Rig construction is deterministic — the same skin yields an identical part list.
7. Every rarity tier in the roster is represented and matches the §7.3 distribution.
8. Every roster outfit is purchasable and equippable through the existing shop/locker path.
9. All rig dimensions scale with the build module: doubling `standHeight` doubles the rig.
10. A skin using `bonePattern` keeps a dark base — its `primary` luminance stays low
    enough that the glow reads against it.
11. Every harvesting tool builds a rig with a haft and a head, and no tool carries a
    gameplay field.

## 10. Where skins render

| Surface | Source | Notes |
| --- | --- | --- |
| Lobby | `CharacterPainter` via `CosmeticPreview` | Equipped outfit, full figure, rarity backdrop |
| Shop | `CharacterPainter` via `CosmeticPreview` | Selected item, rarity backdrop; cards use thumbnails |
| Locker | `CharacterPainter` via `CosmeticPreview` | Selected item, rarity backdrop |
| Match | `CharacterView` via `Renderer` | Equipped outfit on the third-person avatar |

## 11. Harvesting tools

A harvesting tool is a rig, exactly as a character is: data in, part list out, one 3D view
and one 2D painter consuming it. `cosmetics/ToolDefinitions.js` holds the roster,
`cosmetics/ToolRig.js` builds the parts.

### 11.1 Rig space and scale

Origin is the **grip** — the point the hand closes on — with `+Y` up the haft toward the
head and `+Z` the striking face. Anchoring at the grip rather than the butt means a long
tool and a short one both sit correctly in the same hand. Dimensions come from
`PICKAXE_VIEW` in Config, derived from the character, so a build-module retune rescales
tools with their wielder.

`PICKAXE_VIEW` is cosmetic only. Damage, reach and swing rate are `PICKAXE`, and are
**identical for every equipped tool** (`ITEM_SHOP_SPEC §4.4`).

### 11.2 Head forms

`wedge` (plain issue pick), `chisel` (flat quarry bit), `leaf` (tapered blade), `hook`
(curved sea hook), `split` (twin tine), `beam` (energy edge), `scrap` (welded plate).

### 11.3 Haft styles

`straight`, `wrapped` (grip wrap at the hand), `pipe` (salvaged tube with a cut collar).

### 11.4 Tool details

`bolts`, `binding`, `counterweight`, `spikes`, `rags`, `glowEdge`.

### 11.5 Scrapjaw

The signature tool, sitting beside the premium outfits. Epic.

- **Palette** — dark steel body (`#4a525c`), rust-red plate (`#a8412a`), worn bare metal at
  the edge (`#b9c2cc`), near-black haft (`#241b14`).
- **Silhouette** — deliberately asymmetric and layered: a plate bolted over a backing bar,
  a cutting edge that overhangs one side only, a counter-spike on the other, and a shim
  wedged behind. The asymmetry *is* the silhouette; a symmetrical scrap head just reads as
  a hammer.
- **Material** — pipe haft with a taped grip and a cut collar, cord lashing at the joint,
  welded spikes along the back, a hanging rag.
- **Flavour** — *"Four things that failed at their old jobs, welded into one that does not."*

### 11.6 Where tools render

Shop, locker and lobby previews paint the tool rig on the diagonal. In match, the tool is
parented to the character's right hand, read off the rig's own hand position so a heavy
frame's tool sits further out than a lean frame's.

## 12. Render fidelity

Flat fills read as placeholder art. One lighting model is applied to whatever any rig
emits — never per-item artwork, which is why adding a cosmetic never means drawing one.

| Technique | Why |
| --- | --- |
| Three-face shading — lit top, mid front, shaded lower edge | Stacked boxes stop reading as one flat slab |
| Lift-toward-white highlights instead of a flat multiply | A near-black outfit keeps its form instead of going to pure black on every face |
| Darkening with a floor | A black part never becomes a hole in the silhouette |
| Gradient across spheres and cylinders | Curvature, rather than discs and rectangles |
| Bloom behind self-lit parts | Glow reads as emission, not as bright paint |
| Two-layer contact shadow | Sits the figure on the ground instead of stickering it on |
| Dark stage pool behind the figure | A skin whose palette matches its rarity hue keeps its edges |

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-09-14 | Initial specification from the owner's skin-system brief: rig, palette roles, builds, features, sixteen-outfit roster, rarity presentation. |
| 1.1.0 | 2026-09-14 | Operator-kit features and self-lit parts (§6.1, §6.2); the signature four (§7.3); harvesting tools as rigs, with Scrapjaw (§11); render fidelity model (§12). Accent rule amended to count non-glow parts only (§9.5). |
