# Map editor (local only)

A city-builder style editor for the map. It shows the real terrain, buildings, trees and ore in 3D, viewed through an
RTS camera. It runs only on your computer through the dev server and is never built or deployed. Your changes are
saved to `multiplayer/shared/map-layout.json`, which the game reads. If that file is empty, everything stays where
the code puts it.

## Run it on your PC

Open a terminal (PowerShell is fine) in your `branns-forge-vr` folder, then paste these one at a time:

1. `git fetch origin`
2. `git checkout main` then `git pull` (before this is merged, use `git checkout claude/map-editor-v47m7h` instead)
3. `cd multiplayer`
4. `npm install` (first time only, or after a pull that changed packages)
5. `npm run map`

Your browser opens the editor. Leave the terminal open while you edit, and press Ctrl+C in it when you're done.

## Using it

- **Move**: drag a building across the ground. Drag empty ground to pan. Right-drag orbits the camera and the
  scroll wheel zooms. WASD pans, Q / E turn the camera, T flips between a top-down and a tilted view, and F flies
  to whatever is selected. Click the minimap to jump the camera.
- **Turn**: drag the orange knob in front of a building, press R (Shift+R turns the other way), or scroll while
  you're dragging it.
- **Mirrored keeps**: moving Dawnhold's tavern moves Grumblekeep's the same way, so the two sides stay fair.
- **Build menu** (along the bottom): cottages, wells, lantern posts, trees, and stone, iron, mithril or crystal
  ore. Click a card, then click the ground to place it. Shift-click places more, and Esc stops. Delete removes
  something you added and Ctrl+D copies it. A placed cottage, well or lantern can wear Dawnhold or Grumblekeep stone.
- **Problems**: red outlines mean two things overlap, and orange means a spot that's too steep or off the map. The
  Problems list jumps the camera to each one.
- Undo with Ctrl+Z and redo with Ctrl+Shift+Z. Hold Alt to place without snapping. Unsaved work survives a page
  refresh.

## Try it in the game

Press **Play ▸**. It saves your layout and opens the game in a new tab. Press Play there to start a fresh solo
world with your layout. In the game:

- Placed cottages, wells and lanterns are solid, so heroes and monsters walk around them.
- Placed trees can be chopped.
- Placed ore can be mined.

Saved worlds keep the trees and ore they started with.

## Handing it back to Claude

Press **Copy** and paste the result in the project thread. Claude checks it and does a final pass, covering the
paths, any overlaps and the game's own checks, then opens a pull request.

## On your phone

Run `npm run map:phone` instead of step 5. The terminal prints a `Network` address such as
`http://192.168.1.20:5178/`. On a phone on the same Wi-Fi, open that address with `map-editor/` added to the end.
Drag with one finger, pinch to zoom, and twist two fingers to turn the camera. Rotate the selected building with
the ⟲ ⟳ buttons. A flat top-down version is at `map-editor/plan.html`.

## What it can move and add

- **Moves**: keep pieces (barracks, fountain, pylons, spires, ballistas, gate, ward stones, tavern, mill,
  quartermaster), back-town pieces (workshop, stores, cottages, well, lanterns), The Muddled Mug, the three
  landmarks (their paths follow them), and the starting trees and ore.
- **Adds**: cottages, wells, lantern posts, trees and ore.
- **Fixed**: the keep hearts, the Forge and the mountains.
