extends SceneTree
func _initialize():
	var args = OS.get_cmdline_user_args()
	if args.is_empty():
		quit(2)
		return
	var weapon = Node3D.new()
	var shaft = MeshInstance3D.new()
	var cylinder = CylinderMesh.new()
	cylinder.top_radius = 0.035
	cylinder.bottom_radius = 0.045
	cylinder.height = 0.65
	shaft.mesh = cylinder
	shaft.position.y = 0.325
	weapon.add_child(shaft)
	var head = MeshInstance3D.new()
	var box = BoxMesh.new()
	box.size = Vector3(0.4, 0.18, 0.18)
	head.mesh = box
	head.position.y = 0.65
	weapon.add_child(head)
	var material = StandardMaterial3D.new()
	material.albedo_color = Color("75b8cb")
	material.metallic = 0.8
	head.material_override = material
	var document = GLTFDocument.new()
	var state = GLTFState.new()
	var result = document.append_from_scene(weapon, state)
	if result == OK: result = document.write_to_filesystem(state, args[0])
	weapon.free()
	print("TEST_FIXTURE export=", result)
	quit(result)
