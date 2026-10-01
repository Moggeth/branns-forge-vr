extends SceneTree
## Bounded garden art must remain deterministic, nonblocking and terrain/path aware.
const Art = preload("res://ground_garden_art.gd")
const Dressing = preload("res://orchard_dressing.gd")
const Kit = preload("res://ground_kit.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	var first := Node3D.new()
	var second := Node3D.new()
	root.add_child(first)
	root.add_child(second)
	Art.flowers(first,Vector3(12,0,5),35,2.7)
	Art.flowers(second,Vector3(12,0,5),35,2.7)
	if first.get_child_count() != 3: failures.append("garden must use three batches")
	var total := 0
	for i in first.get_child_count():
		var holder: MultiMeshInstance3D = first.get_child(i)
		var repeat: MultiMeshInstance3D = second.get_child(i)
		total += holder.multimesh.instance_count
		if holder.multimesh.mesh != repeat.multimesh.mesh: failures.append("garden meshes are not shared")
		if holder.get_meta("dressing_positions") != repeat.get_meta("dressing_positions"): failures.append("garden layout is not deterministic")
		if not holder.name.begins_with("gk_grass"): failures.append("garden omitted from path/terrain updates")
		if holder.find_children("*","CollisionObject3D",true,false).size() > 0: failures.append("garden blocks movement")
	if total > 40: failures.append("garden budget exceeded")
	Dressing.clear_path(first,Vector3(6,0,5),Vector3(18,0,5))
	var cleared := 0
	for holder in first.get_children():
		for value in holder.get_meta("dressing_hidden"): cleared += value
	if cleared == 0: failures.append("path did not clear garden")
	var anchors := {}
	Kit._anchor_add(anchors,Vector3(12,0,5))
	if Kit._anchor_proximity(anchors,Vector3(12.2,0,5)) < 0.95: failures.append("root influence missing")
	if Kit._anchor_proximity(anchors,Vector3(30,0,5)) != 0: failures.append("root influence leaked")
	first.free()
	second.free()
	print("GROUND_GARDEN_RESULT ",JSON.stringify({"failures":failures,"instances":total,"cleared":cleared}))
	quit(0 if failures.is_empty() else 1)
