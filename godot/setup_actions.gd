extends SceneTree
func _initialize():
	var actions = OpenXRActionMap.new()
	actions.create_default_action_sets()
	# Current Godot defaults omit legacy Vive wands and Index. Bind both explicitly.
	var set = actions.get_action_set(0)
	for controller in ["htc/vive_controller", "valve/index_controller"]:
		var profile = OpenXRInteractionProfile.new()
		profile.interaction_profile_path = "/interaction_profiles/" + controller
		var bindings = []
		var paths = {"trigger":"input/trigger/value", "trigger_click":"input/trigger/click", "primary":"input/trackpad", "primary_click":"input/trackpad/click", "grip_click":"input/squeeze/click", "default_pose":"input/grip/pose", "grip_pose":"input/grip/pose", "aim_pose":"input/aim/pose", "haptic":"output/haptic"}
		if controller.begins_with("valve"):
			paths["ax_button"]="input/a/click"
			paths["by_button"]="input/b/click"
			paths.erase("grip_click")
			paths["grip"] = "input/squeeze/value"
			paths["primary"] = "input/thumbstick"
			paths["primary_click"] = "input/thumbstick/click"
		for action in set.actions:
			if not paths.has(action.resource_name): continue
			for side in ["left", "right"]:
				var binding = OpenXRIPBinding.new()
				binding.action = action
				binding.binding_path = "/user/hand/" + side + "/" + paths[action.resource_name]
				bindings.append(binding)
		profile.bindings = bindings
		actions.add_interaction_profile(profile)
	var result = ResourceSaver.save(actions, "res://openxr_action_map.tres")
	print("ACTION_MAP saved=", result, " profiles=", actions.get_interaction_profile_count())
	quit(result)
