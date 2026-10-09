# Map editor (local only)

A top-down editor for the map, built from the game's own layout code. It runs only on your computer through the
dev server and is never built or deployed. Moves are saved to `multiplayer/shared/map-layout.json`, which the game
reads; an empty file means everything stays where the code puts it.

## Run it on your PC

Open a terminal (PowerShell is fine) in your `branns-forge-vr` folder, then paste these one at a time:

1. `git fetch origin`
2. `git checkout main` then `git pull` (before this is merged, use `git checkout claude/map-editor-v47m7h` instead)
3. `cd multiplayer`
4. `npm install` (first time only, or after a pull that changed packages)
5. `npm run map`

Your browser opens the editor. Leave the terminal open while you edit; press Ctrl+C in it when you're done.

## Using it

- Drag anything to move it. Drag empty ground to pan, scroll (or pinch) to zoom, F fits the whole map.
- Keep and back-town pieces are mirrored: moving Dawnhold's tavern moves Grumblekeep's the same way, so the two
  sides stay fair.
- Turn a building with its round orange handle, Q / E (15°, hold Shift for 1°), or Shift+scroll.
- Arrow keys nudge 10 cm (Shift: 1 m). Dragging snaps to 25 cm and turning to 7.5°; hold Alt to place freely.
- Red means two things overlap; orange means a spot that's too steep or off the map. Click a problem to jump to it.
- Undo / Redo (Ctrl+Z / Ctrl+Shift+Z). Unsaved moves survive a page refresh.
- **Save** (Ctrl+S) writes the layout into the game. **Play-test** opens the game on your PC with it; start a
  new world, because saved worlds keep their old ore spots.

## Handing it back to Claude

Press **Copy layout** and paste it in the project thread. Claude checks it, does a final pass (tidying spots,
paths and anything the editor can't move yet) and opens a pull request.

## On your phone

Run `npm run map:phone` instead of step 5. The terminal prints a `Network` address such as
`http://192.168.1.20:5178/`; on a phone on the same Wi-Fi, open that address with `map-editor/` on the
end. Drag with one finger, pinch to zoom, and tap the panel's Hide button for more map.

## What it can move

Keep pieces (barracks, fountain, pylons, spires, ballistas, gate, wards, tavern, mill, quartermaster), back-town
pieces (workshop, stores, cottages, well, lanterns), The Muddled Mug, the three landmarks (their path follows),
the starting trees and the starting ore. The keep hearts, the Forge and the mountains stay put.
