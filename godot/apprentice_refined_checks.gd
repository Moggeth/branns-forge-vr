extends SceneTree
## Headless geometry checks for Copperpot's Promise; no game, service or XR startup.
func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	var failures: Array[String] = []
	var builder = preload("res://apprentice_refined.gd").new()
	for height in [0.48, 0.60]:
		var root := Node3D.new()
		root.name = "Hammer_"+str(height)
		var result: Dictionary = builder.build(root, height)
		if int(result.mesh_count) != 8: failures.append("expected eight batched material meshes at height "+str(height))
		if int(result.triangle_count) <= 0 or int(result.triangle_count) > 5000: failures.append("triangle budget exceeded at height "+str(height))
		var bounds := AABB()
		var found_mesh := false
		for child in root.get_children():
			if child is MeshInstance3D:
				var part := child as MeshInstance3D
				var part_bounds := part.mesh.get_aabb()
				bounds = part_bounds if not found_mesh else bounds.merge(part_bounds)
				found_mesh = true
		if not found_mesh: failures.append("builder returned no meshes at height "+str(height))
		if absf(bounds.position.x+0.2285)>0.0001 or absf(bounds.end.x-0.2285)>0.0001:
			failures.append("hammer face contact width moved at height "+str(height)+": "+str(bounds))
		if bounds.position.y < -0.001 or bounds.end.y > height+0.0851:
			failures.append("hammer exceeds protected height envelope at height "+str(height)+": "+str(bounds))
		if bounds.position.z < -0.1101 or bounds.end.z > 0.1101:
			failures.append("hammer exceeds protected grip depth at height "+str(height)+": "+str(bounds))
		if is_equal_approx(height, 0.48): _check_surface_winding(root, failures)
		print("HAMMER_GEOMETRY height=",height," meshes=",result.mesh_count," triangles=",result.triangle_count," bounds=",bounds)
		root.free()
	if failures.is_empty(): print("APPRENTICE_REFINED PASS heights=0.48,0.60 meshes=8 max_triangles=5000 contact_x=+/-0.2285")
	else:
		for failure in failures: push_error("APPRENTICE_REFINED "+failure)
	quit(1 if not failures.is_empty() else 0)

func _mesh(root: Node3D, part_name: String) -> ArrayMesh:
	var part := root.get_node_or_null("CopperpotPromise_"+part_name) as MeshInstance3D
	return part.mesh as ArrayMesh if part != null else null

func _check_surface_winding(root: Node3D, failures: Array[String]) -> void:
	var steel := _mesh(root,"Steel")
	var cap_counts := {"left":0,"right":0}
	var cap_directions := {"left":0.0,"right":0.0}
	if steel == null:
		failures.append("steel surface is missing")
		return
	var steel_faces := steel.get_faces()
	for i in range(0,steel_faces.size(),3):
		var a: Vector3 = steel_faces[i]
		var b: Vector3 = steel_faces[i+1]
		var c: Vector3 = steel_faces[i+2]
		var normal := (b-a).cross(c-a)
		if is_equal_approx(a.x,-0.2285) and is_equal_approx(b.x,-0.2285) and is_equal_approx(c.x,-0.2285):
			cap_counts.left += 1
			cap_directions.left += normal.x
		if is_equal_approx(a.x,0.2285) and is_equal_approx(b.x,0.2285) and is_equal_approx(c.x,0.2285):
			cap_counts.right += 1
			cap_directions.right += normal.x
	if cap_counts.left != 8 or cap_directions.left <= 0.0:
		failures.append("left steel cap sectors are incomplete or face inward: "+str(cap_counts.left)+" / "+str(cap_directions.left))
	if cap_counts.right != 8 or cap_directions.right >= 0.0:
		failures.append("right steel cap sectors are incomplete or face inward: "+str(cap_counts.right)+" / "+str(cap_directions.right))
	var wood := _mesh(root,"Wood")
	var outward_sum := 0.0
	var side_triangles := 0
	if wood != null:
		var wood_faces := wood.get_faces()
		for i in range(0,wood_faces.size(),3):
			var a: Vector3 = wood_faces[i]
			var b: Vector3 = wood_faces[i+1]
			var c: Vector3 = wood_faces[i+2]
			var center := (a+b+c)/3.0
			var normal := (b-a).cross(c-a)
			if center.y > 0.09 and center.y < 0.20 and center.x > 0.025 and absf(center.z)<0.01:
				outward_sum += normal.x
				side_triangles += 1
	if side_triangles == 0 or outward_sum >= 0.0:
		failures.append("turned shaft winding does not face out under Godot's clockwise convention")
	var stamp := _mesh(root,"Stamp")
	var stamp_z_sum := 0.0
	var stamp_triangles := 0
	if stamp != null:
		var stamp_faces := stamp.get_faces()
		for i in range(0,stamp_faces.size(),3):
			var a: Vector3 = stamp_faces[i]
			var b: Vector3 = stamp_faces[i+1]
			var c: Vector3 = stamp_faces[i+2]
			var normal := (b-a).cross(c-a)
			if absf(a.z-0.109)<0.00001 and absf(b.z-0.109)<0.00001 and absf(c.z-0.109)<0.00001:
				stamp_z_sum += normal.z
				stamp_triangles += 1
	if stamp_triangles == 0 or stamp_z_sum >= 0.0:
		failures.append("maker-mark strokes are backface-culled from their +Z side")
	var copper := _mesh(root,"Copper")
	var exposed_band_triangles := 0
	if copper != null:
		var copper_faces := copper.get_faces()
		for i in range(0,copper_faces.size(),3):
			var center := (copper_faces[i]+copper_faces[i+1]+copper_faces[i+2])/3.0
			if absf(center.x)>0.174 and absf(center.x)<0.201 and center.z>0.104:
				exposed_band_triangles += 1
	if exposed_band_triangles == 0: failures.append("steel cheek lacks an exposed copper collar edge")
	print("HAMMER_WINDING left_cap=",cap_counts.left," right_cap=",cap_counts.right," shaft_samples=",side_triangles," stamp_samples=",stamp_triangles," copper_edge_samples=",exposed_band_triangles)
