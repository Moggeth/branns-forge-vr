extends SceneTree
## Offline art isolation/budget test. Never loads main, player saves, or challenge persistence.
const Art=preload("res://bankshot_art.gd")
var failures=[]
var counts={"meshes":0,"lights":0,"collisions":0,"triangles":0}
class Challenge extends Node:
	var court:Node3D
	var panel:Node3D
	var target:Node3D
	var medal:Node3D
func _initialize():call_deferred("run")
func check(ok,message):
	if not ok:failures.append(message)
func inspect(node):
	if node is Light3D:counts.lights+=1
	if node is CollisionObject3D or node is CollisionShape3D:counts.collisions+=1
	if node is MeshInstance3D:
		counts.meshes+=1
		counts.triangles+=node.mesh.get_faces().size()/3
		check(node.cast_shadow==GeometryInstance3D.SHADOW_CASTING_SETTING_OFF,"Art must not add shadow casters")
	for child in node.get_children():inspect(child)
func run():
	var game=Node3D.new();root.add_child(game)
	var challenge=Challenge.new();game.add_child(challenge)
	challenge.court=Node3D.new();game.add_child(challenge.court);challenge.court.position=Vector3(165,0,65)
	challenge.panel=Node3D.new();challenge.court.add_child(challenge.panel);challenge.panel.position=Vector3(0,1.65,-4)
	challenge.target=Node3D.new();challenge.court.add_child(challenge.target);challenge.target.position=Vector3(3,1.5,2)
	challenge.medal=Node3D.new();challenge.court.add_child(challenge.medal);challenge.medal.position=Vector3(4.7,1.1,5)
	var art=Art.new();game.add_child(art);art.setup(game,challenge)
	inspect(art.root);inspect(art.target_art);inspect(art.medal_art)
	check(counts.meshes<=22,"Bankshot art must fit twenty-two rendered meshes")
	check(counts.triangles<30000,"Low-poly art triangle budget")
	check(counts.lights==0 and counts.collisions==0,"Art must not change lighting/physics budgets")
	check(art.scenery.get_child_count()<=15,"Static decorations must be material-batched")
	var snapshot=art.debug_snapshot();art.setup(game,challenge)
	check(snapshot==art.debug_snapshot(),"Setup must be idempotent")
	for instance in art.scenery.get_children():
		for vertex in instance.mesh.get_faces():
			var point=instance.transform*vertex
			check(absf(point.x)<=12 and absf(point.z)<=14,"Garden stays within its local bounded backdrop")
			check(not (absf(point.x)<3 and point.z> -3.5 and point.z<8 and point.y>.05),"Central lane remains free of raised static art")
	for destination in [Vector3(3,1.5,2),Vector3(-3,1.8,1),Vector3(2.2,1.3,0)]:
		challenge.target.position=destination
		art.tick(.1)
		check(art.target_art.global_position.is_equal_approx(challenge.target.global_position),"Rim follows challenge target without owning motion")
	challenge.medal.hide();art.tick(.1)
	check(not art.medal_art.is_visible_in_tree(),"Locked medal art inherits hidden reward state")
	challenge.medal.show()
	for i in range(1000):art.tick(.016)
	check(snapshot==art.debug_snapshot(),"Tick cannot grow scene geometry")
	check(absf(art.medal_art.rotation.y)<=.151,"Medal motion stays small")
	challenge.court.hide()
	check(not art.root.is_visible_in_tree() and not art.target_art.is_visible_in_tree(),"Art visibility follows court")
	challenge.target.free();challenge.medal.free();art.tick(.1)
	game.free();await process_frame
	print("BANKSHOT_ART_RESULT ",JSON.stringify(failures)," counts=",JSON.stringify(counts)," snapshot=",JSON.stringify(snapshot))
	quit(0 if failures.is_empty() else 1)
