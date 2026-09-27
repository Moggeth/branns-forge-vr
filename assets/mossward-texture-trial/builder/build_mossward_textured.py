"""Mossward textured shield build: the unmodified guardian builder plus a UV/material layer.

    blender -b --factory-startup --python outputs/mossward/builder/build_mossward_textured.py -- [--baseline] [--no-render]

Loads the byte-identical copy of work/opus-skeletons/builder/build_guardian.py beside
this file and patches three things only (geometry is untouched):
  * Part.finish: before transform, the "Shield" bmesh gets a planar front-projected
    UV layer in plate-local metres (same FRAME as tools/make_mossward_textures.py), so
    the guardian-held shield and the standalone prop carry identical UVs.
  * mats_for: Mossward_ShieldFace gets albedo+ORM+normal, Mossward_ShieldCore (rear
    boards) gets albedo, Mossward_Emblem (raised leaf + acorn) gets albedo.  All other
    materials are unchanged.  Texture lookups are bounded by material, so rim, studs,
    grip, brackets and the skeleton never sample the art.
  * export: embeds the PNGs (export_image_format AUTO) so GLBs are self-contained.
--baseline skips the patches and reproduces the live asset for before/after renders.
Outputs: outputs/mossward/<textured|baseline>/assets/mossward/ plus renders/compare_*.png
"""
import importlib.util, math, os, sys
import bpy, bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
TEX = os.path.join(OUT, "textures")
FRAME = dict(u0=-0.32, u1=0.32, v0=-0.56, v1=0.54)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BASELINE = "--baseline" in argv
DO_RENDER = "--no-render" not in argv

spec = importlib.util.spec_from_file_location("build_guardian", os.path.join(HERE, "build_guardian.py"))
G = importlib.util.module_from_spec(spec)
sys.argv = [sys.argv[0]]  # keep the builder's own __main__ block inert
spec.loader.exec_module(G)
G.ROOT = os.path.join(OUT, "baseline" if BASELINE else "textured")


# ---------------------------------------------------------------- patches
_finish = G.Part.finish


def finish_with_uv(self, pivot, collection, transform=None):
    if self.name == "Shield":
        uv = self.bm.loops.layers.uv.new("UVMap")
        du, dv = FRAME["u1"] - FRAME["u0"], FRAME["v1"] - FRAME["v0"]
        for f in self.bm.faces:
            for l in f.loops:
                co = l.vert.co  # plate-local: u=x, v=z (front face is -Y)
                l[uv].uv = ((co.x - FRAME["u0"]) / du, (co.z - FRAME["v0"]) / dv)
    return _finish(self, pivot, collection, transform)


def image(name, non_color=False):
    path = os.path.join(TEX, name)
    img = bpy.data.images.get(name) or bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.pack()
    return img


def textured(m, albedo, orm=None, normal=None, normal_strength=1.0):
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = image(albedo)
    nt.links.new(uvn.outputs["UV"], t.inputs["Vector"])
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    if orm:
        o = nt.nodes.new("ShaderNodeTexImage")
        o.image = image(orm, True)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(uvn.outputs["UV"], o.inputs["Vector"])
        nt.links.new(o.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], p.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], p.inputs["Metallic"])
    if normal:
        nm = nt.nodes.new("ShaderNodeTexImage")
        nm.image = image(normal, True)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(uvn.outputs["UV"], nm.inputs["Vector"])
        nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], p.inputs["Normal"])


_mats_for = G.mats_for


def mats_for_textured(V):
    M = _mats_for(V)
    textured(M["face"], "mossward_face_albedo.png", "mossward_face_orm.png", "mossward_face_normal.png")
    textured(M["face_back"], "mossward_back_albedo.png")
    textured(M["emblem"], "mossward_emblem_albedo.png")
    return M


def export_embedded(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_cameras=False, export_lights=False, export_yup=True,
                              export_apply=True, export_materials="EXPORT", export_image_format="AUTO")


