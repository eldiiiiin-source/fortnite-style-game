# BATTLE ROYALE SPEC — Match Loop

| Field | Value |
| --- | --- |
| Status | **Authoritative — supplied by the project owner, 2026-09-13** |
| Version | 1.0.0 |
| Companion | `docs/MASTER_SPEC.md`, `docs/MAP_SPEC.md` |
| Implementation | **Not started** — held until `ITEM_SHOP_SPEC.md` and `ADMIN_PANEL_SPEC.md` arrive |

> **Precedence.** This spec must integrate with the stable gameplay foundation without
> regressing movement, camera, building, editing, edited collision, combat, inventory,
> loot or performance. **If a battle royale feature conflicts with an existing core
> gameplay acceptance gate, CORE GAMEPLAY WINS.**

---

## 1. Primary goal

A complete, locally playable loop, no multiplayer:

```
MAIN MENU → PLAY → MATCH PREPARATION → DROP PHASE → LAND → LOOT → FIGHT
→ STORM SHRINKS → BOTS ROTATE AND FIGHT → FINAL SURVIVOR
→ VICTORY OR DEFEAT → RETURN TO LOBBY
```

Bots populate matches.

## 2. Match state machine

One authoritative `MatchManager`. **Match-state checks must not be scattered through
unrelated systems.** Transitions are deterministic.

States: `LOBBY`, `QUEUEING`, `PRE_MATCH`, `DROP_PHASE`, `ACTIVE_MATCH`, `ENDGAME`,
`VICTORY`, `DEFEAT`, `POST_MATCH`, `RETURNING_TO_LOBBY`.

## 3. Participants

| Parameter | Value |
| --- | --- |
| Human players | 1 |
| Bots | 24 |
| Total participants | **25** |
| Configurable | Yes |
| Later target | up to 50 bots locally, if performance allows |

**Do not target 100 participants.** Performance and gameplay quality beat raw bot count.

## 4. Pre-match

Initialise match seed and storm seed; spawn bots; reset player; clear previous match state
and temporary loot; reset eliminations, inventory, materials, health and shield; initialise
the match timer; prepare the drop route.

A pre-game waiting island is **out of scope** for now.

## 5. Drop system

An **original** transport vehicle. **No Battle Bus model, no Fortnite branding.**

The transport travels across the playable map on a randomised route, is visibly moving,
allows the player and bots to exit, and has a finite route duration.

### 5.1 Drop route

A line across the playable region: begins outside one edge, crosses the region, exits the
opposite edge. Entry side, exit side and direction are randomised. **Routes that barely
clip the map are invalid.**

### 5.2 Player exit and freefall

The player may jump during the valid drop window, entering `FREEFALL`, which supports
forward steering, lateral steering, camera control, descent and limited air control.

### 5.3 Glider

Original glider, no Fortnite assets. Deploys manually above a minimum altitude, auto-deploys
below a safe altitude, slows vertical descent, moves forward, steers, transitions smoothly
to landing, and **closes automatically on landing**.

### 5.4 Bot drop behaviour

Bots choose landing destinations weighted by POIs, landmarks, loot density, distance from
the route, and nearby bot density. **Bots must not all land in one place.** Some locations
naturally become contested.

## 6. Spawning

All participants start with: full health, **0 shield** (unless a mode changes it), **empty
inventory**, pickaxe available, and configurable starting materials (**default 0**).
Weapons and healing must be looted.

## 7. Loot

Uses the existing loot system. Floor loot, chests and ammo boxes are populated **before**
the active match begins, with deterministic seeded RNG for repeatable testing.

**Density:** POIs hold significantly more than countryside; landmarks hold some; open
countryside holds relatively little. **High-value loot is not scattered everywhere.**

## 8. Storm

**Rebuilt from scratch. The deleted baseline `Storm.js` assumptions must NOT be restored.**
Phases are **data-driven** and centralised; storm geometry must not be hard-coded into
unrelated systems.

Structure: current safe zone, next safe zone, shrinking transition, storm damage, phase
timer. **The next safe zone always remains within the current one.** Zone generation uses
deterministic RNG.

### 8.1 Initial safe zone

| Parameter | Value |
| --- | --- |
| Initial safe radius | **460 m**, for an ~1024 m playable region |
| Scaling rule | **Must scale from map size if the region changes** |

Stored as the ratio `460 / 1024 = 0.4492` of the region extent, so the rule is satisfied by
construction rather than by remembering to update a constant. See §14.1.

### 8.2 Phases

