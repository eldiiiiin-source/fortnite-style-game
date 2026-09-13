# ADMIN PANEL / DEVELOPER TOOLS SPEC

| Field | Value |
| --- | --- |
| Status | **Authoritative — supplied by the project owner, 2026-09-13** |
| Version | 1.0.0 |
| Purpose | Testing, balancing, QA, debugging, rapid iteration, BR simulation, shop and profile testing |
| Companion | `docs/BATTLE_ROYALE_SPEC.md`, `docs/ITEM_SHOP_SPEC.md` |

> **Not a player feature.**

---

## 1. Primary rule — dev-only

**Admin tools must not appear in normal production gameplay.** Gating is explicit, via a
central runtime/build flag (`DEV_MODE`). Admin UI and commands **only initialise when
developer mode is enabled**.

**Not sufficient on their own:** hidden buttons, obscure shortcuts, CSS visibility,
client-side menu hiding.

### 1.1 Security model

Local-only persistence, no authoritative backend. The panel is for **local development**; it
is **not secure** against a user modifying local code, and must not pretend to provide
server-grade permissions. No authentication backend required yet. When a backend arrives,
**all authoritative admin actions move server-side**.

### 1.2 Access

| DEV_MODE | Behaviour |
| --- | --- |
| Enabled | **F8** (configurable) opens/closes the panel |
| Disabled | F8 does nothing; admin modules expose no gameplay actions; admin UI must not render |

Optional shortcuts: **F9** collision debug, **F10** AI debug, **F11** performance overlay —
all DEV_MODE-only, and none may conflict with gameplay binds by default.

### 1.3 No admin advantage in normal mode

With `DEV_MODE` false, every one of these is unavailable and **unreachable**: god mode,
infinite ammo, profile grants, shop rerolls, teleport, bot manipulation, storm manipulation,
debug visuals.

### 1.4 Dev mode indicator

A small persistent **DEV MODE** indicator, so test footage is never mistaken for normal
gameplay.

## 2. Architecture

```
Application
├─ AdminService
├─ ProfileManager
├─ ShopManager
├─ SceneManager
└─ Game / Match
```

**The UI calls `AdminService`, which delegates to the real systems.** The admin UI must
never directly mutate unrelated internal objects.

**The command console and the GUI call the same `AdminService` methods. Two logic paths are
forbidden.**

## 3. Panel UI

Left: category navigation. Centre: controls/values. Right: live debug information.
Categories: **PLAYER, INVENTORY, BUILDING, BOTS, MATCH, STORM, WORLD, PROFILE, SHOP,
PERFORMANCE, DEBUG.** Functionality over polish.

## 4. Player tools

Set health, set shield, heal to full, full health + shield, damage player, eliminate player,
revive/reset, toggle god mode, toggle infinite ammo, toggle infinite materials, toggle no
reload, toggle no cooldown where safe, movement speed multiplier, teleport to coordinates /
POI / map centre / storm centre, return to lobby.

### 4.1 God mode

Prevents normal combat damage, storm damage and elimination. **Must not permanently modify
health values.** Disabling restores standard damage behaviour immediately.

### 4.2 Infinite ammo

Firing does not reduce reserve ammo; reload remains testable; magazine behaviour may remain
normal. **NO RELOAD is a separate toggle** — the two are not permanently combined.

### 4.3 Infinite materials

Building consumes no wood/brick/metal. **The actual material inventory values remain
intact.** Disabling restores normal consumption.

## 5. Inventory tools

Give weapon, choose rarity, give ammo, give all ammo types, give healing item, clear
inventory, fill with test loadout, drop selected item, set materials, give max materials.

**Weapon selection uses the real weapon catalog. No admin-only weapon definitions.**

### 5.1 Test loadouts (data-driven)

| Preset | Contents |
| --- | --- |
| CLOSE RANGE | shotgun, SMG, healing |
| RIFLE TEST | assault rifle, pistol, healing |
| FULL TEST | AR, shotgun, SMG, sniper, healing |
| BUILD TEST | pickaxe, max materials, optional weapon |

## 6. Building tools

