extends RefCounted
## Small, bounded ground probes shared by spawning and motion. Height data only
## guides the ray; the current physics collider remains the source of support.
const BODY_MASK := 1 | 8
const ORCHARD_LIMIT := 155.0
const COLLIDER_TOLERANCE := 0.22

static func orchard_height(game, world_point: Vector3) -> float:
	if game.get("landscape") == null or game.landscape.zone_root == null: return NAN
	var land = game.landscape
	if land.model.is_empty(): return NAN
	var local: Vector3 = land.zone_root.to_local(world_point)
	if absf(local.x) > ORCHARD_LIMIT or absf(local.z) > ORCHARD_LIMIT: return NAN
	local.y = land.height_at(Vector2(local.x, local.z))
	return land.zone_root.to_global(local).y

static func floor_hit(game, candidate: Vector3, above: float, below: float,
		minimum_normal: float = 0.7, mask: int = BODY_MASK) -> Dictionary:
	var expected := orchard_height(game, candidate)
	var start_y := candidate.y + above
	var end_y := candidate.y - below
	if is_finite(expected):
		start_y = maxf(start_y, expected + 2.0)
		end_y = minf(end_y, expected - 0.5)
	var query := PhysicsRayQueryParameters3D.create(
		Vector3(candidate.x, start_y, candidate.z), Vector3(candidate.x, end_y, candidate.z), mask)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty() or float(hit.normal.y) < minimum_normal: return {}
	var owner: Node = game._owner(hit.collider)
	if owner == null or owner.get_meta("kind", "") not in ["floor", "solid"]: return {}
	# A stale collider must never certify a newly raised spawn or keep a player
	# walking on the pre-crater surface. Other authored floors stay independent.
	if is_finite(expected) and game.landscape.is_ancestor_of(owner):
		if absf(float(hit.position.y) - expected) > COLLIDER_TOLERANCE: return {}
	return hit

static func clear_capsule(game, feet: Vector3) -> bool:
	return game._player_capsule_clear(feet)
