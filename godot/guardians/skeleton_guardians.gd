extends Node
## Skeleton Guardians: Mossward, Prismwatch and Cinderkeep shield-bearers.
##
## Integration (see HANDOFF.md for the exact small patches):
##   var guardians = preload("res://guardians/skeleton_guardians.gd").new()
##   game.add_child(guardians); game.guardians = guardians
##   guardians.setup(game)                          # after game.animation.setup(game)
##   guardians.attach(actor, "mossward")            # per skeleton; replaces placeholder art
##   guardians.tick(delta)                          # every frame, AFTER game.animation.tick(delta)
##   damage = guardians.filter_damage(enemy, damage, hand, damage_type)   # top of adventure.hurt_enemy
##   amount = guardians.player_guard(amount, source)                       # top of adventure.take_damage
##   if guardians.trigger(hand, source): return true                       # top of item_interactions.trigger
##   if guardians.grip(hand): return                                       # when an empty hand grips
##
## Rules kept deliberately small and bounded:
## - One shield per guardian lineage. A shield exists either on its owner or as one world item.
##   A respawned guardian only regrows its shield after the old item is gone (despawned).
## - Ghosts are never harmed except by fire damage (Bellows Bash). Everything else skips them.
## - Every shield item carries its own state (variant, lineage, cooldowns) in metas, so it keeps
##   its behaviour after leaving its owner, when stowed, thrown or picked up again.

## Folder holding <variant>/<variant>_guardian.glb. Override before attach() if you move the assets.
var asset_dir := "res://guardians/assets"
const VARIANTS := {
	"mossward": {
		"title": "Mossward shield", "glb": "mossward/mossward_guardian.glb", "shield_glb": "mossward/mossward_shield.glb",
		"mass": 3.0, "front_cos": 0.45, "enemy_mult": {"physical": 0.35, "projectile": 0.5, "fire": 1.0, "blast": 0.7},
		"integrity": 70.0, "player_mult": 0.5, "bash_damage": 20.0, "bash_cooldown": 0.45, "bash_speed": 1.8,
		"secondary": "Rootbeat", "secondary_cooldown": 7.0, "move_mult": 1.0, "color": Color("9cc96b"),
		"box": Vector3(0.655, 1.037, 0.183), "box_center": Vector3(0.0, -0.019, 0.066),
		"rim_grip": Vector3(0.245, 0.0, -0.005), "tip": Vector3(0.0, 0.499, 0.086),
		"controls": "Swing face-first: shield bash\nTrigger: Rootbeat · slow nearby foes + brief guard (7s)\nHold face toward danger: guard halves frontal hits",
	},
	"prismwatch": {
		"title": "Prismwatch shield", "glb": "prismwatch/prismwatch_guardian.glb", "shield_glb": "prismwatch/prismwatch_shield.glb",
		"mass": 3.4, "front_cos": 0.4, "enemy_mult": {"physical": 0.55, "projectile": 0.15, "fire": 1.0, "blast": 0.8},
		"integrity": 60.0, "player_mult": 0.6, "bash_damage": 18.0, "bash_cooldown": 0.5, "bash_speed": 1.8,
		"secondary": "Prism Chime", "secondary_cooldown": 8.0, "move_mult": 1.0, "color": Color("b79af0"),
		"box": Vector3(0.776, 1.232, 0.225), "box_center": Vector3(0.0, 0.0, 0.086),
		"rim_grip": Vector3(0.267, 0.0, -0.005), "tip": Vector3(0.0, 0.563, 0.09),
		"controls": "Swing face-first: shield bash\nTrigger: Prism Chime · stagger skeletons/golems, expose weak spots (8s)\nFace toward shots: deflects projectiles",
	},
	"cinderkeep": {
		"title": "Cinderkeep furnace door", "glb": "cinderkeep/cinderkeep_guardian.glb", "shield_glb": "cinderkeep/cinderkeep_shield.glb",
		"mass": 5.5, "front_cos": 0.35, "enemy_mult": {"physical": 0.25, "projectile": 0.35, "fire": 0.5, "blast": 0.6},
		"integrity": 110.0, "player_mult": 0.3, "bash_damage": 30.0, "bash_cooldown": 0.9, "bash_speed": 1.5,
		"secondary": "Bellows Bash", "secondary_cooldown": 6.0, "move_mult": 0.85, "color": Color("ff9a2e"),
		"box": Vector3(0.744, 0.957, 0.177), "box_center": Vector3(-0.018, 0.0, 0.064),
		"rim_grip": Vector3(0.244, 0.0, -0.005), "tip": Vector3(0.0, 0.478, 0.087),
		"controls": "Heavy · swing face-first: slow crushing bash\nTrigger: Bellows Bash · fire burst ahead, burns ghosts (6s)\nFace toward danger: blocks most frontal melee",
	},
}
const GROUP_JOINTS := {"Head": "head", "Torso": "body", "LeftArm": "arm_l", "RightArm": "arm_r", "LeftLeg": "leg_l", "RightLeg": "leg_r"}
const ITEM_LIFETIME := 150.0  # unclaimed dropped shields return to their lineage after this
const YANK_DISTANCE := 0.28   # metres the hand must pull away from the shield rim
const YANK_WINDOW := 1.4
const MAX_SOUNDS := 6
const SHIELD_HANDLE := Vector3(0.0, 0.0, -0.055)
const PALM_GRIP := Vector3(0.0, -0.045, -0.035)
const SkeletonContact=preload("res://skeleton_projectile_contact.gd")

var game
var guardians := {}   # actor instance id -> record
var items := {}       # shield item instance id -> {"item", "record", "hand_key"}
var tugs := {}        # hand key -> {"record", "start", "at"}
var bash_ready := {}  # item id -> game time
var effects := []     # {"node", "until"}
var sounds := []
var streams := {}

