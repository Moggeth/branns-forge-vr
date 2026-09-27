# Deferred ideas

Saved September 13, 2026. These are possibilities, not an authorized build queue.
Current priority: core gameplay feel and a small reusable character-animation foundation.
Revisit each item explicitly; do not quietly add it to an animation task.

## Sharing the world / multiplayer

Vision: this PC hosts and saves the world. Host and other VR players use native
VR builds; desktop guests join an invitation link and play mouse/keyboard first
person in a browser. Text chat and eventually proximity voice. Players can see
and share Brann's inventions. The host decides item ownership, damage, enemies,
resources and crafting; guest access is separate from local administration.

Possible proof: two people in the Forge Yard, avatars/head/hands, walking and
text chat. Then shared tools/bombs/enemies, then proximity voice and rules for
addressing Brann. Internet links require a secure ingress/tunnel/relay; browser
export needs a rendering/networking compatibility proof. Keep one game codebase
where feasible. No multiplayer implementation, public hosting, account system,
or networking dependency is part of the current animation scope.

## General visual uplift

Preserve simple low-poly silhouettes. Explore warmer sunlight/cooler shadows,
material contrast (brass/iron/wood/stone), grounding shadows, cleaner edges,
restrained magical glow and small environmental movements. Profile actual stereo
frame time; desktop preview FPS does not establish VR headroom. Shared settings
and materials with a before/after switch are preferred to individual asset edits.

## Better asset authoring

Reusable crafted primitives: bevelled blocks, tapered handles, wrapped grips,
faceted foliage and stone arches. Blender-based parametric generators could
make variants easy. An asset inspection room should preview scale, silhouettes,
grip points, forward direction, collisions and rendering cost before delivery.
Possible reference/background libraries: Kenney and Quaternius; verify license
per chosen pack. Keep Brann's original inventions distinctive.

These ideas can inform later work, but a full procedural character generator,
asset-library migration or Blender upgrade is not needed for the first animation.

## References

- https://docs.godotengine.org/en/stable/tutorials/networking/high_level_multiplayer.html
- https://docs.godotengine.org/en/4.6/tutorials/export/exporting_for_web.html
- https://kenney.nl/assets/prototype-kit
- https://quaternius.com/index.html
