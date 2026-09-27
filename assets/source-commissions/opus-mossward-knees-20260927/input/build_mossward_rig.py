"""Mossward rigged prototype (Blender 4.5, headless).

    blender -b --factory-startup --python output/build_mossward_rig.py

Reuses baseline/build_guardian.py for all geometry, then adds:
  * a small identity pass (moss cap, toadstool, sprout, shoulder moss, mossier cloth)
  * an Armature "MosswardRig": Root > Torso > Head/LeftArm/RightArm, Root > LeftLeg/RightLeg
  * rigid skinning: each part mesh has one vertex group (weight 1.0) for its bone
  * separate "Shield" object, skinned 100% to LeftArm
  * actions: idle (2 s loop), walk (1 s loop), attack (windup / contact / recover), all in place
Outputs next to this script: mossward_rig.glb, mossward_rig.blend, renders/*.png
Axes: Blender Z-up facing -Y  ->  glTF/Godot +Y up, facing +Z.
"""
import bpy, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "baseline"))
import build_guardian as bg  # noqa: E402

FPS = 30
BONES = ["Torso", "Head", "LeftArm", "RightArm", "LeftLeg", "RightLeg"]
PARENT = {"Torso": "Root", "Head": "Torso", "LeftArm": "Torso", "RightArm": "Torso",
          "LeftLeg": "Root", "RightLeg": "Root"}


# ---------------------------------------------------------------- identity pass
def woodland_details(parts, M):
    moss = bg.material("Mossward_MossTuft", "56753A", 0.95)
    moss_hi = bg.material("Mossward_MossLight", "8FA85A", 0.95)
    cap = bg.material("Mossward_Toadstool", "C8663F", 0.6)
    spots = bg.material("Mossward_ToadSpots", "F1E6CB", 0.6)
    H = parts["Head"][0]
    # Lumpy moss cap sitting on the skull, slightly off-centre (a little bedraggled).
    for p, r, m in (((0.02, 0.01, 1.675), 0.085, moss), ((-0.06, 0.03, 1.655), 0.06, moss),
                    ((0.07, 0.04, 1.65), 0.055, moss_hi), ((-0.01, 0.08, 1.63), 0.06, moss)):
        H.sphere(p, r, m, scale=(1.25, 1.15, 0.38), seg=12, rings=6)
    # Tiny toadstool on the right of the crown.
    H.cyl((0.085, 0.03, 1.66), (0.1, 0.03, 1.735), 0.012, 0.01, spots, seg=8)
    H.sphere((0.1, 0.03, 1.74), 0.042, cap, scale=(1, 1, 0.55), seg=12, rings=6)
    for a in (0.3, 2.2, 4.1):
        H.sphere((0.1 + 0.026 * math.cos(a), 0.03 + 0.026 * math.sin(a), 1.755), 0.008, spots, seg=6, rings=4)
    # Nervous little sprout, drooping forward.
    H.tube([(-0.05, 0.0, 1.68), (-0.06, -0.02, 1.75), (-0.085, -0.06, 1.77)], 0.006, M["accent"], seg=6)
    H.sphere((-0.1, -0.08, 1.765), 0.03, M["accent"], scale=(1, 0.5, 0.3), seg=8, rings=5,
             rot=Matrix.Rotation(-0.5, 4, "X"))
    T = parts["Torso"][0]
    # Moss growing over the right collarbone and pelvis rim.
    T.sphere((0.17, 0.0, 1.42), 0.055, moss, scale=(1.3, 1.1, 0.4), seg=10, rings=5)
    T.sphere((0.12, -0.03, 1.44), 0.035, moss_hi, scale=(1.2, 1, 0.4), seg=8, rings=5)
    T.sphere((-0.12, -0.05, 0.9), 0.04, moss, scale=(1.3, 0.8, 0.5), seg=8, rings=5)


# ---------------------------------------------------------------- rig
def build_rig(objs, col):
    arm_data = bpy.data.armatures.new("MosswardRig")
    arm = bpy.data.objects.new("MosswardRig", arm_data)
    col.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    root = eb.new("Root")
    root.head, root.tail = (0, 0, 0), (0, 0, 0.2)
    # Every bone points +Z with roll 0: local X = world X (pitch), local Y = up (yaw),
    # local Z = world -Y (side roll). Keeps keyframe values readable.
    for n in BONES:
        b = eb.new(n)
        h = objs[n].location.copy()
        length = {"Torso": objs["Head"].location.z - h.z}.get(n, 0.14)
        b.head, b.tail, b.roll = h, h + Vector((0, 0, length)), 0.0
    for n in BONES:
        eb[n].parent = eb[PARENT[n]]
    bpy.ops.object.mode_set(mode="OBJECT")
    for n in BONES + ["Shield"]:
        ob = objs[n]
        bone = "LeftArm" if n == "Shield" else n
        mw = ob.matrix_world.copy()
        vg = ob.vertex_groups.new(name=bone)
        vg.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        ob.parent = arm
        ob.matrix_world = mw
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    arm.show_in_front = True
    return arm


