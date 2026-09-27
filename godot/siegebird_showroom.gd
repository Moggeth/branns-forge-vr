extends RefCounted
## Public orbit asset posed by the same mechanism as the game.
## The runtime GLB deliberately has neutral pivots; it must be initialized before display.
static func build(parent):
	var system=preload("res://siegebird_runtime.gd").new()
	var document=GLTFDocument.new()
	var state=GLTFState.new()
	var error=document.append_from_buffer(FileAccess.get_file_as_bytes(system.ASSEMBLY_PATH),"",state)
	assert(error==OK,"Could not load Siegebird for showroom")
	var model=document.generate_scene(state)
	parent.add_child(model)
	var w={"model":model,"draw":1.0,"angle":0.0,"loaded":true,"release":0.0,"flex":[],"status_text":"READY - SQUEEZE"}
	for binding in [["bolt","Bolt"],["pivot","Crank"],["knob","CrankKnob"],["pinion","Pinion"],["reduction","Reduction"],["drum","Drum"],["clutch","Clutch"],["latch","Latch"],["trigger","Trigger"],["sled","Sled"],["string","LiveCord"]]:
		w[binding[0]]=system.find_part(model,binding[1])
		assert(w[binding[0]]!=null,"Missing showroom mechanism part: "+binding[1])
	for node in model.find_children("*","MeshInstance3D",true,false):
		for i in range(node.get_blend_shape_count()):
			var shape=node.mesh.get_blend_shape_name(i)
			if shape in ["Drawn","Narrow"]: w.flex.append({"node":node,"index":i,"axis":shape})
	system.mechanism(w)
	model.rotation.x=-PI/2
	system.free()
	return model
