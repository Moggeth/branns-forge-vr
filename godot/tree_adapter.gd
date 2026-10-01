extends RefCounted
## Integration adapter: lets the coordinator swap WorldZones.tree() for TreeKit trees
## without touching harvesting, chopping, saving or zone batching.
##
##   const TreeAdapter = preload("res://tree_adapter.gd")
##   # in WorldZones.tree(p, pos, h, pine, apples):
##   #     return TreeAdapter.tree(p, pos, h, pine, apples)
##
## Behaviour by call site:
##  * p is a lumber resource (meta requires == "axe"): the kit builds directly into p
##    (Crown + unit-taper Trunk + ChopProxy) and sets `trunk` / `trunk_mesh` exactly as
##    the old code did. Existing w.body(...) calls after tree() may stay (a second,
##    larger box is harmless) or be removed.
##  * otherwise (decoration in a zone root): a Node3D tree is added under p. Full-size
##    trees receive the same chop contract as timber resources. WorldZones registers
##    them with their zone after all zone dressing has been built. The tree is not a
##    direct MeshInstance3D child, so batch_decorations() does not batch its pieces.
##  * Trees further than FAR_RADIUS (40 m) from the zone origin, or under 2.5 m tall
##    (backdrop islands), use the FAR mesh only; all other
##    decorative trees get a near mesh with an automatic FAR swap at LOD_SWITCH metres.
## Seeds derive from position, so every tree is stable across runs and saves.

const TreeKit = preload("res://tree_kit.gd")
const FAR_RADIUS := 40.0
const LOD_SWITCH := 26.0

static func seed_for(p: Node3D, pos: Vector3) -> int:
	return absi(hash([str(p.name), snappedf(pos.x, 0.1), snappedf(pos.z, 0.1)])) % 1000000

## pickups: how many reach-point apples to leave out of the mesh because
## hanging_apple() will spawn them as harvestable resources (0 = all decorative).
static func tree(p: Node3D, pos: Vector3, h: float, pine: bool = false, apples: bool = false, pickups: int = 0) -> Node3D:
	var species := "pine" if pine else "apple"
	var seed := seed_for(p, p.position + pos)
	var opts := {"height": _kit_height(species, h), "fruit": apples or pine, "pickups": pickups,
		"dynamic_fruit": species == "apple" and h >= 2.5 and pos.length() <= FAR_RADIUS}
	if p.get_meta("requires", "") == "axe":
		TreeKit.adapt_timber(p, species, seed, opts)
		p.set_meta("trunk_material",TreeKit.tree_material())
		return p
	if pos.length() > FAR_RADIUS or h < 2.5:
		opts["lod"] = "far"
		opts["shadows"] = h >= 2.5
	else:
		opts["lod"] = "near"
		opts["lod_switch"] = LOD_SWITCH
	var node := Node3D.new()
	node.name = "Tree_%s_%d" % [species, seed]
	if h >= 2.5:
		TreeKit.adapt_timber(node, species, seed, opts)
		_mark_decorative_timber(node)
	else:
		TreeKit.build_into(node, species, seed, opts)
	node.position = pos
	p.add_child(node)
	return node

## Old tree(h) sizes were whole-tree heights for a stubby primitive; the kit's
## silhouettes read best a little taller. Kept close so sight lines do not change.
static func _kit_height(species: String, h: float) -> float:
	return h * (1.05 if species == "apple" else 1.1)

## Magical fen / deadwood trees for Gloamfen-style zones (same rules as tree()).
static func fen_tree(p: Node3D, pos: Vector3, h: float = 5.2, dead: bool = false) -> Node3D:
	var species := "deadwood" if dead else "fen"
	var seed := seed_for(p, p.position + pos)
	if p.get_meta("requires", "") == "axe":
		TreeKit.adapt_timber(p, species, seed, {"height": h})
		return p
	var node := Node3D.new()
	node.name = "Tree_%s_%d" % [species, seed]
	TreeKit.adapt_timber(node, species, seed, {"height": h, "lod": "far" if pos.length() > FAR_RADIUS else "near", "lod_switch": LOD_SWITCH})
	_mark_decorative_timber(node)
	node.position = pos
	p.add_child(node)
	return node

static func _mark_decorative_timber(node: Node3D) -> void:
	node.set_meta("decorative_timber", true)
	node.set_meta("kind", "resource")
	node.set_meta("resource", "lumber")
	node.set_meta("resource_id", "lumber")
	node.set_meta("requires", "axe")
	node.set_meta("amount", 1)
	node.set_meta("trunk_material", TreeKit.tree_material())
	node.add_to_group("adventure_resource")

## Apple harvest resource hanging at a tree's reach point, created through the game's
## own WorldZones.resource() so meta, groups and data.resources are unchanged.
##   w: the WorldZones script; tree_node: result of tree(); index: reach point 0 or 1.
## Build the tree with tree(..., apples=true, pickups=N) so the mesh omits those fruit.
## Use this for trees that are NOT choppable (a hanging apple on a felled tree would
## float for the 35 s respawn window). For choppable trees keep the ground placement
## and call TreeKit.dress_apple_pickup(node, 3, 0.0) on the old resource node.
static func hanging_apple(w: Script, root: Node3D, data: Dictionary, zone: String, tree_node: Node3D, index: int = 0) -> Node3D:
	var points: Array = tree_node.get_meta("reach_points", [])
	if points.is_empty(): return null
	# Kit trees are never rotated, so root-space position is a sum of translations.
	var root_pos: Vector3 = tree_node.position + points[mini(index, points.size() - 1)]
	var parent := tree_node.get_parent() as Node3D
	while parent != null and parent != root:
		root_pos += parent.position
		parent = parent.get_parent() as Node3D
	var n: Node3D = w.resource(root, data, zone, root_pos, "apple", "", 1)
	n.set_meta("host_tree", tree_node)
	return n
