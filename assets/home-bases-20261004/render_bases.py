"""Preview renders of the home bases kit, laid out with the game's HOME_LAYOUT.
  python3 render_bases.py [D|G|both] [samples] [views]     -> renders/*.png
Game local (x right of gate, y out of gate) maps to Blender (-x, -y); pieces face -Y (out of the gate).
"""
import bpy, math, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "renders"); os.makedirs(OUT, exist_ok=True)
WHICH = sys.argv[1] if len(sys.argv) > 1 else "both"
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 48
VIEWS = sys.argv[3].split(",") if len(sys.argv) > 3 else ["aerial", "gate", "heart", "turrets"]
LAYOUT = dict(barracks=(-7, 3.4), fountain=(5.2, 3.2), pylons=[(6.6, 11.43), (-6.6, 11.43), (0, -13.2)],
              spires=[(-4, 16), (4, 16)], ballistas=[(-9.5, 14.5), (9.5, 14.5)])
DOME = 13.5

def at(local): return Vector((-local[0], -local[1], 0))

def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "bases_kit.glb"))
    kit = {o.name: o for o in bpy.data.objects}
    for m in bpy.data.materials:  # the game drives glow with emissiveIntensity; match it here
        b = m.node_tree.nodes.get("Principled BSDF") if m.use_nodes else None
        if b and m.name in ("Crystal", "Amethyst", "Ember", "Ooze"): b.inputs["Emission Strength"].default_value = {"Ember": 4.0, "Ooze": 2.5}.get(m.name, 3.0)
    for o in kit.values(): o.hide_render = True; o.hide_viewport = True
    return kit

def inst(kit, name, M):
    src = kit[name]; o = src.copy(); bpy.context.scene.collection.objects.link(o); o.parent = None
    o.matrix_world = M; o.hide_render = False; o.hide_viewport = False; return o

def anchor_m(kit, piece, a):
    return kit[a].matrix_local if kit[a].parent and kit[a].parent.name == piece else kit[a].matrix_world

def place(kit, pre, piece, M, extra=()):
    inst(kit, f"{pre}_{piece}", M)
    for node, a in extra:
        inst(kit, f"{pre}_{node}", M @ Matrix.Translation(kit[f"{pre}_{a}"].matrix_local.translation))

def ballista(kit, pre, M, yaw=0.0, pitch=0.06):
    inst(kit, f"{pre}_BallistaBase", M)
    My = M @ Matrix.Translation(kit[f"{pre}_BallistaBase_Yoke"].matrix_local.translation) @ Matrix.Rotation(yaw, 4, "Z")
    inst(kit, f"{pre}_BallistaYoke", My)
    Mb = My @ Matrix.Translation(kit[f"{pre}_BallistaYoke_Bow"].matrix_local.translation) @ Matrix.Rotation(pitch, 4, "X")
    inst(kit, f"{pre}_BallistaBow", Mb)
    inst(kit, f"{pre}_BallistaBolt", Mb @ Matrix.Translation(kit[f"{pre}_BallistaBow_Bolt"].matrix_local.translation))

def ground(evil):
    bpy.ops.mesh.primitive_plane_add(size=90); g = bpy.context.object
    m = bpy.data.materials.new("ground"); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 0.6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.12, 0.2, 0.06, 1) if not evil else (0.13, 0.16, 0.07, 1)
    ramp.color_ramp.elements[1].color = (0.25, 0.38, 0.1, 1) if not evil else (0.22, 0.25, 0.12, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.95
    g.data.materials.append(m)
    # plaza
    bpy.ops.mesh.primitive_cylinder_add(vertices=8 if not evil else 6, radius=9.5, depth=0.1, location=(0, 0, 0.0))
    p = bpy.context.object; pm = bpy.data.materials.new("plaza"); pm.use_nodes = True
    pm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.55, 0.5, 0.42, 1) if not evil else (0.16, 0.14, 0.18, 1)
    p.data.materials.append(pm)

def dome(evil):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=DOME, location=(0, 0, -0.3)); d = bpy.context.object
    m = bpy.data.materials.new("dome"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); mx = nt.nodes.new("ShaderNodeMixShader"); tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    em = nt.nodes.new("ShaderNodeEmission"); lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.2
    pw = nt.nodes.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 2.0
    sc = nt.nodes.new("ShaderNodeMath"); sc.operation = "MULTIPLY"; sc.inputs[1].default_value = 0.5
    em.inputs["Color"].default_value = (0.35, 0.7, 1.0, 1) if not evil else (0.7, 0.42, 1.0, 1); em.inputs["Strength"].default_value = 1.6
    nt.links.new(lw.outputs["Facing"], pw.inputs[0]); nt.links.new(pw.outputs[0], sc.inputs[0]); nt.links.new(sc.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(em.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs["Surface"])
    d.data.materials.append(m)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(d.data); bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.1], context="VERTS"); bm.to_mesh(d.data); bm.free()

