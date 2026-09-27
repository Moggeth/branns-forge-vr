extends SceneTree
var world:Node3D
var camera:Camera3D
var model:Node3D
var output=""
func _initialize(): run.call_deferred()
func run():
 root.size=Vector2i(1500,1200); root.content_scale_size=Vector2i(1500,1200); root.msaa_3d=Viewport.MSAA_4X
 world=Node3D.new(); root.add_child(world)
 var env=WorldEnvironment.new(); world.add_child(env); env.environment=Environment.new(); env.environment.background_mode=Environment.BG_COLOR; env.environment.background_color=Color("17232c"); env.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR; env.environment.ambient_light_color=Color("a6c2d1"); env.environment.ambient_light_energy=.7; env.environment.tonemap_mode=Environment.TONE_MAPPER_FILMIC
 var sun=DirectionalLight3D.new(); world.add_child(sun); sun.rotation_degrees=Vector3(-35,-35,0); sun.light_energy=2.1; sun.shadow_enabled=true
 var rim=OmniLight3D.new(); world.add_child(rim); rim.position=Vector3(-1,1,-.7); rim.light_color=Color("89cfff"); rim.light_energy=3; rim.omni_range=4
 var warm=OmniLight3D.new(); world.add_child(warm); warm.position=Vector3(1,.8,1); warm.light_color=Color("ffc68a"); warm.light_energy=1.2
 camera=Camera3D.new(); world.add_child(camera); camera.projection=Camera3D.PROJECTION_ORTHOGONAL; camera.size=1.2; camera.current=true
 var floor=MeshInstance3D.new(); world.add_child(floor); var mesh=CylinderMesh.new(); mesh.top_radius=.58; mesh.bottom_radius=.60; mesh.height=.08; floor.mesh=mesh; floor.position=Vector3(.08,-.10,0); var mat=StandardMaterial3D.new(); mat.albedo_color=Color("273b41"); mat.roughness=.65; floor.material_override=mat
 output=ProjectSettings.globalize_path("user://reviews/atelier")
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--capture-output="): output=arg.trim_prefix("--capture-output=")
 DirAccess.make_dir_recursive_absolute(output)
 var stats={}
 var specimens={"orchid-before":"res://hero_axe.gd","hammer-before":"legacy"}
 for pair in [["orchid-refined","res://orchid_refined.gd"],["hammer-refined","res://apprentice_refined.gd"],["glowmoth","res://glowmoth.gd"],["stormbell","res://stormbell.gd"]]:
  if ResourceLoader.exists(pair[1]) and ("--"+pair[0]) in OS.get_cmdline_user_args(): specimens[pair[0]]=pair[1]
 for title in specimens:
  model=Node3D.new(); world.add_child(model)
  if specimens[title]=="legacy":
   var builder=load("res://workshop_details.gd")
   if builder.has_method("hammer_legacy"): builder.hammer_legacy(model)
   else: builder.hammer(model)
  else:
   var builder=load(specimens[title]).new(); builder.build(model)
   if builder is Node: builder.free()
  var nodes=model.find_children("*","MeshInstance3D",true,false); var surfaces=0; var triangles=0
  for n in nodes:
   surfaces+=n.mesh.get_surface_count(); triangles+=n.mesh.get_faces().size()/3
  stats[title]={"meshes":nodes.size(),"surfaces":surfaces,"triangles":triangles}
  for angle in range(3):
   camera.position=[Vector3(1.1,.82,2),Vector3(-1,.8,-2),Vector3(.1,1.8,1.5)][angle]; camera.look_at(Vector3(.10,.38,0))
   for i in range(4): await process_frame
   await RenderingServer.frame_post_draw
   root.get_texture().get_image().save_png(output+"/"+title+"-"+str(angle)+".png")
  model.queue_free(); await process_frame
 var file=FileAccess.open(output+"/geometry.json",FileAccess.WRITE); file.store_string(JSON.stringify(stats,"  ")); file.close()
 print("ATELIER_CAPTURE_COMPLETE ",specimens.keys()); quit()
