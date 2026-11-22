extends SceneTree
## Compare the actual game materials in two viewports on the same GPU frame.
const Kit = preload("res://portal_kit/portal_kit.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	if DisplayServer.get_name() == "headless":
		push_error("This comparison needs a graphical Godot renderer.")
		quit(1)
		return
	var changes := {}
	var passed := true
	for id in ["sky_garden","cloudbreak_keep","pinewood_ruins","bellworks"]:
		var gate := Kit.create("sky_garden" if id == "bellworks" else id)
		if id == "bellworks":
			gate.pocket_frame = "res://assets/smithy/grounds/fair_gate.glb"
			gate.view_id = "bellworks"
		var holder := Node3D.new()
		root.add_child(holder)
		holder.add_child(gate)
		var veil := gate.find_child("Veil",true,false) as MeshInstance3D
		var dims := veil.mesh.get_aabb()
		var views: Array[SubViewport] = []
		for phase in [0.0,0.64]:
			var view := SubViewport.new()
			view.size = Vector2i(360,400)
			view.own_world_3d = true
			view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			root.add_child(view)
			var surface := MeshInstance3D.new()
			surface.mesh = veil.mesh
			var finish := veil.material_override.duplicate() as ShaderMaterial
			finish.set_shader_parameter("storm_phase",phase)
			finish.set_shader_parameter("lod_detail",1.0)
			surface.material_override = finish
			view.add_child(surface)
			var camera := Camera3D.new()
			view.add_child(camera)
			camera.projection = Camera3D.PROJECTION_ORTHOGONAL
			camera.size = dims.size.y * 1.1
			camera.position = dims.get_center() + Vector3(0,0,2.5)
			camera.current = true
			views.append(view)
		await process_frame
		await RenderingServer.frame_post_draw
		var a := views[0].get_texture().get_image()
		var b := views[1].get_texture().get_image()
		var changed := 0
		var center_changes := 0
		for y in a.get_height():
			for x in a.get_width():
				var delta := a.get_pixel(x,y) - b.get_pixel(x,y)
				if maxf(absf(delta.r),maxf(absf(delta.g),absf(delta.b))) > 0.025:
					changed += 1
					if Vector2(x-180,y-200).length() < 46: center_changes += 1
		var storm_gate: bool = id in ["sky_garden","cloudbreak_keep"]
		passed = passed and (changed >= 30 and changed < 22000 if storm_gate else changed == 0) and center_changes == 0
		changes[id] = {"changed_pixels":changed,"center_changes":center_changes}
		for v in views: v.queue_free()
		holder.queue_free()
	print("PORTAL_STORM_REVIEW ",JSON.stringify({"passed":passed,"captures":changes}))
	quit(0 if passed else 1)
