# Emberwing phoenix bird (2026-10-05): `wings.glb` is now an actual bird

`multiplayer/public/assets/wings.glb` was a pair of wings stuck on the arrow. It is now a small
phoenix — head, hooked beak, flame crest, body, layered wings and long trailing tail banners.
Installed file is byte-identical to `out/wings.glb`. The previous asset is kept at
`out/wings-previous.glb` for comparison and rollback (`cp out/wings-previous.glb ../../multiplayer/public/assets/wings.glb`).

## Rebuild (deterministic: a repeated build was byte-identical)
```
cd assets/emberwing-phoenix-20261005
python3.11 phoenix_builder.py -- --out $PWD/out              # wings.glb + phoenix-source.blend
python3  verify_glb.py out/wings.glb out/wings-previous.glb  # node contract, wing tips, new vs old box
python3.11 render_review.py -- --glb out/wings.glb --out $PWD/renders --res 860
python3.11 make_sheet.py -- --src renders --out renders/phoenix-bird-sheet.png --cell 470 --cols 3 \
    --order threequarter,side,front,top,beat-up,beat-down,rear,insky,insky-far
cp renders/phoenix-bird-sheet.png /mnt/project-files/emberwing/
cp out/wings.glb ../../multiplayer/public/assets/wings.glb
```
`bpy` 4.5 is used as a Python module; `blender -b --python phoenix_builder.py -- --out DIR` works too.
`verify_glb.py` and `make_sheet.py` are pure python (no bpy, no PIL).

## Node contract (unchanged where the game depends on it)
```
Wings                                        root, at the origin
  Body            1,780 tris   Ember + EmberFlame
  WingLeft        empty at (-0.030, +0.062, -0.008)   <- the LEFT SHOULDER
    WingLeftMesh    838 tris   Ember        verts authored in the wing's own frame, wing runs local -X
  WingRight       empty at (+0.030, +0.062, -0.008)   <- the RIGHT SHOULDER
    WingRightMesh   838 tris   Ember        wing runs local +X
```
* `combat-view.js` flaps each wing with `rest * setFromAxisAngle(Z, ±flap)`. Each wing's origin is its
  shoulder joint and the wing extends along its own ±X, so a local-Z turn is a clean wing beat. Both
  wing meshes have identity transforms under their empties, so the client's `userData.rest` is identity.
* `measureWingTips` takes the vertex furthest from each pivot. That vertex is at **(∓0.2289, +0.0389, +0.1101),
  |d| = 0.2569, 95.7 % of the wing's own span** — a genuine outer pinion tip (the old asset's furthest
  vertex was only 83–84 % out, on a trailing feather). Contrails now stream from the real wing tip.
* The old `EmberTrail` node is gone. Nothing in `multiplayer/` referenced it (checked by grep), and the
  carry rig emits its tail wisp from the arrow's own nock (`arrow.localToWorld(0,0,.78)`), not from this asset.
* Node names `Wings`, `WingLeft`, `WingRight` are kept exactly.

## Orientation and size
Authored in final glTF coordinates: metres, +Y up, the bird faces **-Z** (nose forward, the arrow's flight
direction), upright, origin on the arrow shaft under the belly between the shoulders. `ASSET_POSES.wings`
(`forward [0,0,-1]`, `up [0,1,0]`, `pivot [0,0,0]`, `nativeScale 1`) needs no change, so the existing
scale factors (1.1 in flight, 1.8 for the skull carry) still apply.

| bounding box | new | old | change |
|---|---:|---:|---:|
| x (wingspan) | 0.5382 | 0.5440 | **-1.1 %** |
| y (height)   | 0.1261 | 0.1122 | **+12.3 %** |
| z (depth)    | 0.3354 | 0.2847 | **+17.8 %** |
| x range | -0.2691 .. +0.2691 | -0.2720 .. +0.2720 | |
| y range | +0.0175 .. +0.1435 | -0.0005 .. +0.1117 | the belly clears the shaft; the crest is the top |
| z range | -0.0982 .. +0.2372 | -0.0619 .. +0.2228 | the beak reaches further forward; the banners end where the old wings did |

All three axes are inside the ±20 % the brief allowed. Span — the dimension that drives how big it reads —
is matched to about 1 %. The extra depth is the head in front and the tail banners behind; at the carry
scale of 1.8 the whole bird still sits well inside the 0.78 m arrow (banners end 0.43 m from the tip,
0.35 m short of the nock).

## Budget
| | value | limit |
|---|---:|---:|
| triangles | **3,456** (Body 1,780 + 838 + 838) | 4,000 |
| primitives | 4 | |
| materials | 2 | 2 |
| textures | 1 × 256×256 PNG | 256 px |
| lights | 0 | 0 |
| bytes | 198,348 | — (old 91,080) |