| Phase | Wait (s) | Shrink (s) | Target radius (m) | Damage (HP/s) |
| --- | --- | --- | --- | --- |
| 0 — Grace | 90 | 0 | 460 | 0 |
| 1 | 120 | 90 | 330 | 1 |
| 2 | 90 | 75 | 230 | 1 |
| 3 | 75 | 60 | 150 | 2 |
| 4 | 60 | 50 | 95 | 2 |
| 5 | 45 | 40 | 55 | 5 |
| 6 | 30 | 30 | 30 | 8 |
| 7 | 20 | 25 | 12 | 10 |
| Final | 10 | 20 | 0 | 15 |

Radii are stored as ratios of the initial radius (§14.1) so §8.1's scaling rule holds
through every phase.

### 8.3 Storm damage

**Bypasses shield by default**, applying directly to health. Applied no more often than
necessary, via reliable time accumulation. **Never frame-rate dependent.**

### 8.4 Visualisation

Required: visible storm wall, safe zone visibility, next-zone indicator on map/minimap,
storm warning UI, countdown timer. **Colour grading alone is not sufficient.**

### 8.5 Audio

Storm ambience, closing warning, damage cue, phase change cue. Original/generated only.

### 8.6 Events

Preserve `STORM_PHASE_CHANGED`. Add: `STORM_STARTED`, `STORM_SHRINK_STARTED`,
`STORM_SHRINK_ENDED`, `PLAYER_ENTERED_STORM`, `PLAYER_LEFT_STORM`.

## 9. Bots

Bots must support landing, looting, equipping, navigating, detecting enemies, shooting,
healing, rotating to the safe zone, avoiding storm, fighting other bots, fighting the human,
dying and dropping inventory.

**Bots use the real gameplay systems. No separate fake combat rules.**

### 9.1 States

`DROPPING`, `LANDING`, `LOOTING`, `ROTATING`, `PATROLLING`, `COMBAT`, `HEALING`,
`FLEEING_STORM`, `SEARCHING`, `ELIMINATED`. **Not all bots constantly attack.**

### 9.2 Perception

Distance, line of sight, recent damage, and nearby gunfire where audio awareness exists.
**No omniscience.**

### 9.3 Aim

Configurable quality. **No perfect hitscan.** Aim delay, tracking error, reaction time,
accuracy variance. Difficulty levels later if desired.

### 9.4 Weapon selection

By range — close: shotgun/SMG; medium: assault rifle; long: sniper/rifle.
**Must not switch weapons every frame.**

### 9.5 Looting

Seek nearby weapons, pick up ammo and healing, fill empty slots, prefer higher rarity where
sensible. Perfect inventory optimisation is not required.

### 9.6 Healing

Heal when damaged, not under immediate attack, and holding an item. **Cancel when
threatened.**

### 9.7 Storm rotation

Know the next safe zone, estimate travel time, begin rotating **before** the storm reaches
them, prioritise escape when outside. **Bots must not repeatedly die to the storm.**

### 9.8 Building

**Limited initially:** a wall under fire, an occasional ramp for height, a basic box when
low. **No advanced editing or triple edits yet.** Must not compromise performance.

### 9.9 Navigation

Navigate terrain, roads, bridges, buildings, stairs, ramps and simple player builds. Avoid
deep invalid water routes, impossible cliffs and blocked interiors. Use a navigation
abstraction compatible with future larger maps.

### 9.10 Bot versus bot combat

**Required.** The world must keep evolving even if the human does nothing: bots encounter,
damage, eliminate and loot each other.

## 10. Elimination

On reaching zero health: mark eliminated, stop input/AI, increment the killer's count, drop
inventory, ammo and materials, update player count and kill feed, remove or disable the
participant.

**Do not immediately delete state needed for post-match statistics.**

Human and bots share **one participant registry**; the HUD's remaining count reads from it.

## 11. Win condition

The match ends when **one participant remains alive**. Human last → `VICTORY`. Human
eliminated while another remains → `DEFEAT`. **The simulation must not end while multiple
bots remain.**

### 11.1 Post-elimination

Initial version: show `DEFEAT`, optionally brief spectate, allow return to lobby. Full
spectator mode and bot cycling are later.

### 11.2 Result screens

**Victory:** clear victory message, eliminations, survival time, damage dealt, placement 1,
return-to-lobby button. **Original branding — not Fortnite's Victory Royale wording.**

**Defeat:** placement, eliminations, survival time, damage dealt, eliminated-by if known,
return-to-lobby button.

## 12. Match statistics

Eliminations, damage dealt, damage taken, shots fired, shots hit, survival time, placement,
materials gathered, healing used. Local for now.

## 13. Match reset

Starting a new match fully resets: player state, bot state, loot, storm, dropped items,
structures, eliminations, timers, match stats, temporary audio, temporary UI, projectiles.

