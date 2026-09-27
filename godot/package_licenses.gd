extends SceneTree
func _initialize():
	var folder=""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--output="): folder=arg.trim_prefix("--output=")
	if folder.is_empty(): quit(1); return
	var file=FileAccess.open(folder.path_join("GODOT-LICENSES.txt"),FileAccess.WRITE)
	if file==null: quit(1); return
	file.store_string("Godot Engine\n\n"+Engine.get_license_text()+"\n\nThird-party notices\n")
	for part in Engine.get_copyright_info():
		file.store_string("\n"+str(part)+"\n")
	for name in Engine.get_license_info(): file.store_string("\n"+name+"\n"+Engine.get_license_info()[name]+"\n")
	file.close(); print("PACKAGING_LICENSE_READY"); quit()