func _exit_tree() -> void:
	for record in guardians.values():
		if is_instance_valid(record.get("template")): record.template.free()

func setup(owner_game) -> void:
	game = owner_game

## Queries use the current weighted skin pose, including knees and feet.
## Each mesh is baked only after a conservative posed bounds check, and at most
## once per rendered frame when several bolts cross the same guardian.
var _authored_query_frame := -1
var _authored_query_cache := {}
func projectile_contact(actor: Node3D, start: Vector3, finish: Vector3) -> Dictionary:
	if game.guardian_authored==null: return {}
	var entry: Dictionary=game.guardian_authored.entries.get(actor.get_instance_id(),{})
	if entry.is_empty() or entry.get("shattered",false) or not entry.visual.is_visible_in_tree(): return {}
	var skeleton: Skeleton3D=entry.get("skeleton")
	if skeleton==null: return {}
	var frame := Engine.get_process_frames()
	if frame != _authored_query_frame:
		_authored_query_frame = frame
		_authored_query_cache.clear()
	var best := {}
	var best_distance := start.distance_squared_to(finish)
	for spec in [["Head","head"],["Torso","rib"],["LeftArm","arm_l"],["RightArm","arm_r"],["LeftLeg","leg_l"],["RightLeg","leg_r"],["Shield","shield"]]:
		var part: String=spec[1]
		if part!="shield" and actor.get_meta("skeleton_missing_"+part,false): continue
		if part=="shield" and str(entry.guardian.get("state",""))!="carried": continue
		var mesh: MeshInstance3D=entry.shield if part=="shield" else (game.guardian_authored._find_mesh(entry.visual,"Torso") if part=="rib" else entry.part_meshes.get(part))
		if not is_instance_valid(mesh) or not mesh.is_visible_in_tree(): continue
		var bone_name: String="LeftArm" if part=="shield" else spec[0]
		var bone: int=int(entry.bones.get(bone_name,-1))
		if bone<0: continue
		var key := str(actor.get_instance_id())+":"+str(mesh.get_instance_id())
		var query: Dictionary=_authored_query_cache.get(key,{})
		if query.is_empty():
			query={"bounds":_posed_mesh_bounds(mesh,skeleton),"surfaces":[]}
			_authored_query_cache[key]=query
		if query.bounds.intersects_segment(start,finish)==null: continue
		if query.surfaces.is_empty():
			var handoff=game.get("skeleton_pose_handoff")
			var transient:=handoff==null
			if handoff==null: handoff=preload("res://skeleton_pose_handoff.gd").new()
			var baked: ArrayMesh=handoff._bake(mesh,skeleton,Transform3D.IDENTITY)
			if transient: handoff.free()
			for surface in range(baked.get_surface_count()):
				query.surfaces.append({"posed":baked.surface_get_arrays(surface),"rest":mesh.mesh.surface_get_arrays(surface)})
		var found: Dictionary=_posed_triangles_contact(query.surfaces,start,finish)
		if found.is_empty(): continue
		var distance:float=start.distance_squared_to(found.position)
		if distance>=best_distance: continue
		best_distance=distance
		var follow_bone := _weighted_hit_bone(mesh,skeleton,found,bone)
		best={"position":found.position,"normal":found.normal,"part":part,"surface":_projectile_attachment(entry,follow_bone)}
	return best

func _posed_mesh_bounds(mesh: MeshInstance3D, skeleton: Skeleton3D) -> AABB:
	var rest: AABB=mesh.mesh.get_aabb()
	var skin: Skin=mesh.skin
	if skin==null: return mesh.global_transform*rest
	var bounds:=AABB()
	var found:=false
	for bind in range(skin.get_bind_count()):
		var name:=skin.get_bind_name(bind)
		var bone:=skeleton.find_bone(name) if name!="" else skin.get_bind_bone(bind)
		if bone<0 or bone>=skeleton.get_bone_count(): continue
		var pose:=skeleton.global_transform*skeleton.get_bone_global_pose(bone)*skin.get_bind_pose(bind)
		var box: AABB=pose*rest
		bounds=bounds.merge(box) if found else box
		found=true
	return bounds if found else mesh.global_transform*rest

func _posed_triangles_contact(surfaces: Array, start: Vector3, finish: Vector3) -> Dictionary:
	var direction:=finish-start
	var best_t:=1.0
	var best:={}
	for surface in range(surfaces.size()):
		var vertices: PackedVector3Array=surfaces[surface].posed[Mesh.ARRAY_VERTEX]
		var indices: PackedInt32Array=surfaces[surface].posed[Mesh.ARRAY_INDEX]
		var count:=indices.size() if not indices.is_empty() else vertices.size()
		for offset in range(0,count-2,3):
			var a:=int(indices[offset]) if not indices.is_empty() else offset
			var b:=int(indices[offset+1]) if not indices.is_empty() else offset+1
			var c:=int(indices[offset+2]) if not indices.is_empty() else offset+2
			var edge1:=vertices[b]-vertices[a]
			var edge2:=vertices[c]-vertices[a]
			var p:=direction.cross(edge2)
			var determinant:=edge1.dot(p)
			if absf(determinant)<0.000001: continue
			var inv_det:=1.0/determinant
			var relative:=start-vertices[a]
			var u:=relative.dot(p)*inv_det
			if u< -0.00001 or u>1.00001: continue
			var q:=relative.cross(edge1)
			var v:=direction.dot(q)*inv_det
			if v< -0.00001 or u+v>1.00001: continue
			var t:=edge2.dot(q)*inv_det
			if t<0.0 or t>best_t: continue
			best_t=t
			best={"position":start+direction*t,"normal":edge1.cross(edge2).normalized(),
				"surface_index":surface,"vertices":[a,b,c],"barycentric":Vector3(1.0-u-v,u,v)}
	return best

