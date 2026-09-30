extends "res://physical_lumber_log.gd"
## Uses the existing E/grip tether and physics pickup; settlement wood was credited at death.

func setup(owner_game: Node, resource: Node3D, owner_felling: Node) -> void:
	super.setup(owner_game, resource, owner_felling)
	set_meta("ent_key", resource.get_meta("ent_key", ""))
	set_meta("ent_credited", true)
	mass = 4.0
	for child in get_children():
		if child is Node3D and not child is CollisionShape3D: child.queue_free()
	var trunk: Mesh = resource.get_meta("trunk_mesh", null)
	if trunk != null:
		var visual := MeshInstance3D.new()
		visual.name = "OriginalEntTimber"
		visual.mesh = trunk
		visual.material_override = resource.get_meta("trunk_material", null)
		visual.scale = Vector3.ONE * 0.42
		add_child(visual)

func _claim() -> void:
	if claiming: return
	claiming = true
	# The idempotent Ent death ledger already awarded this exact tree's timber.
	game._notice("Ent timber secured · settlement stockpile already credited.", 3)
	queue_free()
