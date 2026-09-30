extends SceneTree
## Native, save-free dual-view and targeting contract. No Main or service startup.

const View = preload("res://world_builder_view.gd")
const Pip = preload("res://world_builder_pip.gd")
const Targeting = preload("res://world_builder_targeting.gd")
const Spells = preload("res://world_builder_spells.gd")

class GameFixture extends Node3D:
	var vr := false
	var desktop_look = null
	var diagnostic_offline := true

class BuilderFixture extends Node:
	var center := Vector3.ZERO
	var data := {"mana": 20.0, "wood": 20, "forest_spells": [], "groves": [], "meteors": [], "ent_seeds": []}
	func can_path(a: Vector3, b: Vector3) -> String: return "" if a.distance_to(b) >= 3.0 else "Choose a longer route."
	func _inside(_point: Vector3) -> bool: return true

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game := GameFixture.new()
	root.add_child(game)
	var view: Window = View.new()
	view.visible = false
	root.add_child(view)
	view.game = game
	view.companion_mode = true  # fixture never changes the root 3D scale
	view.tactical_viewport = SubViewport.new()
	view.tactical_viewport.size = Vector2i(640, 400)
	view.add_child(view.tactical_viewport)
	view.world_picture = TextureRect.new()
	view.add_child(view.world_picture)
	view.hero_pip = Pip.new()
	view.hero_pip.position = Vector2(400, 80)
	view.hero_pip.size = Vector2(410, 263)
	view.add_child(view.hero_pip)
	view.hero_pip.setup(game.get_viewport().get_texture())
	view._apply_primary_textures()
	if view.world_picture.texture != view.tactical_viewport.get_texture(): failures.append("RTS primary texture")
	if view.hero_pip.picture.texture != game.get_viewport().get_texture(): failures.append("Hero inset texture")
	view.swap_primary()
	if not view.hero_primary: failures.append("swap primary state")
	if view.world_picture.texture != game.get_viewport().get_texture(): failures.append("Hero primary texture")
	if view.hero_pip.picture.texture != view.tactical_viewport.get_texture(): failures.append("RTS inset texture")
	if view.hero_pip.get_children().filter(func(n: Node) -> bool: return n is SubViewport or n is Camera3D).size() != 0:
		failures.append("inset allocated a third renderer")
	var content: Rect2 = view.hero_pip.content_rect_screen()
	if not view.hero_pip.contains_screen_point(content.get_center()): failures.append("inset hit region")
	for entry in Spells.catalogue():
		if bool(entry.get("implemented", true)) and not Targeting.is_targetable(entry): failures.append("missing target plan: " + str(entry.id))
		if not bool(entry.get("implemented", true)) and Targeting.is_targetable(entry): failures.append("unavailable target plan: " + str(entry.id))
	var builder := BuilderFixture.new()
	root.add_child(builder)
	var path: Dictionary = Targeting.plan("path", Vector3.ZERO, Vector3(14, 0, 0), builder, game, "")
	if not path.valid or int(path.cost) != 2 or float(path.width) != 2.0: failures.append("path plan cost or footprint")
	var short_path: Dictionary = Targeting.plan("path", Vector3.ZERO, Vector3(2, 0, 0), builder, game, "")
	if short_path.valid: failures.append("short path was shown as castable")
	var ring: Dictionary = Targeting.spec("ring")
	if float(ring.inner) != 14.0 or float(ring.outer) != 24.0: failures.append("tree ring annulus bounds")
	view.queue_free()
	game.queue_free()
	builder.queue_free()
	await process_frame
	print("WORLD_BUILDER_VIEW_CONTRACT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