## Materials
* **`Ember`** — everything but the tail fire. Base colour *and* emission are the same 256×256 atlas
  (`KHR_materials_emissive_strength` 1.30, roughness 0.66, double sided). Because the emission is the
  texture, the glow varies with the plumage for free: deep crimson roots barely glow, gold edges and the
  white-hot feather tips burn. Named `Ember` deliberately — the bow uses a material of that name and
  `arrow.glb` has `ArrowEmber`, both of which the runtime pulses, so this one can be driven the same way.
  (The old names `WingFeather` / `WingFlame` were referenced nowhere in `multiplayer/`.)
* **`EmberFlame`** — only the four short fire tongues where the tail leaves the body. Solid emissive
  (1, 0.26, 0.03) at strength 1.4, opaque: no alpha blending anywhere, so there is nothing to sort
  on a small fast projectile that can appear several times at once.

### The atlas (`atlas()` in the builder, deterministic numpy)
Eight v-bands of 1/8, `row_uv(row, u, s)` maps any part into one. 0 primaries · 1 secondaries & coverts ·
2 body (u = nose→tail, s = spine→belly) · 3 head & crest · 4 beak & talons · 5 tail banners ·
6 eye (sapphire bead, gold rim, catchlight) · 7 under-glow and flame cores. Every plumage row runs
ember-dark → crimson → scarlet → orange → amber → gold, with white only in the last few per cent, and
darkened vane edges so neighbouring feathers separate at distance. This is the whole art direction: the
bird is a *living ember*, hottest at the tips of everything.

## Shape notes
* **Wing.** A slim arched arm (a closed 8×4 cupped shell, mostly hidden) carries 6 upper coverts,
  5 under-coverts, 7 secondaries and 9 primaries, each a cupped three-row vane on the double-sided
  material — a feathered wing for the price of sheets. The first version used a deep membrane between the
  bone and the secondaries and read as a bat; the arm chord was cut from 0.112 to 0.062 and the feathers
  make the area instead. The pinions sweep back 17°→75°, longest first, so the tip is a clean swept point
  *and* the furthest vertex.
* **Body.** Twelve-sided tapering torso, breast swell, glowing throat patch, a 7-feather nape ruff,
  two rows of scapulars over the back and a short breast apron, so the torso is not a bald egg.
* **Head.** Short S-neck, round head, hooked two-mandible brass beak, sapphire eye beads, two cheek flares
  and a five-feather flame crest (centre tallest, swept back). The crest was trimmed ~13 % late to keep
  the asset height inside the ±20 % band.
* **Tail.** Four long banners (a bare glowing shaft that opens into a flaming spade near the tip — the
  `prof_banner` profile) spread up/out and down/in, behind them a seven-feather fan, and four `EmberFlame`
  tongues at the root. The banners are what sell "phoenix" in motion; the game's contrails extend them.
* **Legs.** Two tiny talons tucked up against the belly, gripping where the shaft is.

## Review renders
`renders/phoenix-bird-sheet.png` here (the individual views are regenerated by render_review.py and are not committed), and `/mnt/project-files/emberwing/phoenix-bird-sheet.png` (3×3 contact
sheet: three-quarter, side, front, top, wings mid-beat up, mid-beat down, rear, and two in-sky shots at
the in-flight scale of 1.1 seen from ~6 m and ~11 m against a Nishita daytime sky). Individual
`phoenix-side/threequarter/front/top/beat-up/insky.png` are there too.

`render_review.py` flaps the wings by rotating each node about its own local Z exactly as the client does
(left −θ, right +θ; the glTF node's local +Z is the imported object's local −Y), so the mid-beat frames
are the real in-game pose, not a hand-made one.

**Render settings matter.** The first pass used AgX with a hot key light and the bird came out uniformly
pale pink: AgX and ACES both desaturate bright values hard, and a saturated colour pushed into the
highlights goes white. The review now uses Filmic at exposure −1.2 with much weaker lights, which is a
fair read of the saturated-but-not-blown look the game's ACESFilmic tone mapping gives. If the bird looks
washed out in game, the fix is to lower `Ember`'s emissive strength, not to brighten the texture.

## Honest assessment of the renders
It reads as a cheerful little phoenix, not a blob, and not grim. Strongest from above and in the
mid-beat poses: layered scarlet-to-gold feathers, a clean swept wing tip, a flame crest and two spade-tipped
banners. Front-on it is charming — a gold bird with a single flame plume and a bright throat. At in-flight
size against the sky it still reads as a fiery winged creature with a clear V silhouette, which was the
point. Weaknesses I did not fully solve: in profile the body is a fairly smooth pod and the tail banners
are thin enough to nearly disappear at distance (in game the contrails cover this); from behind there is
still a small pale patch of dorsal plumage that catches the sky more than I would like; and the top
surfaces of the wings go pinker than the saturated scarlet of the underside, which is a property of
emission plus a bright key and will depend on the game's real lighting. The first in-engine look is the
one that counts — none of this has been seen in three.js, on a phone or in a headset yet.
