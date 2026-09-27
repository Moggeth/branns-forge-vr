# Generated reference constraints

`generated-map-source.png` is the top-down planning source. `environment-board.png` adds player-height mood and style, and `bridge-model-sheet.png` supplies the single-asset reference trial. All were generated with OpenAI image generation on 2026-09-28, then saved unchanged.

The map has priority for route, stream and landmark placement. The environment board supplies visual treatment, but its perspective panels do not establish dimensions or exact geometry. The bridge sheet has internally inconsistent underside visibility: the side view suggests a low arch while the three-quarter view largely hides it. Treat the top and orthographic dimensions (5 m deck, 3.4 m usable width) as constraints, then use a physically consistent underside of the artist's choice. A bridge must remain traversable and non-fording even if a generated image suggests otherwise.

These images are references, not proof of a playable scene. The saved specs, fixed renders and collider checks provide that evidence.