func _weighted_hit_bone(mesh: MeshInstance3D, skeleton: Skeleton3D, hit: Dictionary, fallback: int) -> int:
	var skin: Skin=mesh.skin
	if skin==null: return fallback
	var rest: Array=mesh.mesh.surface_get_arrays(int(hit.surface_index))
	var bones: PackedInt32Array=rest[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array=rest[Mesh.ARRAY_WEIGHTS]
	var influences:=8 if mesh.mesh.surface_get_format(int(hit.surface_index)) & Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS else 4
	var scores:={}
	for corner in range(3):
		var vertex:int=hit.vertices[corner]
		for influence in range(influences):
			var slot:=vertex*influences+influence
			if slot>=bones.size() or slot>=weights.size(): continue
			var bind:=bones[slot]
			if bind<0 or bind>=skin.get_bind_count(): continue
			var bone_name:=skin.get_bind_name(bind)
			var bone:=skeleton.find_bone(bone_name) if bone_name!="" else skin.get_bind_bone(bind)
			if bone<0: continue
			scores[bone]=float(scores.get(bone,0.0))+float(hit.barycentric[corner])*weights[slot]
	var best_bone:=fallback
	var best_weight:=0.0
	for bone in scores:
		if float(scores[bone])>best_weight:
			best_bone=bone
			best_weight=scores[bone]
	return best_bone

func _projectile_attachment(entry: Dictionary, bone: int) -> BoneAttachment3D:
	var attachments: Dictionary=entry.get("projectile_attachments",{})
	if attachments.has(bone) and is_instance_valid(attachments[bone]): return attachments[bone]
	var skeleton: Skeleton3D=entry.skeleton
	var attachment:=BoneAttachment3D.new()
	attachment.name="ProjectileContact_"+str(bone)
	attachment.bone_name=skeleton.get_bone_name(bone)
	skeleton.add_child(attachment)
	attachments[bone]=attachment
	entry.projectile_attachments=attachments
	return attachment

# -------------------------------------------------------------------------------- attach / art

## Adds a guardian identity to an already-registered skeleton actor (animation.register ran).
## replace_placeholders frees the procedural skeleton meshes from world_zones.gd.
func attach(actor: Node3D, variant: String, replace_placeholders := true) -> Dictionary:
	assert(VARIANTS.has(variant), "Unknown guardian variant " + variant)
	var rig: Dictionary = game.animation.actors.get(actor.get_instance_id(), {})
	if rig.is_empty():
		game.animation.register(actor)
		rig = game.animation.actors[actor.get_instance_id()]
	var scene: PackedScene = load(asset_dir + "/" + VARIANTS[variant].glb)
	var imported: Node3D = scene.instantiate()
	if replace_placeholders:
		for home in rig.homes:
			if is_instance_valid(home.piece): home.piece.queue_free()
		rig.homes.clear()
		rig.pieces.clear()
	var meshes := {}
	for child in imported.get_children():
		if child is MeshInstance3D: meshes[str(child.name)] = child
	for name in GROUP_JOINTS.keys() + ["Shield"]:
		assert(meshes.has(name), "Guardian GLB is missing " + name)
	# Joints move to the authored pivots so limbs swing about real shoulders/hips.
	for name in GROUP_JOINTS:
		var joint: Node3D = rig.joints[GROUP_JOINTS[name]]
		joint.position = meshes[name].position
	for name in GROUP_JOINTS:
		var joint: Node3D = rig.joints[GROUP_JOINTS[name]]
		var piece := Node3D.new()
		piece.name = name
		joint.add_child(piece)
		piece.transform = joint.transform.affine_inverse() * meshes[name].transform
		var mesh: MeshInstance3D = meshes[name]
		mesh.owner = null
		mesh.get_parent().remove_child(mesh)
		piece.add_child(mesh)
		mesh.transform = Transform3D.IDENTITY
		rig.pieces.append(piece)
		rig.homes.append({"piece": piece, "parent": joint, "transform": piece.transform})
	# The shield rides the left arm but is NOT a rig home: death/restore never duplicate it.
	var shield: MeshInstance3D = meshes["Shield"]
	var arm: Node3D = rig.joints["arm_l"]
	var local_shield: Transform3D = arm.transform.affine_inverse() * shield.transform
	shield.owner = null
	shield.get_parent().remove_child(shield)
	var template: MeshInstance3D = shield.duplicate()
	arm.add_child(shield)
	shield.transform = local_shield
	imported.free()
	var record := {
		"actor": actor, "variant": variant, "rig": rig, "shield": shield, "template": template,
		"shield_local": local_shield, "state": "carried", "item": null, "integrity": float(VARIANTS[variant].integrity),
		"raise": 0.0, "yaw": 0.0, "alive": true, "exposed_until": -100.0, "lineage": "guardian-shield-" + str(actor.get_instance_id()),
	}
	guardians[actor.get_instance_id()] = record
	actor.set_meta("guardian_variant", variant)
	actor.set_meta("guardian_shield", "carried")
	return record

## Returns a fresh, standalone shield prop scene for tooling (not tracked as loot).
func shield_prop(variant: String) -> Node3D:
	return (load(asset_dir + "/" + VARIANTS[variant].shield_glb) as PackedScene).instantiate()

# -------------------------------------------------------------------------------- damage rules

## Call at the start of adventure.hurt_enemy (after the ghost branch). Returns adjusted damage.
func filter_damage(enemy, damage: float, hand = null, damage_type := "physical") -> float:
	var record: Dictionary = guardians.get(enemy.get_instance_id(), {})
	if record.is_empty(): return damage
	var exposed: bool = game.elapsed < float(enemy.get_meta("exposed_until", -100.0))
	if exposed: damage *= 1.5  # Prism Chime weak spot
	# A bolt that actually reached the skull passed above the raised shield.
	if damage_type == "headshot": return damage
	if record.state != "carried" or exposed: return damage
	var source: Vector3 = hand.global_position if hand is Node3D else game.camera.global_position
	if not _is_frontal(record, source): return damage
	var cfg: Dictionary = VARIANTS[record.variant]
	var kind := "projectile" if damage_type == "projectile" else ("fire" if damage_type == "fire" else ("blast" if damage_type == "blast" else "physical"))
	# Frontal blocks stop the fragile-skeleton instakill (melee 999) and scale the rest.
	var blocked := minf(damage, 26.0) * float(cfg.enemy_mult[kind])
	record.integrity -= minf(damage, 26.0) - blocked  # capped: one lethal swing can't shatter it outright
	record.raise = 1.0
	_effect(record.shield.global_position, cfg.color, 0.18, 0.35)
	_sound("clank", record.shield.global_position, -8)
	if record.integrity <= 0.0:
		game._notice("The %s cracks loose!" % cfg.title, 3)
		_release_from_owner(record, (enemy.global_position - source).normalized() * 1.5 + Vector3.UP)
	else:
		game._notice("%s blocks · strike the side or back, or yank the shield rim" % cfg.title.capitalize(), 2)
	return blocked

## Call at the start of adventure.take_damage. Held shields facing the nearest attacker reduce it.
func player_guard(amount: float, _source := "") -> float:
	var attacker = _nearest_enemy(game.camera.global_position, 3.2)
	if attacker == null: return amount
	for item in _held_shields():
		var cfg: Dictionary = VARIANTS[item.get_meta("guardian_variant")]
		var normal: Vector3 = item.global_basis.z.normalized()
		var to_attacker: Vector3 = (attacker.global_position + Vector3.UP - item.global_position).normalized()
		if normal.dot(to_attacker) > float(cfg.front_cos):
			_effect(item.global_position + normal * 0.1, cfg.color, 0.2, 0.4)
			_sound("clank", item.global_position, -6)
			return amount * float(cfg.player_mult)
	return amount

## Optional projectile hook: returns a reflected velocity when a held Prismwatch shield (or any shield)
## faces the shot inside its broad box, otherwise Vector3.ZERO.
func deflect(point: Vector3, velocity: Vector3) -> Vector3:
	for item in _held_shields():
		var cfg: Dictionary = VARIANTS[item.get_meta("guardian_variant")]
		var local: Vector3 = item.to_local(point) - cfg.box_center
		var half: Vector3 = cfg.box * 0.5 + Vector3(0.05, 0.05, 0.15)
		if absf(local.x) > half.x or absf(local.y) > half.y or absf(local.z) > half.z: continue
		var normal: Vector3 = item.global_basis.z.normalized()
		if velocity.normalized().dot(-normal) < 0.3: continue
		var out := velocity.bounce(normal)
		if item.get_meta("guardian_variant") != "prismwatch": out *= 0.4  # blunted, not redirected
		_effect(point, cfg.color, 0.25, 0.3)
		_sound("chime" if item.get_meta("guardian_variant") == "prismwatch" else "clank", point, -10)
		return out
	return Vector3.ZERO

## Player locomotion multiplier while holding the heavy furnace door.
func movement_multiplier() -> float:
	var m := 1.0
	for item in _held_shields(): m = minf(m, float(VARIANTS[item.get_meta("guardian_variant")].move_mult))
	return m

# -------------------------------------------------------------------------------- stealing

## Call when an empty hand presses grip. Returns true if it grabbed a living guardian's shield rim;
## the player must then pull the hand away YANK_DISTANCE within YANK_WINDOW seconds.
func grip(hand) -> bool:
	for record in guardians.values():
		if record.state != "carried" or not _alive(record): continue
		var reach: float = record.shield.global_position.distance_to(hand.global_position)
		if reach > 0.62: continue
		tugs[str(hand.get_instance_id())] = {"record": record, "start": hand.global_position, "at": game.elapsed}
		game.adventure.haptic(hand, "ready")
		game._notice("Grip the rim… now PULL to yank the shield away!", 2)
		return true
	return false

func cancel_grip(hand) -> void:
	tugs.erase(str(hand.get_instance_id()))

## Detaches the shield from a living guardian into a world item (no-op if already gone).
func yank(actor, hand = null) -> Node3D:
	var record: Dictionary = guardians.get(actor.get_instance_id(), {})
	if record.is_empty() or record.state != "carried": return null
	var pull: Vector3 = Vector3.UP * 0.5
	if hand is Node3D: pull = (hand.global_position - record.shield.global_position).normalized() * 2.2 + Vector3.UP * 0.6
	var item := _release_from_owner(record, pull)
	actor.set_meta("slow_until", game.elapsed + 1.5)
	actor.set_meta("combat_phase", "idle")
	_sound("creak", item.global_position, -4)
	game._notice("%s wrenched free! Grip it · %s" % [VARIANTS[record.variant].title.capitalize(), VARIANTS[record.variant].secondary], 4)
	return item

func _release_from_owner(record: Dictionary, velocity: Vector3) -> Node3D:
	if record.state != "carried": return record.item
	var shield: MeshInstance3D = record.shield
	var pose: Transform3D = shield.global_transform
	var body := RigidBody3D.new()
	body.name = "GuardianShield_" + record.variant
	body.collision_layer = 8
	body.collision_mask = 9
	var cfg: Dictionary = VARIANTS[record.variant]
	body.mass = cfg.mass
	body.continuous_cd = true
	body.contact_monitor = true
	body.max_contacts_reported = 4
	var zone_parent: Node = game.adventure.zone_groups.get(str(record.actor.get_meta("zone", game.adventure.zone)), game)
	zone_parent.add_child(body)
	body.global_transform = pose
	shield.get_parent().remove_child(shield)
	body.add_child(shield)
	shield.transform = Transform3D.IDENTITY
	var collider := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = cfg.box
	collider.shape = box
	collider.position = cfg.box_center
	body.add_child(collider)
	body.add_to_group("pickup")
	body.set_meta("kind", "weapon")
	body.set_meta("id", "guardian_shield_" + record.variant)
	body.set_meta("guardian_shield", true)
	# Existing rigid-body pickup/release path freezes the shield while held and
	# restores thrown velocity when released. Our own item table owns its expiry.
	body.set_meta("remains", true)
	body.set_meta("guardian_variant", record.variant)
	body.set_meta("lineage", record.lineage)
	body.set_meta("display_name", cfg.title.capitalize() + " · grip the central handle")
	body.set_meta("use_instructions", cfg.controls)
	body.set_meta("tip", cfg.tip)
	body.set_meta("grip_min", 0.0)
	body.set_meta("grip_max", 0.0)
	# The generic weapon pose lays a shield's +Z blocking face across the palm.
	# These calibrated socket poses keep its central rear handle in the fingers
	# and aim that face away from the player for either tracked hand.
	body.set_meta("grip_preferences", _shield_grip_preferences())
	body.set_meta("rim_grip", cfg.rim_grip)
	body.set_meta("forward", Vector3(0, 0, 1))
	body.set_meta("born", game.elapsed)
	body.set_meta("zone", str(record.actor.get_meta("zone", game.adventure.zone)))
	body.set_meta("alt_ready", 0.0)
	body.linear_velocity = velocity
	body.angular_velocity = Vector3(0.6, 1.2, 0.2)
	body.body_entered.connect(func(other): _thrown_impact(body, other))
	record.state = "loose"
	record.item = body
	record.actor.set_meta("guardian_shield", "loose")
	items[body.get_instance_id()] = {"item": body, "record": record}
	return body

func _shield_grip_preferences() -> Dictionary:
	var poses := {}
	for side_name in ["left_hand", "right_hand"]:
		var side := 1.0 if side_name == "left_hand" else -1.0
		# +Y follows the thumb/haft axis; +Z faces along the index, away from us.
		var basis := Basis(Vector3.UP * side, Vector3.RIGHT * side, Vector3.FORWARD)
		poses[side_name] = Transform3D(basis, PALM_GRIP - basis * SHIELD_HANDLE)
	# DesktopHand is a child of the camera: its local -Z points at the scene.
	var desktop_basis := Basis(Vector3.LEFT, Vector3.UP, Vector3.FORWARD)
	poses["desktop"] = Transform3D(desktop_basis, PALM_GRIP - desktop_basis * SHIELD_HANDLE)
	return poses

func _restore_to_owner(record: Dictionary) -> void:
	var shield: MeshInstance3D = record.template.duplicate()
	record.rig.joints["arm_l"].add_child(shield)
	shield.transform = record.shield_local
	record.shield = shield
	record.state = "carried"
	record.item = null
	record.integrity = float(VARIANTS[record.variant].integrity)
	record.actor.set_meta("guardian_shield", "carried")

# -------------------------------------------------------------------------------- player actions

## Call first in item_interactions.trigger. Returns true when the held item is a guardian shield.
func trigger(hand, source) -> bool:
	var item = game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(item) or not item.get_meta("guardian_shield", false): return false
	var variant: String = item.get_meta("guardian_variant")
	var cfg: Dictionary = VARIANTS[variant]
	if game.elapsed < float(item.get_meta("alt_ready", 0.0)):
		game._notice("%s recharging · %.0fs" % [cfg.secondary, float(item.get_meta("alt_ready")) - game.elapsed], 1.5)
		return true
	item.set_meta("alt_ready", game.elapsed + float(cfg.secondary_cooldown))
	item.set_meta("controls_until", game.elapsed + 4.0)
	match variant:
		"mossward": _rootbeat(item, hand)
		"prismwatch": _prism_chime(item, hand)
		"cinderkeep": _bellows_bash(item, hand, source)
	game.adventure.haptic(hand, "release")
	return true

func _rootbeat(item: Node3D, hand) -> void:
	var ground: Vector3 = Vector3(game.camera.global_position.x, game.rig.global_position.y + 0.03, game.camera.global_position.z)
	var slowed := 0
	for enemy in _living_enemies(ground, 3.4):
		if enemy.get_meta("enemy_type", "") == "ghost": continue
		enemy.set_meta("slow_until", game.elapsed + 2.5)
		slowed += 1
	for rat in game.scene.get("rats", []):
		if is_instance_valid(rat) and rat.is_visible_in_tree() and rat.global_position.distance_to(ground) < 3.4: rat.set_meta("slow_until", game.elapsed + 2.5)
	game.shield_until = maxf(game.shield_until, game.elapsed + 1.2)  # brief physical guard
	_ring(ground, Color("9cc96b"), 3.4, 0.9, 9)
	_sound("thump", ground, 0)
	game._notice("Rootbeat · %d foes slowed, guarded for a moment. Ready in 7s." % slowed, 3)

func _prism_chime(item: Node3D, hand) -> void:
	var center: Vector3 = item.global_position
	var hits := 0
	for enemy in _living_enemies(center, 3.6):
		var type := str(enemy.get_meta("enemy_type", ""))
		if type not in ["skeleton", "golem", "boss"]: continue  # ghosts/wisps unaffected
		enemy.set_meta("combat_phase", "recovery")
		enemy.set_meta("attack_damage_done", true)
		enemy.set_meta("attack_started", game.elapsed - float(enemy.get_meta("attack_windup", 1.2)) - 0.18)
		enemy.set_meta("slow_until", game.elapsed + 1.2)
		enemy.set_meta("exposed_until", game.elapsed + (2.0 if type == "boss" else 3.5))
		if game.animation != null: game.animation.hit(enemy, enemy.global_position - center)
		_effect(enemy.global_position + Vector3.UP * 1.2, Color("8ff3ff"), 3.0, 0.22)
		hits += 1
	_ring(center - Vector3.UP * (center.y - game.rig.global_position.y - 0.05), Color("b79af0"), 3.6, 0.5, 6)
	_effect(center + item.global_basis.z * 0.15, Color("e6ddff"), 0.35, 0.9)
	_sound("chime", center, -2)
	game._notice("Prism Chime · %d staggered, weak spots exposed. Ready in 8s." % hits, 3)

func _bellows_bash(item: Node3D, hand, source) -> void:
	var origin: Vector3 = item.global_position + item.global_basis.z * 0.15
	var forward: Vector3 = item.global_basis.z.normalized()
	forward.y = clampf(forward.y, -0.3, 0.3)
	forward = forward.normalized()
	var hits := 0
	for enemy in _living_enemies(origin, 3.4, true):
		var to: Vector3 = enemy.global_position + Vector3.UP - origin
		if to.normalized().dot(forward) < 0.72: continue
		game.adventure.hurt_enemy(enemy, 28.0, hand, forward * 1.2, "fire")
		enemy.set_meta("slow_until", game.elapsed + 1.0)
		hits += 1
	for rat in game.scene.get("rats", []):
		if is_instance_valid(rat) and rat.is_visible_in_tree():
			var to: Vector3 = rat.global_position - origin
			if to.length() < 3.0 and to.normalized().dot(forward) > 0.72: game._kill_rat(rat)
	for i in range(6):
		var p := origin + forward * (0.35 + i * 0.45)
		_effect(p, Color("ff9a2e") if i % 2 else Color("ffd27a"), 0.35 + i * 0.04, 0.18 + i * 0.07)
	_sound("whoosh", origin, 0)
	game._notice("Bellows Bash · %d scorched. Ready in 6s." % hits, 3)

# -------------------------------------------------------------------------------- tick

## Call once per frame AFTER game.animation.tick(delta).
func tick(delta: float) -> void:
	_tick_guardians(delta)
	_tick_tugs()
	_tick_bash(delta)
	_tick_items()
	for fx in effects.duplicate():
		if not is_instance_valid(fx.node) or game.elapsed > fx.until:
			if is_instance_valid(fx.node): fx.node.queue_free()
			effects.erase(fx)

func _tick_guardians(delta: float) -> void:
	for id in guardians.keys():
		var record: Dictionary = guardians[id]
		var actor = record.actor
		if not is_instance_valid(actor):
			guardians.erase(id)
			continue
		var alive := _alive(record)
		if not alive and record.alive and record.state == "carried":
			# Death: exactly one drop, from the live shield mesh (never a rig home, never duplicated).
			_release_from_owner(record, Vector3.UP * 1.2 + (actor.global_position - game.camera.global_position).normalized() * 0.8)
		# Regrow only when the old item is gone, on respawn or while the player is out of sight range.
		if alive and record.state != "carried" and not is_instance_valid(record.item) and (not record.alive or actor.global_position.distance_to(game.camera.global_position) > 9.0):
			_restore_to_owner(record)
		record.alive = alive
		if not alive or not actor.is_visible_in_tree() or record.state != "carried": continue
		# Guard pose: face the nearest player hand/head, raise when threatened, lower on the enemy windup.
		var arm: Node3D = record.rig.joints["arm_l"]
		var threat: Vector3 = game.camera.global_position
		for hand in game.hands + [game.desktop_hand]:
			if is_instance_valid(hand) and hand.global_position.distance_to(actor.global_position + Vector3.UP) < threat.distance_to(actor.global_position + Vector3.UP): threat = hand.global_position
		var local: Vector3 = actor.to_local(threat)
		var close := clampf(1.0 - (Vector2(local.x, local.z).length() - 0.8) / 1.8, 0.0, 1.0)
		var phase := str(actor.get_meta("combat_phase", "idle"))
		var target_raise := close * (0.35 if phase == "windup" else 1.0)
		if game.elapsed < float(actor.get_meta("exposed_until", -100.0)): target_raise = 0.0
		record.raise = lerpf(record.raise, target_raise, clampf(delta * (4.0 if record.variant != "cinderkeep" else 2.5), 0, 1))
		record.yaw = lerpf(record.yaw, clampf(atan2(local.x, local.z), -0.6, 0.35), clampf(delta * 5.0, 0, 1))
		# Overrides the walk swing so the arm and shield stay coherent.
		arm.rotation = Vector3(arm.rotation.x * (1.0 - record.raise) * 0.3 - record.raise * 0.35, record.yaw * record.raise, -record.raise * 0.12)
		var head: Node3D = record.rig.joints["head"]
		if record.variant == "mossward" and close > 0.4: head.rotation.z += sin(game.elapsed * 31.0) * 0.025 * close  # nervous rattle
		elif record.variant == "prismwatch": head.rotation.z += 0.18 * (1.0 - close)  # curious tilt

func _tick_tugs() -> void:
	for key in tugs.keys():
		var tug: Dictionary = tugs[key]
		var hand = _hand_by_key(key)
		if hand == null or tug.record.state != "carried" or game.elapsed - float(tug.at) > YANK_WINDOW:
			tugs.erase(key)
			continue
		if hand.global_position.distance_to(tug.start) > YANK_DISTANCE:
			tugs.erase(key)
			yank(tug.record.actor, hand)
			game.adventure.haptic(hand, "impact")

func _tick_bash(delta: float) -> void:
	for key in game.held:
		var item = game.held[key]
		if not is_instance_valid(item) or not item.get_meta("guardian_shield", false): continue
		var cfg: Dictionary = VARIANTS[item.get_meta("guardian_variant")]
		var hand = game.grips.grips.get(key, {}).get("hand", game.desktop_hand)
		var velocity: Vector3 = game.adventure.motion.get(str(hand.get_instance_id()), {}).get("velocity", Vector3.ZERO)
		if item.get_meta("controls_until", 0.0) < game.elapsed and item.get_meta("controls_shown", false) == false:
			item.set_meta("controls_until", game.elapsed + 5.0)
			item.set_meta("controls_shown", true)
		var normal: Vector3 = item.global_basis.z.normalized()
		var speed := velocity.length()
		if speed < float(cfg.bash_speed) or velocity.normalized().dot(normal) < 0.55: continue
		if game.elapsed < float(bash_ready.get(item.get_instance_id(), 0.0)): continue
		var face: Vector3 = item.to_global(cfg.box_center + Vector3(0, 0, cfg.box.z * 0.5))
		var struck := false
		for enemy in _living_enemies(face, 1.2):
			if (enemy.global_position + Vector3.UP).distance_to(face) > 0.9: continue
			if enemy.get_meta("enemy_type", "") == "ghost":
				game._notice("The shield passes through · only fire harms ghosts.", 2)
				continue
			game.adventure.hurt_enemy(enemy, float(cfg.bash_damage) * clampf(speed / 3.0, 0.7, 1.4), hand, normal * minf(speed, 4.0) * 0.5, "physical")
			enemy.set_meta("slow_until", game.elapsed + 0.8)
			struck = true
		for rat in game.scene.get("rats", []):
			if is_instance_valid(rat) and rat.is_visible_in_tree() and rat.global_position.distance_to(face) < 0.6: game._kill_rat(rat); struck = true
		for dummy in game.scene.get("dummies", []):
			if dummy.global_position.distance_to(face) < 0.9: game._dummy_hit(dummy); struck = true
		if struck:
			bash_ready[item.get_instance_id()] = game.elapsed + float(cfg.bash_cooldown)
			game.adventure.haptic(hand, "impact")
			_effect(face, cfg.color, 0.2, 0.45)
			_sound("clank", face, -3)

## Mouse players cannot swing a tracked hand. A deliberate click uses the same
## shield damage/cooldown, while VR continues to require a physical face-first bash.
func desktop_bash(hand: Node3D, source: Node3D) -> bool:
	var item = game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(item) or not item.get_meta("guardian_shield", false): return false
	var cfg: Dictionary = VARIANTS[item.get_meta("guardian_variant")]
	if game.elapsed < float(bash_ready.get(item.get_instance_id(), 0.0)): return true
	bash_ready[item.get_instance_id()] = game.elapsed + float(cfg.bash_cooldown)
	var hit: Dictionary = game._ray(source, 2.8)
	var target = game._owner(hit.collider) if hit.has("collider") else null
	if target != null:
		match str(target.get_meta("kind", "")):
			"enemy":
				if target.get_meta("enemy_type", "") == "ghost": game._notice("The shield passes through · only fire harms ghosts.", 2)
				else:
					game.adventure.hurt_enemy(target, float(cfg.bash_damage), hand, -source.global_basis.z * 1.5, "physical")
					target.set_meta("slow_until", game.elapsed + 0.8)
			"rat": game._kill_rat(target)
			"dummy": game._dummy_hit(target)
	var face: Vector3 = item.to_global(cfg.box_center + Vector3(0, 0, cfg.box.z * 0.5))
	_effect(face, cfg.color, 0.2, 0.35)
	_sound("clank", face, -7)
	game.adventure.haptic(hand, "impact")
	return true

func _tick_items() -> void:
	for id in items.keys():
		var entry: Dictionary = items[id]
		var item = entry.item
		if not is_instance_valid(item):
			items.erase(id)
			continue
		if _protected(item):
			item.set_meta("born", game.elapsed)
			continue
		var active: bool = str(item.get_meta("zone", "")) == game.adventure.zone
		item.visible = active
		item.freeze = not active
		if game.elapsed - float(item.get_meta("born", 0.0)) > ITEM_LIFETIME or item.global_position.y < -20:
			item.queue_free()  # the lineage may regrow its shield on the next respawn
			items.erase(id)

func _thrown_impact(body: RigidBody3D, other) -> void:
	if not is_instance_valid(body) or body.freeze or not body.get_meta("player_thrown", false): return
	if body.linear_velocity.length() < 2.5 or game.elapsed < float(body.get_meta("damage_at", 0.0)): return
	var target = game._owner(other)
	if target == null or target.get_meta("kind", "") != "enemy" or target.get_meta("enemy_type", "") == "ghost": return
	body.set_meta("damage_at", game.elapsed + 0.5)
	game.adventure.hurt_enemy(target, clampf(body.linear_velocity.length() * body.mass * 1.5, 8.0, 30.0), null, body.linear_velocity.normalized() * 0.8)

# -------------------------------------------------------------------------------- helpers

func _alive(record: Dictionary) -> bool:
	return is_instance_valid(record.actor) and bool(record.actor.get_meta("alive", true))

func _is_frontal(record: Dictionary, source: Vector3) -> bool:
	var actor: Node3D = record.actor
	var to: Vector3 = source - actor.global_position
	to.y = 0
	var forward: Vector3 = actor.global_basis.z
	forward.y = 0
	return to.length() > 0.01 and forward.normalized().dot(to.normalized()) > float(VARIANTS[record.variant].front_cos)

func _held_shields() -> Array:
	var out := []
	for key in game.held:
		var item = game.held[key]
		if is_instance_valid(item) and item.get_meta("guardian_shield", false) and item not in out: out.append(item)
	return out

func _protected(item) -> bool:
	return item in game.held.values() or (game.grips != null and game.grips.is_stowed(item))

func _living_enemies(point: Vector3, radius: float, include_ghosts := false) -> Array:
	var out := []
	for enemy in game.scene.get("enemies", []):
		if not is_instance_valid(enemy) or not enemy.get_meta("alive", true) or not enemy.is_visible_in_tree(): continue
		if not include_ghosts and enemy.get_meta("enemy_type", "") == "ghost": continue
		if (enemy.global_position + Vector3.UP * 0.9).distance_to(point) < radius + 0.6: out.append(enemy)
	return out

func _nearest_enemy(point: Vector3, radius: float):
	var best = null
	var best_d := radius
	for enemy in _living_enemies(point, radius, true):
		var d: float = (enemy.global_position + Vector3.UP).distance_to(point)
		if d < best_d: best_d = d; best = enemy
	return best

func _hand_by_key(key: String):
	for hand in game.hands + [game.desktop_hand]:
		if is_instance_valid(hand) and str(hand.get_instance_id()) == key: return hand
	return null

func _effect(point: Vector3, color: Color, seconds: float, size: float) -> void:
	if game.has_method("_effect"): game._effect(point, color, seconds, size)

func _ring(center: Vector3, color: Color, radius: float, seconds: float, leaves: int) -> void:
	var node := Node3D.new()
	game.add_child(node)
	node.global_position = center
	var ring := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.2
	torus.outer_radius = 0.28
	torus.rings = 24
	torus.ring_segments = 6
	ring.mesh = torus
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(color, 0.7)
	ring.material_override = mat
	node.add_child(ring)
	for i in range(leaves):
		var leaf := MeshInstance3D.new()
		var quad := SphereMesh.new()
		quad.radius = 0.06
		quad.height = 0.03
		leaf.mesh = quad
		leaf.material_override = mat
		leaf.position = Vector3(cos(i * TAU / leaves), 0.05, sin(i * TAU / leaves)) * 0.3
		node.add_child(leaf)
	var tween := node.create_tween()
	tween.set_parallel(true)
	tween.tween_property(node, "scale", Vector3(radius / 0.28, 1, radius / 0.28), seconds).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(mat, "albedo_color:a", 0.0, seconds)
	effects.append({"node": node, "until": game.elapsed + seconds + 0.1})

func _sound(kind: String, point: Vector3, db: float) -> void:
	if game.diagnostic_offline or DisplayServer.get_name() == "headless" or game.tuning.value("audio.volume") <= 0: return
	sounds = sounds.filter(func(p): return is_instance_valid(p))
	if sounds.size() >= MAX_SOUNDS: return
	if not streams.has(kind): streams[kind] = _synth(kind)
	var player := AudioStreamPlayer3D.new()
	game.add_child(player)
	player.global_position = point
	player.stream = streams[kind]
	player.max_distance = 14
	player.volume_db = linear_to_db(game.tuning.value("audio.volume")) - 10 + db
	player.finished.connect(player.queue_free)
	sounds.append(player)
	player.play()

## Small synthesized cues: no external audio files.
func _synth(kind: String) -> AudioStreamWAV:
	var rate := 22050
	var seconds: float = {"thump": 0.45, "chime": 0.9, "whoosh": 0.6, "clank": 0.25, "creak": 0.4}[kind]
	var count := int(rate * seconds)
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(kind)
	var lp := 0.0
	for i in range(count):
		var t := float(i) / rate
		var v := 0.0
		match kind:
			"thump": v = sin(t * TAU * (70.0 - t * 60.0)) * exp(-t * 7.0) + rng.randf_range(-1, 1) * 0.15 * exp(-t * 30.0)
			"chime": v = (sin(t * TAU * 1318.5) + 0.6 * sin(t * TAU * 1975.5) + 0.35 * sin(t * TAU * 2637.0)) * exp(-t * 4.5) * 0.45
			"whoosh":
				lp = lerpf(lp, rng.randf_range(-1, 1), 0.12 + 0.2 * sin(t / seconds * PI))
				v = lp * sin(t / seconds * PI) * 1.6 + rng.randf_range(-1, 1) * 0.1 * float(rng.randf() < 0.02)
			"clank": v = (sin(t * TAU * 610.0) * 0.5 + sin(t * TAU * 1480.0) * 0.3 + rng.randf_range(-1, 1) * 0.4) * exp(-t * 22.0)
			"creak": v = sin(t * TAU * (180.0 + 40.0 * sin(t * 30.0))) * (0.5 + 0.5 * float(int(t * 60) % 3 == 0)) * exp(-t * 4.0) * 0.6
		bytes.encode_s16(i * 2, int(clampf(v, -1, 1) * 20000))
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = rate
	stream.data = bytes
	return stream

## Tooltip text for UI (item_interactions shows `use_instructions` while controls_until is in the future).
static func controls_text(variant: String) -> String:
	return VARIANTS[variant].controls

## Debug/save snapshot: every lineage and where its single shield currently is.
func snapshot() -> Array:
	var out := []
	for record in guardians.values():
		out.append({"lineage": record.lineage, "variant": record.variant, "state": record.state, "integrity": record.integrity,
			"item_alive": is_instance_valid(record.item), "held": is_instance_valid(record.item) and _protected(record.item)})
	return out
