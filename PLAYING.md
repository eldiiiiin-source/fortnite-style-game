# Playing Alpha 0.1

How to run this build on your own machine. Written for Windows; the commands are the same
on macOS and Linux.

This is an **alpha**. It is a complete match loop — drop, loot, fight, build, storm, win or
lose, back to the lobby — but it is rough in the places listed under
[Known issues](#known-issues-in-alpha-01).

---

## Install

You need **Node.js 20 LTS or 22 LTS**. Node 18 is the oldest version the build tools accept;
anything older will fail. Download it from <https://nodejs.org> — take the **LTS** installer
and accept the defaults.

Check it worked by opening **Windows Terminal** (or PowerShell) and running:

```powershell
node -v
npm -v
```

`node -v` should print `v20.x.x` or `v22.x.x`.

Then get the code and install its dependencies:

```powershell
cd $HOME\Documents
git clone https://github.com/eldiiiiin-source/fortnite-style-game.git
cd fortnite-style-game
npm install
```

`npm install` takes a few seconds and prints some `npm audit` warnings. Those are in the
build tooling (Vite, Vitest), not in the game, and do not affect playing it.

**No Git?** Install it from <https://git-scm.com/download/win>, or download the repository as
a ZIP from GitHub (green **Code** button → **Download ZIP**), unzip it, and `cd` into the
unzipped folder instead of cloning.

---

## Launch

```powershell
npm run dev
```

Then open **<http://localhost:5173>** in your browser.

- **To stop the server:** press `Ctrl + C` in the terminal window running it.
- **To start it again later:** `cd` back into the folder and run `npm run dev` again. You
  only ever run `npm install` once, unless dependencies change.

Chrome or Edge are the safest choices. The game needs WebGL, which any current browser has.

Click into the game window once so it captures your mouse. Press `Esc` to release it.

---

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Sprint | `Left Shift` (hold) |
| Crouch | `Left Ctrl` |
| Interact — open chests, pick loot up | `E` |
| Fire | `Left Mouse` |
| Aim down sights | `Right Mouse` (hold) |
| Reload | `R` |
| Weapon slots 1–5 | `1` `2` `3` `4` `5` |
| Harvesting tool (pickaxe) | `1` |
| Build — wall | `Q` |
| Build — floor | `F` |
| Build — ramp | `C` |
| Build — cone | `V` |
| Edit a piece | `G` |
| Confirm edit | `Left Mouse` |
| Reset edit selection | `Mouse Wheel Down` |
| Map | `M` |
| Inventory | `Tab` |
| Settings | `Esc` |
| Admin panel (dev mode only) | `F8` |

**`1` is shared** between the pickaxe and your first weapon slot, and toggles between them.
Every binding is editable under **Settings**.

Two gameplay settings worth knowing, both under **Settings**:

- **Confirm edit on release** (on by default) — releasing the edit key confirms the edit.
- **Build immediately** (on by default) — choosing a build piece enters build mode at once.

---

## Dev mode

Dev mode is **on automatically** when you run `npm run dev`, and **off** in a production
build. There is a red `DEV MODE` badge at the top of the screen when it is on.

With it on, `F8` opens the admin panel: teleport, give weapons and materials, spawn loot,
control the storm, control bots, toggle god mode.

**To play without it** — no badge, no admin panel, no cheats:

```powershell
npm run build
npm run preview
```

That serves the production build, usually on <http://localhost:4173> (the terminal prints the
exact address). This is the honest way to judge how the game actually feels.

You can also force it either way from the browser console before the page loads, which is
mostly useful for testing:

```js
globalThis.__FORCE_DEV_MODE__ = false;   // or true
```

---

## Known issues in Alpha 0.1

Nothing here blocks a complete match. All of it is known and none of it is a surprise.

**Gameplay**

- **Mantling triggers on rolling terrain.** Small natural rises can put you into a mantle,
  which roughly halves your speed for a moment. Noticeable on some hillsides; flat ground and
  roads are unaffected.
- **You can glide into the open sea.** It is survivable — you swim — but it is a long way
  back to land, and there is no warning while you are still gliding.
- **Bots are competent but not clever.** They fight each other, loot, and rotate for the
  storm, but they will not out-think you.

**Presentation**

- Interiors are deliberately dim. They are lit enough to fight in, not enough to sightsee.
- The visual swing of the harvesting tool is snappy — the strike lands about 55 ms after the
  damage does, so the wind-up is only a frame or two at 60 fps.

**Not bugs, but worth knowing**

- Your profile, credits and unlocked cosmetics are stored in your browser's local storage.
  Clearing site data for `localhost` resets them.
- Aiming is over-the-shoulder: the crosshair, not the middle of your character, is where
  shots go.

---

## If something goes wrong

- **`npm` is not recognised** — Node.js is not installed, or the terminal was open before you
  installed it. Close the terminal, open a new one, try again.
- **Port 5173 already in use** — another copy of the server is still running. Close the other
  terminal, or run `npm run dev -- --port 5174` and open that port instead.
- **Black screen** — check the browser console (`F12`). WebGL may be disabled or unavailable
  in that browser.
- **Nothing responds to the keyboard** — click once inside the game window first.

---

## For developers

```powershell
npm test        # unit tests
npm run lint    # ESLint
npm run build   # production build to dist/
npm run preview # serve that build
```

`docs/MASTER_SPEC.md` and `docs/MAP_SPEC.md` are the source of truth for gameplay and the
world. `CLAUDE.md` describes the working rules for this repository.
