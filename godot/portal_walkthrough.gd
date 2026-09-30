extends RefCounted
## A walk-through gateway is a swept player crossing, never a proximity check.
## Main calls tick after locomotion updates the rig and HMD/camera transform.
const HALF_WIDTH=0.55
const BODY_MARGIN=0.12
const HEIGHT_MIN=0.10
const HEIGHT_MAX=2.0
const MAX_STEP=2.5
const MAX_VERTICAL_STEP=1.25
const NEAR_PLANE=0.45
const EXIT_DEPTH=0.65
const COOLDOWN=1.0

var previous_head:=Vector3.INF
var previous_torso:=Vector3.INF
var tracked_zone:=""
var cooldown_remaining:=0.0
var latched_portal_id:=0

func reset(game) -> void:
	if not is_instance_valid(game.camera) or not is_instance_valid(game.rig): return
	previous_head=game.camera.global_position
	previous_torso=_torso(game)
	tracked_zone=str(game.adventure.zone)

func tick(game, delta: float) -> void:
	if not is_instance_valid(game.camera) or not is_instance_valid(game.rig): return
	cooldown_remaining=maxf(0.0,cooldown_remaining-maxf(delta,0.0))
	var head:Vector3=game.camera.global_position
	var torso:Vector3=_torso(game)
	var zone:=str(game.adventure.zone)
	if previous_head==Vector3.INF or zone!=tracked_zone:
		if previous_head!=Vector3.INF and zone!=tracked_zone: cooldown_remaining=maxf(cooldown_remaining,COOLDOWN)
		reset(game)
		return
	if _too_far(previous_head,head) or _too_far(previous_torso,torso):
		reset(game)
		return
	var old_head:=previous_head
	var old_torso:=previous_torso
	previous_head=head
	previous_torso=torso
	if cooldown_remaining>0.0: return
	for portal in game.scene.get("portals",[]):
		if not is_instance_valid(portal) or not portal.is_visible_in_tree(): continue
		if str(portal.get_meta("zone",""))!=zone: continue
		var target:=str(portal.get_meta("target_zone",""))
		if target.is_empty() or target==zone or str(portal.get_meta("action",""))!="travel:"+target: continue
		var id:int=portal.get_instance_id()
		if latched_portal_id==id:
			var local_head:Vector3=portal.to_local(head)
			var local_torso:Vector3=portal.to_local(torso)
			if absf(local_head.z)>EXIT_DEPTH and absf(local_torso.z)>EXIT_DEPTH: latched_portal_id=0
			else: continue
		if not crossed_aperture(portal,old_head,head,old_torso,torso): continue
		latched_portal_id=id
		cooldown_remaining=COOLDOWN
		game.adventure.travel(target)
		reset(game)
		return

static func crossed_aperture(portal: Node3D, old_head: Vector3, head: Vector3, old_torso: Vector3, torso: Vector3) -> bool:
	var head_a:Vector3=portal.to_local(old_head)
	var head_b:Vector3=portal.to_local(head)
	var torso_a:Vector3=portal.to_local(old_torso)
	var torso_b:Vector3=portal.to_local(torso)
	# The torso must cross. A head-only lean can put the HMD through the
	# visual plane while the player is still standing in front of the frame.
	if torso_a.z*torso_b.z>=0.0 or absf(torso_a.z-torso_b.z)<0.0001: return false
	var t:float=torso_a.z/(torso_a.z-torso_b.z)
	if t<0.0 or t>1.0: return false
	var h:Vector3=head_a.lerp(head_b,t)
	var body:Vector3=torso_a.lerp(torso_b,t)
	if absf(h.z)>NEAR_PLANE or absf(body.z)>NEAR_PLANE: return false
	if absf(h.x)>HALF_WIDTH or absf(body.x)>HALF_WIDTH-BODY_MARGIN: return false
	if h.y<HEIGHT_MIN or h.y>HEIGHT_MAX: return false
	if body.y<HEIGHT_MIN or body.y>HEIGHT_MAX: return false
	return true

static func _too_far(before: Vector3, after: Vector3) -> bool:
	return Vector2(after.x-before.x,after.z-before.z).length()>MAX_STEP or absf(after.y-before.y)>MAX_VERTICAL_STEP

static func _torso(game) -> Vector3:
	# Rig origin is at the feet. The HMD supplies the head's actual tracked x/z;
	# the rig supplies the player's body centre so leaning alone cannot travel.
	return game.rig.global_position+Vector3.UP