Clear all player builds, repair all, damage selected, destroy selected, reset selected edit,
force edit pattern, toggle build cost, toggle build health visualisation, toggle collision
visualisation, spawn wall/floor/ramp/cone.

**These use the actual building system — never bypassing normal geometry/collision
generation.**

### 6.1 Edit debugging

Visualise edit grid cells, selected cells, generated **visible** geometry, generated
**collider** geometry, target ray, edit range, piece ownership, piece coordinates.

> Important for diagnosing edit/collision mismatch. Note the current architecture makes such
> a mismatch structurally impossible — both derive from `PieceGeometry` — so this
> visualisation doubles as a proof of that invariant.

## 7. Bot tools

Spawn 1 / N bots, remove selected, remove all, eliminate all, freeze, resume, set difficulty,
teleport bots to player, teleport selected, force state, show state, show target, show
navigation path.

Quick counts: **+1, +5, +10, +25**, plus a numeric input. **Respect performance limits — warn
rather than silently crashing** on an unsafe count.

### 7.1 Difficulty

Tunable: reaction time, accuracy, aim error, target tracking, aggression, loot priority,
build frequency, heal threshold.

Presets: **EASY, NORMAL, HARD, DEBUG PERFECT.** `DEBUG PERFECT` is dev-only and may use
near-perfect aim for testing hit registration.

### 7.2 Forced states

`IDLE`, `LOOTING`, `ROTATING`, `COMBAT`, `HEALING`, `FLEEING_STORM`, `SEARCHING`.
**Invalid states must not be forced without a clear warning.**

## 8. Match tools

Start / restart / end match, return to lobby, force victory, force defeat, set remaining
player count (debug state only), eliminate all bots except one, skip drop phase, respawn
player in test mode, show match state, force match state only when safe.

### 8.1 Safety

**The panel must not corrupt the `MatchManager`.** Prefer real transition methods; do not
overwrite internal state except through an explicit debug-only safe override.

## 9. Storm tools

Start, pause, resume, advance phase, previous phase if safe, jump to final phase, disable /
enable storm damage, set damage multiplier, teleport player to safe zone, teleport into
storm, display current and next zone.

### 9.1 Visuals

Current safe zone, next safe zone, storm centre, storm radius, shrink path, phase timer,
damage rate.

## 10. World and loot tools

Teleport to POI / landmark, spawn loot, spawn chest, spawn ammo box, clear dropped loot,
clear world loot, respawn loot, toggle time-of-day if supported, toggle environment debug,
show navigation mesh/pathing, show collision geometry.

Loot spawning supports random loot, specific weapon, specific rarity, healing, ammo,
materials and chest bundles — **using the actual loot tables**.

## 11. Profile tools

Show current profile, grant / remove / set Credits, unlock cosmetic, unlock all, remove
ownership, equip cosmetic, reset locker equipment, reset profile, export profile JSON, import
profile JSON.

**Destructive actions require confirmation.**

### 11.1 Reset profile

Requires confirmation; restores default currency, starter cosmetics and default equipped
cosmetics; clears purchase history and lifetime stats. **Does not reset Settings unless
explicitly selected.**

## 12. Shop tools

Show active rotation ID, force new rotation, preview next rotation, set deterministic
rotation seed, show full catalog, mark item owned, test purchase, simulate insufficient
funds, reset shop test state.

Inspectable: featured items, daily items, category, rarity, price, owned state, rotation seed,
rotation period.

### 12.1 Cosmetic preview

Preview every outfit, pickaxe, glider, back accessory, wrap and emote **without purchasing**.
**Preview must not grant ownership.**

## 13. Performance panel

Live: FPS, frame time, average frame time, **p95 frame time**, current bot count, nearby bot
count, build count, world loot count, active particles, draw-call estimate, memory estimate,
active AI update rate.

### 13.1 Governor

Expose read-only or safe tuning for the existing `PerformanceGovernor`: current tier,
reducible systems, protected systems.

**The panel may never disable protected systems.** PROTECTED remains: input responsiveness,
building responsiveness, editing responsiveness, collision correctness, hit feedback.

