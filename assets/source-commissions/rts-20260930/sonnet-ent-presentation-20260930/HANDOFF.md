# Ent presentation — HANDOFF (Sonnet 5.5)

**UNTESTED: no Godot parse, run, capture or VR review was done. Codex must parse-check, capture and VR-review.** Facing, limb orientation and proportions are unverified guesses.

## Integration
```gdscript
var v: EntPresentation = EntPresentation.new()
tree.add_child(v)                                # child of the real tree, never reparented
v.setup(tree, species, scale_hint, condition)    # species "apple"|"pine"; condition "burning" gives embers/seams, anything else healthy
logic.ent_event.connect(func(p: Dictionary) -> void:
    var t: Node3D = p.get("tree") as Node3D
    var v2: Node = t.get_node_or_null("EntPresentation") if t != null else null
    if v2 != null: v2.call("react", p))
# optional per frame: v.update_motion(speed, delta)  (otherwise it self-processes in _process)
```
- **Awaken**: setup, then `react({"phase":"awaken"})` — eyes open, arms unfurl (~1.8 s), bark-chip burst.
- **Restore/load**: setup only (or `react({"phase":"restore"})`) — snaps to awake pose, no animation.
- Phases: awaken, restore, hostile, calm (green eyes, raised brows, pollen), hit (face/brow recoil, canopy shudder, chips), fallen (droop, dim eyes, settling motes).

## Art decisions
- Face placed from Trunk AABB (fallback Crown, lower 45%): heavy slab brows (apple lifted/kind, pine low/solemn), cheek knots, burl nose, carved mouth (grin vs flat), recessed emissive almond eyes (amber; calm soft green; burning ember).
- Two jointed arms (upper + forearm) at ~60% trunk height; two rooted feet each with a toe branch; springy lift from `speed`.
- Burning: dark bark, 4 emissive jagged seams, ember motes. Fire logic stays elsewhere.
- Canopy: only the `Crown` child basis is swayed (restored in `_exit_tree`). Logical transforms, colliders and meta are untouched.
- Static shared material/mesh caches; `EntPresentation.clear_cache()` exists.

## Budgets (estimated from code, not measured)
- MeshInstances: brows 1, eyes 1, limbs 4 arm + 6 foot/toe... = 2 arms x2 + 2 feet x2 = 8, total 10, + seams 1 when burning. Plus 2 CPUParticles3D = 12-13 draws (limit 20).
- Triangles ~ limb 48 x 8 + brows ~ 200 + eyes 20 + seams ~ 50: under ~700.
- Particles: 20 pollen + 10 chips per Ent, CPU, no lights, no node growth; bursts restart the same nodes.

## Limitations
- Face assumes +Z faces the viewer in tree-local space; no facing choice.
- Limbs are simple faceted tapered tubes; not matched to TreeKit's vertex-colour wind/glow shader (plain StandardMaterial3D).
- Trunk AABB for chop-split trees may differ; `scale_hint` only scales particles.
- Hit recoil deforms the face and canopy only, never colliders.
