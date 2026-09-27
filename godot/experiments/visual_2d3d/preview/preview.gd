extends SceneTree

const PLAYER_SCRIPT = preload("res://experiments/visual_2d3d/preview/player.gd")

func argument(name: String, fallback := "") -> String:
	for item in OS.get_cmdline_user_args():
		if item.begins_with("--" + name + "="):
			return item.substr(name.length() + 3)
	return fallback

func _initialize() -> void:
	call_deferred("start")

func start() -> void:
	var preview = PLAYER_SCRIPT.new()
	preview.name = "ComparisonPreview"
	preview.variant = argument("variant", "E").to_upper()
	preview.scene_path = argument("scene")
	preview.log_path = argument("log")
	preview.smoke = OS.get_cmdline_user_args().has("--smoke")
	root.add_child(preview)