if not BASELINE:
    G.Part.finish = finish_with_uv
    G.mats_for = mats_for_textured
    G.export = export_embedded


# ---------------------------------------------------------------- comparison renders
def compare_renders(tag):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT"
    scn.render.resolution_x, scn.render.resolution_y = 900, 1100
    scn.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("CompareWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.58, 0.52, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scn.world = world
    rig = []

    def sun(name, rot, energy):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = [math.radians(a) for a in rot]
        scn.collection.objects.link(lo)
        rig.append(lo)
        return lo

    key = sun("Key", (50, 0, -35), 3.5)
    sun("Rim", (60, 0, 160), 2.0)
    me = bpy.data.meshes.new("CompareGround")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=1.2, segments=48)
    bm.to_mesh(me)
    ground = bpy.data.objects.new("CompareGround", me)
    ground.data.materials.append(G.material("CompareGround", "B9AE9C", 0.95))
    scn.collection.objects.link(ground)
    rig.append(ground)
    cd = bpy.data.cameras.new("CompareCam")
    cam = bpy.data.objects.new("CompareCam", cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    rig.append(cam)

    guard = bpy.data.collections["Mossward_Guardian"]
    prop_col = bpy.data.collections["Mossward_ShieldProp"]
    prop = bpy.data.objects["MosswardShield"]
    held = bpy.data.objects["Shield"]
    P = Vector((0, 0, 0.62))  # prop parked at grip height for its own shots
    prop.location = P
    sc = held.location  # held shield grip (world)
    views = [
        # (name, show guardian?, cam loc, look at, lens, key rot or None)
        ("guardian_front", True, (0, -4.2, 0.95), (0, 0, 0.85), 35, None),
        ("guardian_oblique", True, (-1.9, -2.5, 1.45), (-0.15, 0, 0.95), 38, None),
        ("guardian_back", True, (0, 4.2, 0.95), (0, 0, 0.85), 35, None),
        ("guardian_shield_close", True, tuple(sc + Vector((-0.35, -1.25, 0.25))), tuple(sc), 50, None),
        ("prop_front", False, tuple(P + Vector((0, -2.2, 0.1))), tuple(P), 50, None),
        ("prop_oblique", False, tuple(P + Vector((-1.35, -1.65, 0.45))), tuple(P), 50, None),
        ("prop_back", False, tuple(P + Vector((0.4, 2.1, 0.3))), tuple(P), 50, None),
        ("prop_closeup", False, tuple(P + Vector((0.12, -0.75, 0.05))), tuple(P + Vector((0.05, 0, -0.05))), 50, None),
        ("prop_grazing", False, tuple(P + Vector((0, -2.2, 0.1))), tuple(P), 50, (90, 0, -72)),  # key ~18 deg off the face plane
    ]
    out_dir = os.path.join(OUT, "renders")
    os.makedirs(out_dir, exist_ok=True)
    base_key = tuple(key.rotation_euler)
    for name, show_g, loc, look, lens, krot in views:
        guard.hide_render = not show_g
        prop_col.hide_render = show_g
        loc, look = Vector(loc), Vector(look)
        cam.location = loc
        cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
        cd.lens = lens
        key.rotation_euler = [math.radians(a) for a in krot] if krot else base_key
        scn.render.filepath = os.path.join(out_dir, f"{tag}_{name}.png")
        bpy.ops.render.render(write_still=True)
    for o in rig:
        bpy.data.objects.remove(o, do_unlink=True)
    guard.hide_render = prop_col.hide_render = False
    prop.location = (1.5, 0, 1.0)


if __name__ == "__main__":
    m = G.build("mossward", do_render=False)
    if DO_RENDER:
        compare_renders("before" if BASELINE else "after")
        if not BASELINE:  # re-save so the .blend matches the exported state
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(G.ROOT, "assets", "mossward", "mossward.blend"))
