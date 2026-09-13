# ITEM SHOP / LOCKER / PROFILE SPEC

| Field | Value |
| --- | --- |
| Status | **Authoritative — supplied by the project owner, 2026-09-13** |
| Version | 1.0.0 |
| Covers | Player profile, virtual currency, cosmetic ownership, item shop, locker, equipping, local persistence, shop rotation |
| Companion | `docs/BATTLE_ROYALE_SPEC.md`, `docs/MASTER_SPEC.md` |
| Implementation | **Not started** — held until `ADMIN_PANEL_SPEC.md` arrives |

> **No real money.** No payment provider, no checkout, no external commerce, no backend in
> this phase. **All persistence is LOCAL ONLY**, via guarded localStorage or equivalent.

---

## 1. Primary goal

```
LAUNCH → PROFILE LOADS → LOBBY → ITEM SHOP → BROWSE → PURCHASE WITH VIRTUAL CURRENCY
→ OWNERSHIP SAVED → LOCKER → EQUIP → RETURN TO LOBBY
→ EQUIPPED COSMETICS APPEAR IN MATCH → RELOAD → OWNERSHIP AND EQUIPMENT REMAIN
```

## 2. Profile

A persistent `PlayerProfile` containing at minimum: profile version, display name, currency
balance, owned cosmetic IDs, equipped cosmetic IDs, purchase history, lifetime stats, and a
settings reference/version if useful.

**Temporary match state must never be mixed into persistent profile state.**

### 2.1 Local persistence

Guarded reads, guarded writes, schema version, default profile creation, migration support,
corruption fallback, **no crash if storage is unavailable**.

Malformed data: preserve what can safely be recovered, otherwise rebuild defaults.
**Never crash the game.**

> Integration note: `core/Settings.js` already implements exactly this contract — guarded
> `getItem`/`setItem`, merge-only-known-keys, defaults on corruption — and is covered by
> tests. `ProfileManager` follows the same pattern under its own storage key, so
> settings and profile cannot clobber each other.

### 2.2 Default profile

On first launch: create a local profile, grant starter currency, grant starter cosmetics,
equip defaults.

| Parameter | Value |
| --- | --- |
| Starter currency | **5,000 Credits** |

### 2.3 Versioning

The schema carries a `version` (starting at `1`). Future changes **migrate** rather than
break existing profiles.

## 3. Virtual currency

**CREDITS.** Original name — **not V-Bucks**, no real-money value.

Rules: integer only; **no negative balances**; purchases subtract; admin tools may grant;
**normal UI cannot create currency**; balance persists across reloads.

## 4. Cosmetics

### 4.1 Categories

Required: **OUTFIT, PICKAXE, GLIDER, BACK ACCESSORY, EMOTE, WRAP.**
Optional later: contrail, loading screen, lobby music, banner.

**All cosmetics original.** No Fortnite characters, names, logos, models or copyrighted
assets.

### 4.2 Data model

Unique ID, display name, category, rarity, price, description, preview asset, gameplay asset
reference, owned state (derived from profile), shop eligibility, enabled/disabled state.
Optional: release date, tags, collection/set, creator metadata.

**Defined in a centralised, data-driven catalog. Shop items must never be hard-coded inside
UI components.**

### 4.3 Rarities

COMMON, UNCOMMON, RARE, EPIC, LEGENDARY. **Rarity affects visual presentation only.**

### 4.4 No pay-to-win — hard invariant

Cosmetics must not modify health, shield, movement speed, damage, hitbox, building, editing,
weapon stats or bot behaviour. **Visual only.**

| Cosmetic | May change | Must NOT change |
| --- | --- | --- |
| Outfit | Visual model/appearance | Collision, hitbox — **all outfits share one collision profile** |
| Pickaxe | Model, material, animation styling, sound styling | Damage, swing speed, range, harvesting rules |
| Glider | Visuals | Glide speed, descent rate, steering, deployment altitude |
| Wrap | Visual materials on weapons (vehicles later) | Anything |

> This is directly testable, and will be asserted as an invariant: equipping any cosmetic
> must leave `MOVEMENT`, `PICKAXE`, `WEAPONS` and the capsule dimensions byte-identical.
> Those config groups are already `Object.freeze`d, so a cosmetic *cannot* mutate them
> without throwing — the test proves the path is never attempted.

## 5. Item Shop

A **real** shop screen: featured section, daily section, currency balance, item cards,
cosmetic preview, rarity indication, price, purchase button, owned state, equipped state
where relevant.

**Not a fake static shop — purchases must affect profile state.**

### 5.1 Rotation

Deterministic, derived from a current date/time bucket plus seeded selection, so the shop is
**stable across reloads within the same rotation**. No backend.

| Parameter | Value |
| --- | --- |
| Rotation period | **24 hours** |
| Featured | **4 cosmetics** |
| Daily | **6 cosmetics** |

A category mix is required — **not only outfits**.

### 5.2 Rotation rules

Prefer: no duplicate cosmetic within a rotation; no excessive repetition between adjacent
rotations; variety of categories and rarities.

Owned items may still appear. When owned: show **OWNED**, disable purchase, allow preview,
allow equip where appropriate.

### 5.3 Purchase flow

1. select cosmetic → 2. show details → 3. purchase pressed → 4. validate item exists →
5. validate purchasable → 6. validate not already owned → 7. validate sufficient currency →
8. subtract currency → 9. grant ownership → 10. append purchase history →
11. persist profile → 12. update UI immediately.

**Atomic from the UI's perspective. Currency must not be subtracted if the ownership grant
fails.**

### 5.4 Insufficient funds

Purchase fails; currency unchanged; ownership unchanged; clear feedback. **No negative
balance.**

