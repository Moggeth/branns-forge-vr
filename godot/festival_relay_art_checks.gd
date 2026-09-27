extends SceneTree
## Isolated board fixture; never loads main, service or player state.
const Art=preload("res://festival_relay_art.gd")
var failures=[]
var meshes=0
var triangles=0
class Relay extends Node:
	var board:Node3D
	var mode="idle"
	var stage=0
	var timed=false
	var elapsed=0.0
func _initialize():call_deferred("run")
func check(ok,message):
	if not ok:failures.append(message)
func inspect(node,art_root):
	check(not node is Light3D and not node is CollisionObject3D and not node is CollisionShape3D,"Art has no lighting or physics effects")
	check(not node is Label3D,"Core owns all readable status/timer text")
	if node is MeshInstance3D:
		meshes+=1;triangles+=node.mesh.get_faces().size()/3
		check(node.cast_shadow==GeometryInstance3D.SHADOW_CASTING_SETTING_OFF,"No shadow casters")
		for vertex in node.mesh.get_faces():
			var point=art_root.to_local(node.to_global(vertex))
			check(point.x>=-1.25 and point.x<=1.52 and point.y>=.639 and point.y<=.881 and point.z>=.088 and point.z<=.154,"Fits reserved icon strip without covering core labels/buttons")
	for child in node.get_children():inspect(child,art_root)
func run():
	var game=Node3D.new();root.add_child(game)
	var relay=Relay.new();game.add_child(relay)
	relay.board=Node3D.new();game.add_child(relay.board)
	relay.board.position=Vector3(122.5,1.55,72.8);relay.board.rotation.y=PI
	var art=Art.new();game.add_child(art);art.setup(game,relay)
	inspect(art.root,art.root)
	check(meshes<=20 and triangles<7000,"Bounded tiny progress display")
	check(not art.rosette.visible and not art.highlights[0].visible,"Idle does not imply a started or completed run")
	var count=art.debug_snapshot().render_meshes
	art.setup(game,relay);check(count==art.debug_snapshot().render_meshes,"Idempotent setup")
	for timed in [false,true]:
		relay.timed=timed;relay.mode="running"
		for stage in range(3):
			relay.stage=stage;art.tick(.1)
			check(art.debug_snapshot().timed==timed,"Reads actual timed flag")
			for i in range(3):
				check(art.highlights[i].visible==(i==stage),"Only actual current stage emphasized")
				check(art.checks[i].visible==(i<stage),"Only actual completed stages checked")
	relay.mode="complete";art.tick(.1)
	check(art.rosette.visible,"Victory rosette requires real completion")
	for i in range(3):check(art.checks[i].visible and not art.highlights[i].visible,"Completion checks all activities")
	for i in range(1000):art.tick(.016)
	check(count==art.debug_snapshot().render_meshes and absf(art.rosette.rotation.z)<=.076,"Animation is bounded with no node growth")
	check(relay.mode=="complete" and relay.stage==2 and relay.elapsed==0,"Presentation never writes gameplay state")
	relay.mode="idle";art.tick(.1)
	check(not art.rosette.visible,"Abandon/restart idle clears victory decoration")
	relay.board.hide();check(not art.root.is_visible_in_tree(),"Visibility inherits board")
	relay.board.free();art.tick(.1)
	check(art.debug_snapshot().render_meshes==0,"Freed board safely invalidates art")
	game.free();await process_frame
	print("FESTIVAL_RELAY_ART_RESULT ",JSON.stringify(failures)," meshes=",meshes," triangles=",triangles)
	quit(0 if failures.is_empty() else 1)
