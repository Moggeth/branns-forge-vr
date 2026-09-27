extends RefCounted
## Personal desktop controls only; deliberately separate from world/progression saves.
const PATH="user://fairy_preferences.cfg"
static func sanitize(values:Dictionary)->Dictionary:
	var clean={}
	var sensitivity=values.get("sensitivity_scale",1.0)
	clean.sensitivity_scale=clampf(float(sensitivity),.2,3.0) if (sensitivity is float or sensitivity is int) and is_finite(float(sensitivity)) else 1.0
	for key in ["third_person","help_visible"]:
		clean[key]=values.get(key,key=="help_visible") if values.get(key,key=="help_visible") is bool else key=="help_visible"
	return clean
static func read(path=PATH)->Dictionary:
	var file=ConfigFile.new()
	var error=file.load(path)
	if error!=OK:
		if error!=ERR_FILE_NOT_FOUND: print("FAIRY_SETTINGS read_failed=",error," defaults=true")
		return sanitize({})
	return sanitize({"sensitivity_scale":file.get_value("controls","sensitivity_scale",1.0),"third_person":file.get_value("controls","third_person",false),"help_visible":file.get_value("controls","help_visible",true)})
static func write(values:Dictionary,path=PATH)->Error:
	var file=ConfigFile.new(); var clean=sanitize(values)
	for key in clean: file.set_value("controls",key,clean[key])
	var error=file.save(path+".tmp")
	if error==OK: error=DirAccess.rename_absolute(path+".tmp",path)
	if error!=OK: print("FAIRY_SETTINGS write_failed=",error)
	return error