def key(arm, frame, pose):
    """pose: {bone: (rx, ry, rz)} in degrees, plus optional 'bob': Root up offset in metres."""
    for pb in arm.pose.bones:
        r = pose.get(pb.name, (0, 0, 0))
        pb.rotation_euler = [math.radians(v) for v in r]
        pb.keyframe_insert("rotation_euler", frame=frame)
    root = arm.pose.bones["Root"]
    root.location = (0, pose.get("bob", 0.0), 0)  # bone-local Y = world up
    root.keyframe_insert("location", frame=frame)


def make_action(arm, name, keys, cyclic):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for f, pose in keys:
        key(arm, f, pose)
    for fc in act.fcurves if hasattr(act, "fcurves") else []:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
    act.frame_range = (keys[0][0], keys[-1][0])
    act.use_frame_range = True
    act.use_cyclic = cyclic
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, int(keys[0][0]), act)
    tr.mute = True
    arm.animation_data.action = None
    return act


# Rest pose already has the shield raised and the head tilted (baked into the meshes).
IDLE = [
    (0, {"Torso": (2, 0, 0), "Head": (0, 0, 0), "LeftArm": (0, 0, 0), "RightArm": (0, 0, 0), "bob": 0.0}),
    (15, {"Torso": (4, 0, 0), "Head": (-6, 10, -4), "RightArm": (-4, 0, -4), "LeftArm": (2, 0, 0), "bob": -0.01}),
    (30, {"Torso": (2, 0, 0), "Head": (2, -4, 2), "LeftArm": (0, 0, 0), "bob": 0.0}),
    (38, {"Torso": (3, 0, 0), "Head": (-4, -16, 3), "RightArm": (-6, 0, -6), "bob": -0.006}),  # nervous glance
    (45, {"Torso": (4, 0, 0), "Head": (-3, 12, -2), "RightArm": (-3, 0, -3), "bob": -0.01}),
    (60, {"Torso": (2, 0, 0), "Head": (0, 0, 0), "LeftArm": (0, 0, 0), "RightArm": (0, 0, 0), "bob": 0.0}),
]


def walk_keys():
    ks = []
    for f in (0, 8, 15, 23, 30):  # contact / passing / contact / passing / loop
        ph = f / 30 * math.tau
        s = math.cos(ph)
        ks.append((f, {
            "LeftLeg": (-28 * s, 0, 0), "RightLeg": (28 * s, 0, 0),
            "RightArm": (-22 * s, 0, -5), "LeftArm": (8 * s, 0, 0),
            "Torso": (6, 5 * s, 0), "Head": (-4, -4 * s, 2 * math.sin(ph)),
            "bob": -0.03 * abs(s) + 0.01,
        }))
    return ks


ATTACK = [
    (0, {"Torso": (2, 0, 0)}),
    (12, {"Torso": (-12, 28, 0), "Head": (6, -10, 0), "RightArm": (-150, 0, -20),  # windup: rear back
          "LeftArm": (-10, 0, 0), "LeftLeg": (-10, 0, 0), "RightLeg": (14, 0, 0), "bob": 0.02}),
    (15, {"Torso": (-14, 32, 0), "Head": (8, -12, 0), "RightArm": (-160, 0, -22),
          "LeftArm": (-12, 0, 0), "LeftLeg": (-10, 0, 0), "RightLeg": (14, 0, 0), "bob": 0.02}),
    (19, {"Torso": (26, -22, 0), "Head": (-12, 8, 0), "RightArm": (-55, 0, 12),  # contact
          "LeftArm": (14, 0, 0), "LeftLeg": (-26, 0, 0), "RightLeg": (22, 0, 0), "bob": -0.05}),
    (23, {"Torso": (24, -20, 0), "Head": (-10, 6, 0), "RightArm": (-45, 0, 12),
          "LeftArm": (12, 0, 0), "LeftLeg": (-24, 0, 0), "RightLeg": (20, 0, 0), "bob": -0.045}),
    (36, {"Torso": (2, 0, 0)}),  # recover
]


# ---------------------------------------------------------------- render
def setup_render():
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT"
    world = bpy.data.worlds.new("RenderWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.6, 0.5, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scn.world = world
    scn.view_settings.view_transform = "AgX"
    for name, rot, e in (("Key", (50, 0, -35), 3.5), ("Rim", (60, 0, 160), 2.0)):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = e
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = [math.radians(v) for v in rot]
        scn.collection.objects.link(lo)
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.2, fill_type="NGON")
    g = bpy.context.active_object
    g.name = "RenderGround"
    g.data.materials.append(bg.material("RenderGround", "8E9A74", 0.95))
    cd = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def aim(cam, loc, look, lens):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def play(arm, act, frame):
    arm.animation_data.action = act
    bpy.context.scene.frame_set(frame)


