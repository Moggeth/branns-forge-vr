extends Node3D
## Museum and Bellworks are pocket rooms in the same world group, beyond the playable valley.
const Layout = preload("res://smithy_layout.gd")
var clock := 0.0

func _process(delta: float) -> void:
	clock -= delta
	if clock > 0 or not get_parent_node_3d().is_visible_in_tree(): return
	clock = 0.15
	var camera := get_viewport().get_camera_3d()
	if camera != null:
		var eye := camera.global_position
		visible = Layout.YARD_BOUNDS.grow(42.0).has_point(Vector2(eye.x,eye.z))
