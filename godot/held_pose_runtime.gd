extends RefCounted
## Only the calibrated socket is filtered. Controllers, HMD, grip buttons,
## climbing deltas and recorded release velocities retain their tracked values.
const Filter = preload("res://held_pose_filter.gd")
var states := {}
var logged_strength := -1.0


func tick(game, delta: float) -> void:
	var strength: float = game.tuning.value("grip.smoothing") if game.tuning != null else 0.65
	if game.vr and strength != logged_strength:
		print("HELD_STEADINESS strength=", strength, " space=tracking max_lag_mm=", 6.0 * strength, " max_lag_degrees=", 0.8 * strength)
		logged_strength = strength
	for hand in game.hands:
		update_hand(game, hand, delta, strength, game.vr and hand.get_is_active())
	for key in states.keys():
		if not is_instance_valid(states[key].hand): states.erase(key)


## Explicit tracking-valid argument also permits save-free deterministic tests
## with real XRController3D nodes, without inventing a live controller tracker.
func update_hand(game, hand: XRController3D, delta: float, strength: float, tracking_valid: bool) -> void:
	var socket: Node3D = game.hand_socket(hand)
	var calibration: Basis = game._hand_basis(hand)
	var item = _held_item(game, hand, socket)
	var key := str(hand.get_instance_id())
	var adjusting: bool = game.grips != null and game.grips.adjusting.has(key)
	if not game.vr or not tracking_valid or strength <= 0.0 or adjusting or not is_instance_valid(item):
		_restore(socket, calibration)
		states.erase(key)
		return
	var target := hand.transform * Transform3D(calibration, Vector3.ZERO)
	if not states.has(key) or states[key].item != item or not states[key].calibration.is_equal_approx(calibration):
		var filter = Filter.new()
		filter.reset(target)
		states[key] = {"hand": hand, "socket": socket, "item": item, "calibration": calibration, "filter": filter, "pose": target}
	var entry: Dictionary = states[key]
	entry.pose = entry.filter.sample(target, delta, mass_for(item, hand), strength)
	# A local transform beneath XRController3D would inherit its next raw pose
	# update and reintroduce jitter. Retain the parent for ownership, not motion.
	socket.set_as_top_level(true)
	socket.global_transform = hand.get_parent().global_transform * entry.pose


func refresh(game) -> void:
	# Reapply rig movement without sampling twice or smoothing locomotion. Snap
	# turns, portals and moving ground must move the hand and item immediately.
	for key in states.keys():
		var entry: Dictionary = states[key]
		if not is_instance_valid(entry.hand) or not is_instance_valid(entry.socket):
			states.erase(key)
			continue
		var item = _held_item(game, entry.hand, entry.socket)
		if not is_instance_valid(item) or item != entry.item:
			update_hand(game, entry.hand, 0.0, game.tuning.value("grip.smoothing"), game.vr and entry.hand.get_is_active())
			continue
		entry.socket.global_transform = entry.hand.get_parent().global_transform * entry.pose


func _restore(socket: Node3D, calibration: Basis) -> void:
	if socket.is_set_as_top_level(): socket.set_as_top_level(false)
	socket.transform = Transform3D(calibration, Vector3.ZERO)


func _held_item(game, hand: Node3D, socket: Node3D):
	var key := str(hand.get_instance_id())
	var item = game.held.get(key)
	if is_instance_valid(item): return item
	# Separately managed props (matches, pouch, tokens, arrows, reel, rings)
	# already use the common socket. The glove itself is never held cargo.
	var visual = hand.get_meta("hand_visual", null)
	for child in socket.get_children():
		if child is Node3D and child != visual: return child
	if game.archery != null and not game.archery.nocked.is_empty() and game.archery.nocked.hand == hand:
		return game.archery.nocked.node
	if game.living != null and game.living.components != null:
		var held_component: Dictionary = game.living.components.held.get(key, {})
		if not held_component.is_empty() and not held_component.climbing:
			return held_component.entry.node
	return null


func mass_for(item: Node3D, hand: Node3D) -> float:
	# Authored mass is preferred. These small fallbacks only set perceived weight;
	# they never change dropped-object physics or weapon damage.
	if item.has_meta("held_mass"): return clampf(float(item.get_meta("held_mass")), 0.05, 20.0)
	if item is RigidBody3D: return item.mass
	if item.has_meta("mass"): return clampf(float(item.get_meta("mass")), 0.05, 20.0)
	if item.has_meta("combat_mass"): return clampf(float(item.get_meta("combat_mass")), 0.05, 20.0)
	if hand.get_meta("archery_arrow", false): return 0.08
	match str(item.get_meta("kind", "")):
		"apple": return 0.16
		"fire_supply": return 0.15
		"hearth_torch": return 0.55
		"ember_vessel": return 0.6
	if item.get_meta("crossbow", false): return 2.4
	if item.get_meta("phoenix_bow", false): return 0.9
	match str(item.get_meta("id", "")):
		"starter_hammer", "apprentice_hammer", "sunfall": return 2.8
		"quarry_pick": return 2.2
		"woodland_axe": return 1.5
	return 1.3
