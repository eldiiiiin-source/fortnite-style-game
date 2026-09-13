# Time-to-kill table

Derived from `docs/MASTER_SPEC.md` §5.3 at **Common** rarity, point-blank (no falloff),
every shot connecting. `Shots` is the number of hits required; `Time` is
`(shots − 1) / fireRate` — the time from the first hit to the last, which is what a player
experiences in a duel.

Effective pool = `health + shield`, so 100 / 150 / 200 correspond to no shield, half
shield, and full shield.

## Body shots

| Weapon | Dmg | RPS | 100 pool | 150 pool | 200 pool |
| --- | --- | --- | --- | --- | --- |
| Assault Rifle | 30 | 5.50 | 4 — 0.55 s | 5 — 0.73 s | 7 — 1.09 s |
| SMG | 17 | 11.00 | 6 — 0.45 s | 9 — 0.73 s | 12 — 1.00 s |
| Pump Shotgun | 90 | 0.75 | 2 — 1.33 s | 2 — 1.33 s | 3 — 2.67 s |
| Tactical Shotgun | 60 | 1.60 | 2 — 0.63 s | 3 — 1.25 s | 4 — 1.88 s |
| Bolt Sniper | 105 | 0.55 | 1 — 0.00 s | 2 — 1.82 s | 2 — 1.82 s |
| Pistol | 24 | 6.75 | 5 — 0.59 s | 7 — 0.89 s | 9 — 1.19 s |
| Rocket Launcher | 100 | 0.60 | 1 — 0.00 s | 2 — reload-bound | 2 — reload-bound |

## Headshots

Head multiplier ×2.0, or ×1.5 for shotguns (§5.1).

| Weapon | Dmg | 100 pool | 150 pool | 200 pool |
| --- | --- | --- | --- | --- |
| Assault Rifle | 60 | 2 — 0.18 s | 3 — 0.36 s | 4 — 0.55 s |
| SMG | 34 | 3 — 0.18 s | 5 — 0.36 s | 6 — 0.45 s |
| Pump Shotgun | 135 | 1 — 0.00 s | 2 — 1.33 s | 2 — 1.33 s |
| Tactical Shotgun | 90 | 2 — 0.63 s | 2 — 0.63 s | 3 — 1.25 s |
| Bolt Sniper | 210 | 1 — 0.00 s | 1 — 0.00 s | **1 — 0.00 s** |
| Pistol | 48 | 3 — 0.30 s | 4 — 0.44 s | 5 — 0.59 s |

## Findings to resolve

1. **The bolt sniper one-shots a full-shield player to the head.** This is a deliberate
   genre convention but it is the single highest-variance number in the spec. If the map's
   long sightlines (`MAP_SPEC §5.1`, Grassland) prove too punishing, drop sniper damage to
   99 so a full-shield headshot leaves 2 HP.
2. **Pump shotgun cannot one-pump a full-shield body shot** (90 < 200), which is correct
   for the intended pace — fights last long enough for the loser to build.
3. **SMG is the fastest body-shot killer at every pool.** Verify this is intended given its
   35 m falloff start; if SMGs dominate close range too completely, raise `bloomPerShot`
   rather than cutting damage.
4. Shotgun rows assume **all ten pellets connect**, which only happens inside ~6 m. Expect
   real-world pump damage around 55 – 70 at typical box-fight range.

## How to regenerate

These numbers are asserted in `tests/combat.test.js`. If a weapon value changes in
`MASTER_SPEC §5.3`, the test fails until this table and `src/core/Config.js` agree.
