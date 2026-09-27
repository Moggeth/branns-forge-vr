extends SceneTree
## Standalone offline scene-geometry/lifecycle checks. No player state or renderer needed.
class FakeEncounter extends Node:
	var court: Node3D
	var bells = []
class FakeGame extends Node3D:
	var playful_encounters: FakeEncounter
var failures = []
var counts = {"mesh":0,"collision":0,"light":0}

func _initialize(): call_deferred("run")
func check(condition, message):
	if not condition: failures.append(message)
func inspect(node):
	if node is CollisionObject3D or node is CollisionShape3D: counts.collision += 1
	if node is Light3D: counts.light += 1
	if node is MeshInstance3D:
		counts.mesh += 1
		check(node.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF,"Art must not add shadow casters")
	for child in node.get_children(): inspect(child)

func run():
	var game = FakeGame.new(); root.add_child(game)
	game.playful_encounters = FakeEncounter.new(); game.add_child(game.playful_encounters)
	var encounter = game.playful_encounters
	encounter.court = Node3D.new(); game.add_child(encounter.court); encounter.court.position = Vector3(120,0,65)
	for i in range(4):
		var bell = Node3D.new(); encounter.court.add_child(bell)
		bell.position = Vector3((i-1)*2.7,1.85,-4) if i<3 else Vector3(0,2,-5.8)
		encounter.bells.append(bell)
	var art = load("res://playful_fair_art.gd").new(); game.add_child(art); art.setup(game)
	inspect(art.root)
	check(counts.mesh <= 30,"Scenery must remain within thirty rendered meshes")
	check(counts.collision == 0 and counts.light == 0,"Decoration must add no collisions or lights")
	check(art.static_art.get_child_count() <= 18,"Static scenery must be batched by material")
	check(art.suspensions.size() == 4,"Each bell must have a visible suspension")
	var snapshot = art.debug_snapshot()
	art.setup(game)
	check(snapshot == art.debug_snapshot(),"Repeated setup must be idempotent")
	for i in range(600):
		encounter.bells[3].position = Vector3(sin(float(i)*.03)*3.8,2+cos(float(i)*.04)*.3,-5.8)
		art.tick(1.0/60.0)
		check(absf(art.gold_trolley.position.x-encounter.bells[3].position.x) < .001,"Trolley follows moving gold bell")
		check(art.suspensions[3].cord.transform.is_finite(),"Moving suspension transform must remain finite")
	check(snapshot == art.debug_snapshot(),"Repeated ticks cannot grow geometry")
	encounter.bells[3].hide(); art.tick(.1)
	check(not art.gold_trolley.visible and not art.suspensions[3].root.visible,"Hidden gold trial hides suspension and trolley")
	encounter.bells[0].free(); art.tick(.1)
	check(not art.suspensions[0].root.visible,"Freed bell safely hides hanger")
	for child in art.static_art.get_children():
		var bounds = child.get_aabb()
		check(bounds.position.x >= -15 and bounds.end.x <= 15 and bounds.position.z >= -17 and bounds.end.z <= 17,"Garden backdrop remains local to court")
	game.free(); await process_frame
	print("PLAYFUL_FAIR_ART_RESULT ",JSON.stringify(failures)," counts=",JSON.stringify(counts)," snapshot=",JSON.stringify(snapshot))
	quit(0 if failures.is_empty() else 1)
