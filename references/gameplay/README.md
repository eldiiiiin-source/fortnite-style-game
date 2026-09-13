# references/gameplay/

Reference material behind `docs/MASTER_SPEC.md` §3 (player), §5 (combat), §8 (loot), §9 (match flow).

## What belongs here

- Movement feel notes: jump arcs, acceleration curves, comparison videos/notes
- TTK tables: shots-to-kill at each shield/health state, per weapon, per rarity
- Spread and recoil studies
- Loot-economy simulations: expected items per player at each storm phase
- Playtest notes, dated, with the build they were taken against

## Index

| File | What it is | Spec section |
| --- | --- | --- |
| `01-ttk-table.md` | Shots-to-kill for every weapon class at 0/50/100 shield | §5.3 |

## Open questions

- Is the 22 m/s² gravity + 7.4 m/s jump the right arc for ramp-rushing? Measure whether a
  player can jump-place a ramp and land on it reliably.
- Pump shotgun at 9×10 = 90 max body damage — should a full-shield player survive one pump?
  Current answer: yes (90 < 200). Confirm this is intended.
