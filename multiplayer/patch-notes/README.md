# Patch notes

Players read these in the game (Menu → Patch notes, or the welcome screen), and a "What's new" card
lists new entries the first time someone loads a newer version.

**Every PR that changes the game adds one entry file here.** CI fails a pull request that changes
`multiplayer/client`, `shared`, `public`, `peer`, `server` or the top-level game files without one.
For a change no player could notice, put `[no patch notes]` in a commit message instead.

## One file per change

Name it `YYYY-MM-DD-short-name.md`, using the date it merges in Mitch's time zone
(`TZ=Australia/Sydney date +%F`). Separate files mean parallel PRs never conflict.

```markdown
---
date: 2026-10-04 14:50
area: Weapons
title: Timberline, round two
pr: 21
---
- Bolts now fly on under gravity for up to 12 seconds (they used to vanish about 40 m out), so long artillery shots work.
- Hold right-click to look through a new brass **scope**.
  - Nested bullets work one level deep.
> Optional developer's note, shown in italics.
```

- `date`: `YYYY-MM-DD`, optionally with a 24-hour `HH:MM`, and matching the file name.
- `area`: one of Heroes, God, Weapons, Creatures, World, Building, Interface, Multiplayer, Phones,
  VR, Performance, Bug fixes, Behind the scenes.
- `title`: a short name for the change, 60 characters at most.
- `pr`: optional. It is kept for reference and never shown.
- `patch` and `headline`: optional. Entries are grouped into one patch per day. `patch` puts an entry
  in a different group, and `headline` names the patch it belongs to.

Entries on the same day form one patch. Patches are numbered 0.1, 0.2, … from the oldest.

## How to write them

Write for players, in the friendly style of World of Warcraft patch notes. Say what changed and
why it matters, and give real numbers when tuning changes:

- "Reload time increased to 1.0 seconds (was 0.7) to make room for the songbird."
- "Added a brass scope for the first-person Timberline view."
- "Fixed buildings being placed at the wrong angle after you had turned the camera many times."

Leave out file names, code, PR numbers and engine jargon. `node tests/patch-notes.mjs` checks the
format and rejects the most common slips.