## 14. Debug visualisation

Toggles: collision, player capsule, build grid, build coordinates, build collision, edit
collision, aim ray, weapon ray, interaction ray, bot perception radius, bot target, bot
navigation path, storm zones, loot spawn points, chest spawn points, POI bounds.

### 14.1 Aim debugging

Because shared targeting is a critical architecture rule, the **shared camera aim ray is shown
visually**, allowing comparison of camera origin, crosshair direction, hit point, weapon
muzzle position, final shot trajectory, build targeting hit and edit targeting hit — **all
derived from the shared targeting architecture**.

## 15. Event log

Lightweight, bounded history of recent events: `PLAYER_DAMAGED`, `PLAYER_ELIMINATED`,
`BOT_ELIMINATED`, `BUILD_PLACED`, `BUILD_EDITED`, `BUILD_DESTROYED`, `ITEM_PICKED_UP`,
`CHEST_OPENED`, `STORM_PHASE_CHANGED`, `MATCH_STATE_CHANGED`, `PURCHASE_COMPLETED`.

**Limit history to avoid memory growth.**

## 16. Command console (recommended)

```
give weapon assault_rifle legendary     tp poi <id>
give ammo all                            god
give materials 999                       nocost
spawn bot 10                             infiniteammo
kill bots                                credits 5000
storm next                               unlock all
storm final                              shop reroll
                                         match restart
```

**Commands call the same `AdminService` methods as the GUI.**

## 17. Safety and persistence

Destructive actions — reset profile, clear all builds, clear loot, remove all bots —
**require confirmation**.

**Temporary debug toggles reset on reload:** god mode, infinite ammo, no reload, infinite
materials, debug visuals, bot freeze, forced storm state.
**Profile changes made through admin tools may persist.**

## 18. Required tests

**Access:** unavailable when `DEV_MODE` false; available when true.
**Player:** god mode blocks damage; disabling restores it; infinite ammo prevents reserve
reduction; infinite materials prevents cost.
**Inventory:** give weapon uses the real catalog; clear works; preset loadout valid.
**Bots:** spawn, remove, freeze/resume, forced state validates.
**Match:** restart produces a clean match; force victory goes through `MatchManager`; return
to lobby works.
**Storm:** next phase; disable damage; re-enable damage; teleport to zone.
**Profile:** grant Credits persists; unlock persists; **preview does NOT grant ownership**;
reset restores defaults.
**Shop:** reroll changes rotation; insufficient-funds simulation does not corrupt currency;
purchase test uses the real purchase path.
**Debug:** aim ray uses the shared targeting system; collision visualisation reads actual
collision data; **performance panel cannot alter protected systems**.

## 19. Acceptance test

**With `DEV_MODE` enabled:** launch → F8 opens panel → grant Credits → unlock cosmetic →
equip → start BR → give weapon → infinite ammo → spawn bots → teleport to POI → force storm
next phase → show storm visualisation → damage player → god mode → verify damage blocked →
disable god mode → clear builds → spawn chest → inspect performance → force victory → return
to lobby → reload → persistent profile changes remain → temporary cheats disabled.

**With `DEV_MODE` disabled:** reload → **F8 must not open the panel** → admin actions
unreachable.

**Not complete until both the dev-on and dev-off paths work.**

## 20. Implementation order

1. Central `DEV_MODE` configuration
2. `AdminService`
3. Admin UI shell
4. Player tools
5. Inventory tools
6. Match tools
7. Storm tools
8. Bot tools
9. World / loot tools
10. Profile tools
11. Shop tools
12. Debug visualisation
13. Performance overlay
14. Command console
15. Integration tests
16. Production-mode access tests

## 21. Final standard

A developer should be able to reproduce combat situations, test loot, cosmetics and shop
purchases, manipulate the storm, spawn bots, inspect AI, collision, targeting and
performance, reset the match and force end states — **without rewriting code or editing
config files**.

**When developer mode is disabled, the admin system disappears from normal gameplay.**

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-09-13 | Initial authoritative specification from the project owner. |
