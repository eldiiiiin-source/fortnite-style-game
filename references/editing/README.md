# references/editing/

Reference material behind `docs/MASTER_SPEC.md` §7.

## What belongs here

- Edit-grid pattern diagrams (3×3 selections → resulting geometry) for each piece type
- Edit-flow timing traces: input → preview → confirm, measured in ms
- Edit-course designs used to benchmark the flow
- Notes on which selections must be rejected and why

## Index

| File | What it is | Spec section |
| --- | --- | --- |
| `01-edit-patterns.md` | Every valid 3×3 selection per piece type, as ASCII diagrams | §7.3 – §7.6 |

## Open questions

- Should enemy pieces be editable at all? Currently out of scope (§7.2).
- Reset-on-`R` while mid-drag: does it clear the selection or revert the piece? Spec says
  clears the selection; confirm this matches the muscle memory we want.