def render(path, w, h):
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)


def contact_sheet(arm, acts, cam, out):
    import numpy as np
    rows = [("idle", [0, 15, 38, 45]), ("walk", [0, 8, 15, 23]), ("attack", [0, 15, 19, 30])]
    w, h = 320, 400
    aim(cam, (-2.2, -3.0, 1.2), (0, 0, 0.82), 40)
    sheet = np.zeros((h * len(rows), w * 4, 4), dtype=np.float32)
    tmp = os.path.join(out, "_cell.png")
    for r, (name, frames) in enumerate(rows):
        for c, f in enumerate(frames):
            play(arm, acts[name], f)
            render(tmp, w, h)
            img = bpy.data.images.load(tmp)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            bpy.data.images.remove(img)
            y0 = (len(rows) - 1 - r) * h  # image pixels are bottom-up
            sheet[y0:y0 + h, c * w:(c + 1) * w] = px
    os.remove(tmp)
    im = bpy.data.images.new("ContactSheet", w * 4, h * len(rows), alpha=True)
    im.pixels[:] = sheet.ravel()
    im.filepath_raw = os.path.join(out, "mossward_contact_sheet.png")
    im.file_format = "PNG"
    im.save()


# ---------------------------------------------------------------- main
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    V = bg.VARIANTS["mossward"]
    V["cloth"] = "5C7A3A"      # mossier, less olive
    V["trim"] = "4A3526"       # warmer bark leather
    V["shield"]["face"] = "4F7536"
    M = bg.mats_for(V)
    col = bpy.data.collections.new("Mossward_Rigged")
    bpy.context.scene.collection.children.link(col)
    parts, shield_part, shield_xf, info = bg.build_character(V, M, col)
    woodland_details(parts, M)
    S = 0.94  # baseline 0.96 + moss cap would exceed 1.7 m
    SM = Matrix.Diagonal((S, S, S, 1))
    objs = {}
    for name, entry in parts.items():
        xf = SM @ (entry[2] if len(entry) > 2 else Matrix.Identity(4))
        objs[name] = entry[0].finish(SM @ Vector(entry[1]), col, transform=xf)
    objs["Shield"] = shield_part.finish(SM @ (shield_xf @ info["grip"]), col, transform=SM @ shield_xf)
    minz = min((o.location + v.co).z for o in objs.values() for v in o.data.vertices)
    for o in objs.values():
        o.location.z -= minz
    bpy.context.view_layer.update()
    height = max((o.location + v.co).z for o in objs.values() for v in o.data.vertices)

    arm = build_rig(objs, col)
    scn = bpy.context.scene
    scn.render.fps = FPS
    acts = {"idle": make_action(arm, "idle", IDLE, True),
            "walk": make_action(arm, "walk", walk_keys(), True),
            "attack": make_action(arm, "attack", ATTACK, False)}

    bpy.ops.object.select_all(action="DESELECT")
    for o in [arm] + [objs[n] for n in BONES + ["Shield"]]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, "mossward_rig.glb"), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=False, export_materials="EXPORT", export_image_format="NONE",
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_skins=True, export_def_bones=False, export_frame_range=False,
        export_anim_single_armature=True, export_cameras=False, export_lights=False)

    rdir = os.path.join(HERE, "renders")
    os.makedirs(rdir, exist_ok=True)
    cam = setup_render()
    play(arm, acts["attack"], 19)
    aim(cam, (-1.9, -2.5, 1.45), (-0.1, 0, 0.9), 38)
    render(os.path.join(rdir, "mossward_hero_attack_contact.png"), 900, 1100)
    play(arm, acts["idle"], 0)
    render(os.path.join(rdir, "mossward_hero_idle.png"), 900, 1100)
    aim(cam, (0, -4.2, 0.95), (0, 0, 0.85), 35)
    render(os.path.join(rdir, "mossward_front.png"), 700, 900)
    contact_sheet(arm, acts, cam, rdir)
    arm.animation_data.action = acts["idle"]
    scn.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "mossward_rig.blend"))

    tris = {n: bg.tri_count(objs[n]) for n in BONES + ["Shield"]}
    print("RIGSTATS height=%.3f tris=%s total=%d bones=%d actions=%s" % (
        height, tris, sum(tris.values()), len(arm.data.bones),
        {k: tuple(a.frame_range) for k, a in acts.items()}))


main()
