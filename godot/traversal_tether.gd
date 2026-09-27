extends RefCounted
## Reusable bounded traversal attachment; uses the game's existing capsule sweep.
var game
var state={}
var rope:MeshInstance3D
func setup(g):
	game=g; rope=MeshInstance3D.new(); rope.mesh=BoxMesh.new(); rope.material_override=WorkshopScene.material("d9ba83"); game.add_child(rope); rope.hide()
func attach(item,hit)->bool:
	if not hit.get("collider") is StaticBody3D: return false
	var target=game._owner(hit.collider)
	if target!=null and str(target.get_meta("kind","")) in ["enemy","rat","weapon","button","dummy"]: return false
	var goal:Vector3=hit.position+hit.normal*0.5-Vector3.UP*0.9
	var landing=hit.normal.y>0.7
	if landing: goal=hit.position+Vector3.UP*0.04
	if target!=null and target.get_meta("kind","")=="anchor": goal=target.get_meta("destination",goal); landing=true
	var landing_goal=goal
	# Approach a high hook at hook height before descending onto its landing.
	# A low diagonal towards the floor catches the island's parapet instead.
	if landing: goal.y=maxf(goal.y+1.0,hit.position.y-0.9)
	state={"landing_goal":landing_goal,"approach":landing,"item":item,"anchor":hit.collider,"local":hit.collider.to_local(hit.position),"goal":goal,"point":hit.position,"zone":game.adventure.zone,"landing":landing}
	game.item_actions.falling=false; return true
func detach(fall=true):
	state.clear(); rope.hide(); game.item_actions.falling=fall; game.adventure.motion.clear(); game.tuning.history.clear()
func valid()->bool:
	return not state.is_empty() and is_instance_valid(state.item) and is_instance_valid(state.anchor) and state.anchor.is_visible_in_tree() and state.item in game.held.values() and state.zone==game.adventure.zone
func tick(origin:Vector3):
	if state.is_empty(): return
	if not valid(): detach(state.get("zone")==game.adventure.zone); return
	state.point=state.anchor.to_global(state.local)
	var line:Vector3=state.point-origin
	rope.global_position=(origin+state.point)*0.5
	if line.length()>0.02:
		rope.look_at(state.point,Vector3.RIGHT if absf(line.normalized().dot(Vector3.UP))>0.98 else Vector3.UP)
		rope.scale=Vector3(0.014,0.014,line.length()); rope.show()
func reel(distance:float)->float:
	if not valid(): return 0.0
	var offset:Vector3=game.camera.global_position-game.rig.global_position
	var difference:Vector3=state.goal-Vector3(offset.x,0,offset.z)-game.rig.global_position
	if difference.length()<0.08:
		if state.get("approach",false): state.goal=state.landing_goal; state.approach=false; return 1.0
		if state.landing: detach(false); game._notice("Landing reached. Grapple released.")
		return 0.0
	return game.item_actions.move_rig(difference.limit_length(distance))
