import bpy
props = bpy.ops.export_scene.gltf.get_rna_type().properties
for p in props:
    if p.identifier.startswith(("export_anim","export_vertex","export_force","export_frame","export_optimize","export_skins","export_def","export_rest","export_reset","export_all_inf","export_nla","export_bake","export_apply","export_yup","export_image","export_materials","export_cameras","export_lights","use_selection","export_morph","export_leaf","export_hierarchy","export_armature","export_action","export_extra","export_negative","export_active","export_shared","export_texcoords","export_normals","export_attributes","export_tangents","export_merge","export_sampling","export_pointer","export_import_convert","export_gpu")):
        extra = [i.identifier for i in p.enum_items] if p.type=="ENUM" else ""
        print("PROP", p.identifier, p.type, getattr(p,"default",None), extra)
print("VERSION", bpy.app.version_string)