**No state may leak between matches.**

## 14. Scene / screen layer

`Game` currently *is* the match. A new layer sits above it:

```
Application
  ├─ SceneManager
  │   ├─ LobbyScene
  │   ├─ MatchScene
  │   └─ ResultsScene
  └─ persistent profile / settings state
```

**Lobby logic must not be forced into `Game`.** `Game` remains the active gameplay
simulation.

### 14.1 Integration note — storm radius and region size

The owner's 460 m initial radius is quoted "for the current approximately 1024 m playable
region". `WORLD.regionExtent` is 1024 m, but `TestEnvironment` currently spans **409.6 m**
(`halfExtent` = `TILE × 40` = 204.8 m). A 460 m *radius* therefore does not fit the terrain
that exists today.

Resolution, per §8.1's explicit scaling rule:

- Storm radii are stored as **ratios**: initial = `0.4492 × regionExtent`, and each phase as
  a fraction of the initial radius.
- `TestEnvironment` grows to the full `WORLD.regionExtent` of 1024 m. This is **not** island
  expansion — 1024 m is the approved first region in `MAP_SPEC §12.2`, and the island itself
  stays unbuilt.

## 15. Lobby

PLAY button, LOCKER navigation, ITEM SHOP navigation, SETTINGS navigation, player cosmetic
preview, currency display, selected game mode. Battle Royale is the only required mode.

**PLAY must start a real match** — transition to setup, create match state, load the region,
spawn bots, populate loot, prepare the storm, begin the drop. **No fake button.**

## 16. Minimap and map

**Minimap:** player position, orientation, safe zone, next zone, basic terrain
representation. POI names, markers and teammate icons are later.

**Map screen:** current location, storm circle, next storm circle, major POIs, map bounds.

## 17. Performance

**Stable 60 FPS remains mandatory.** Bots and storm logic must not cause per-frame spikes.
Use staggered AI updates, spatial queries, cached navigation and reduced distant AI detail.
**Do not lower gameplay simulation responsiveness.**

### 17.1 Bot budget

| Distance | Update |
| --- | --- |
| Near player | Full AI rate |
| Medium | Reduced decision rate |
| Far | Low-frequency strategic simulation |

**Distant bots must not be frozen completely.**

## 18. Determinism

Seeded RNG for storm centres, drop route, bot landing choices and loot population. Tests
must be reproducible.

## 19. Required tests

**Match state:** lobby → match; drop → active; active → victory; active → defeat; return to
lobby.
**Drop:** route crosses map; player can jump; bots jump; glider auto-deploys; landing
transitions correctly.
**Storm:** circles stay within previous circles; radius shrinks correctly; damage matches
phase; shield bypass works; phase events fire; final circle reaches zero.
**Bots:** lands; finds loot; equips weapon; attacks player; attacks bot; heals; rotates to
zone; avoids storm; dies and drops loot.
**Match end:** last participant wins; human victory triggers; human defeat triggers;
placement calculation correct.
**Reset:** second match starts clean; no previous storm, builds or loot survive.

## 20. First playable acceptance test

**Battle Royale is not complete until this entire sequence works:**

1. launch game → 2. arrive at lobby → 3. press PLAY → 4. enter drop phase → 5. jump →
6. deploy glider → 7. land → 8. collect weapon → 9. collect ammo → 10. fight bot →
11. eliminate bot → 12. loot dropped items → 13. build → 14. edit → 15. survive storm
movement → 16. encounter rotating bots → 17. reach final circle → 18. eliminate final
opponent or lose → 19. see result screen → 20. return to lobby → 21. start another match
successfully.

## 21. Persistence and networking

Match state is **not** persistent; reloading mid-match may restart it. Persistent profile
data belongs to the Item Shop / Locker spec.

**Networking is not required.** Do not design around fake multiplayer, but keep the
architecture modular enough to add it later.

## 22. Implementation order

1. Scene / application layer
2. Match state machine
3. Match reset
4. Drop route
5. Freefall
6. Glider
7. Storm
8. Bot landing
9. Bot looting
10. Bot combat vs bots
11. Bot storm rotation
12. Elimination registry
13. Win condition
14. Results screen
15. Minimap / map
16. Performance pass
17. Full integration tests

## 23. Final standard

> "The result must feel like an actual Battle Royale match, not a sandbox with bots."

A player must enter from the lobby, drop onto the island, loot, fight, build, edit, survive
the storm, fight bots that are independently playing the match, win or lose, and return to
the lobby. **Not complete before that full loop works.**

---

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-09-13 | Initial authoritative specification from the project owner. |