def light(evil):
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.55, 0.75, 1) if not evil else (0.32, 0.3, 0.45, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), 0, math.radians(35))); s = bpy.context.object
    s.data.energy = 3.2 if not evil else 2.2; s.data.color = (1.0, 0.95, 0.85) if not evil else (0.95, 0.85, 1.0); s.data.angle = math.radians(3)

def glow(loc, col, e):
    bpy.ops.object.light_add(type="POINT", location=loc); l = bpy.context.object; l.data.energy = e; l.data.color = col; l.data.shadow_soft_size = 0.5

def compose(kit, pre):
    evil = pre == "G"; ground(evil); dome(evil); light(evil)
    place(kit, pre, "Heart", Matrix(), [("HeartCrystal", "Heart_Core"), ("HeartRingA", "Heart_Core"), ("HeartRingB", "Heart_Core")])
    for nm in ("HeartRingA", "HeartRingB"):
        o = [x for x in bpy.data.objects if x.name.startswith(f"{pre}_{nm}") and not x.hide_render][-1]
        o.rotation_euler = (0.5, 0.2, 0) if nm.endswith("A") else (-0.4, 0.8, 0)
    core = kit[f"{pre}_Heart_Core"].matrix_local.translation; glow(core, (0.4, 0.7, 1.0) if not evil else (0.75, 0.45, 1.0), 900)
    yaw = -0.55 if not evil else 0.55
    place(kit, pre, "Barracks", Matrix.Translation(at(LAYOUT["barracks"])) @ Matrix.Rotation(yaw, 4, "Z"), [("Bell", "Barracks_Bell")])
    place(kit, pre, "Fountain", Matrix.Translation(at(LAYOUT["fountain"])), [("FountainWater", None) if False else ("FountainCrystal", "Fountain_Crystal")])
    inst(kit, f"{pre}_FountainWater", Matrix.Translation(at(LAYOUT["fountain"])))
    for q in LAYOUT["pylons"]: place(kit, pre, "Pylon", Matrix.Translation(at(q)), [("PylonCrystal", "Pylon_Crystal")])
    for q in LAYOUT["spires"]: place(kit, pre, "Spire", Matrix.Translation(at(q)), [("SpireCrystal", "Spire_Crystal")])
    for i, q in enumerate(LAYOUT["ballistas"]): ballista(kit, pre, Matrix.Translation(at(q)), yaw=(0.35 if i else -0.35))
    inst(kit, f"{pre}_Gate", Matrix.Translation((0, -DOME, 0)))
    n = 18
    for k in range(n):
        a = k / n * 2 * math.pi
        if abs(math.atan2(math.sin(a + math.pi / 2), math.cos(a + math.pi / 2))) < 0.36: continue  # gate gap
        p = Vector((math.cos(a) * DOME, math.sin(a) * DOME, 0)); inst(kit, f"{pre}_Ward", Matrix.Translation(p) @ Matrix.Rotation(a + math.pi / 2, 4, "Z"))

def cam(loc, target, lens=30):
    bpy.ops.object.camera_add(location=loc); c = bpy.context.object; c.data.lens = lens
    d = Vector(target) - Vector(loc); c.rotation_euler = d.to_track_quat("-Z", "Y").to_euler(); bpy.context.scene.camera = c

def render(name, res=(1280, 720)):
    sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True; sc.cycles.device = "CPU"
    sc.cycles.max_bounces = 4; sc.cycles.transparent_max_bounces = 12
    sc.render.resolution_x, sc.render.resolution_y = res; sc.view_settings.view_transform = "AgX"
    sc.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True); print("wrote", name, flush=True)

SHOTS = {
    "aerial": ((14, -30, 19), (0, -2, 1.5), 26),
    "gate": ((3.5, -26, 3.2), (0, -6, 3.0), 24),
    "heart": ((5.5, -10.5, 4.2), (0, 0, 2.6), 30),
    "turrets": ((-12, -22, 3.0), (-6, -14.5, 1.8), 30),
    "barracks": ((-1, -9, 3.5), (6.5, -3.4, 2.2), 26),
}
for pre in (["D", "G"] if WHICH == "both" else [WHICH]):
    kit = setup(); compose(kit, pre)
    for v in VIEWS:
        if v == "barracks":  # straight at the door, whichever way the hall is turned
            yaw = -0.55 if pre == "D" else 0.55; b = at(LAYOUT["barracks"]); f = Vector((math.sin(yaw), -math.cos(yaw), 0))
            loc, tgt, lens = tuple(b + f * 11 + Vector((0, 0, 3.0)) + Vector((-f.y, f.x, 0)) * 2.5), tuple(b + Vector((0, 0, 2.4))), 28
        else: loc, tgt, lens = SHOTS[v]
        cam(loc, tgt, lens); render(f"{pre}_{v}.png")