### 5.5 Purchase history

Cosmetic ID, price paid, timestamp, shop rotation ID. Local.

### 5.6 Shop UI states

loading, available, owned, equipped, insufficient funds, purchase success, purchase failure.

## 6. Locker

Category navigation, cosmetic grid, preview area, rarity, name, description, equip button,
owned-only filtering.

**Shows OWNED cosmetics. Unowned items must never appear equipable.**

### 6.1 Equipment slots

outfit, pickaxe, glider, back accessory, emote selection, wrap — each storing a cosmetic ID.

### 6.2 Equip flow

1. select owned cosmetic → 2. validate ownership → 3. update slot → 4. persist profile →
5. update preview → 6. lobby preview updates → 7. next match uses it.

**Unowned cosmetics cannot be equipped.**

### 6.3 Emotes

Initial system may be simple: ownership, equipped slots, trigger in lobby, optionally in
match when not in combat. **Placeholders are acceptable rather than blocking core work on
complex animation.**

## 7. Preview system

Shop and Locker both preview. 3D cosmetics: rotate, zoom if practical, neutral lighting.
Emotes: play preview animation if available. Wraps: preview on a sample weapon.

## 8. Integration

### 8.1 Lobby

Shows equipped outfit, back accessory, pickaxe preview where appropriate, currency balance,
and PLAY / LOCKER / ITEM SHOP / SETTINGS. **Visual state updates immediately after equip or
purchase.**

### 8.2 Match

On match start, load equipped outfit, pickaxe, glider, wrap and back accessory. Cosmetics are
**read from the profile once and passed cleanly into match setup**.

**`Game` must not own profile persistence.**

### 8.3 Architecture

```
Application
├─ ProfileManager
├─ ShopManager
├─ SceneManager
│
├─ LobbyScene
├─ ShopScene
├─ LockerScene
├─ MatchScene
└─ ResultsScene
```

`Game` remains the gameplay simulation. `ProfileManager` persists above it.

**ProfileManager** — load, validate schema, migrate, save, grant cosmetic, spend currency,
grant currency, equip cosmetic, query ownership.

**ShopManager** — generate rotation, expose active items, validate purchases, return rotation
ID. **Never directly mutates rendering.**

## 9. Catalog

### 9.1 Starter cosmetics (owned on first launch)

Minimum 2 outfits, 2 pickaxes, 2 gliders, 1 back accessory, 2 emotes, 2 wraps. One default
from each gameplay-visible category is owned initially.

### 9.2 Catalog target

| Category | Count |
| --- | --- |
| Outfits | 8 |
| Pickaxes | 6 |
| Gliders | 6 |
| Back accessories | 5 |
| Emotes | 8 |
| Wraps | 6 |
| **Total** | **≥ 39** |

Placeholder models are acceptable during development provided IDs are stable and categories,
previews, purchases and equipping all work.

### 9.3 Pricing bands (tunable, centralised)

| Rarity | Credits |
| --- | --- |
| Common | 300 – 500 |
| Uncommon | 500 – 800 |
| Rare | 800 – 1,200 |
| Epic | 1,200 – 1,800 |
| Legendary | 1,800 – 2,500 |

## 10. Lifetime stats

Persist: matches played, wins, eliminations, top-5 finishes, total damage, total survival
time. Battle Royale results update these after a match.

## 11. Match rewards (configurable)

| Event | Credits |
| --- | --- |
| Match completion | +50 |
| Elimination | +10 |
| Victory | +150 bonus |

**Not inflation-heavy.** Admin tools may disable rewards during testing.

## 12. Profile reset

Developer/admin tools may reset the local profile. **Normal player UI must not expose
destructive reset casually.**

## 13. Security reality

Local-only persistence. **Do not pretend localStorage is secure.** Its purpose is
functionality, testing, persistence and architecture — **not anti-cheat**. When a backend
exists, authoritative currency and ownership move server-side.

## 14. Required tests

**Profile:** first launch creates profile; reload loads it; malformed profile falls back
safely; migration works; currency cannot go negative.
**Purchase:** valid purchase succeeds; currency subtracts exactly once; ownership persists;
duplicate purchase rejected; insufficient funds rejected; history records.
**Shop:** deterministic rotation; rotation stable within a period; no duplicate item in a
rotation; owned item shows owned state.
**Locker:** owned cosmetic equips; unowned cannot; equipped state persists; outfit does not
alter gameplay collision; pickaxe cosmetic does not change stats; glider cosmetic does not
change movement values.
**Integration:** buy outfit → equip → return to lobby → start match → player uses it →
reload app → still owned and equipped.

## 15. Acceptance test

**Not complete until this works:**

1. launch → 2. profile loads → 3. lobby → 4. open shop → 5. inspect cosmetic →
6. purchase → 7. currency decreases → 8. shows owned → 9. open locker → 10. equip →
11. lobby preview updates → 12. start battle royale → 13. cosmetic appears in match →
14. finish/leave match → 15. return to lobby → 16. reload application →
17. still owned → 18. still equipped → 19. currency balance persists.

## 16. Implementation order

1. ProfileManager
2. Cosmetic catalog
3. Persistent profile
4. ShopManager
5. Rotation system
6. Purchase system
7. Locker
8. Equip system
9. Lobby cosmetic preview
10. Match cosmetic integration
11. Lifetime stats
12. Match rewards
13. Full tests

## 17. Final standard

The shop must be **functional, not decorative**. The locker must be **functional, not
decorative**. Purchases persist. Ownership persists. Equipped cosmetics actually appear in
the lobby and in matches. **No cosmetic may affect gameplay stats.**

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-09-13 | Initial authoritative specification from the project owner. |
