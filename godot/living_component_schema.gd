extends RefCounted
## Generated capability document is pinned to engine version one, never supplied by a package.
static func validate(package:Dictionary)->Array:
	var errors=[]; var schema=JSON.parse_string(FileAccess.get_file_as_string("res://living_capabilities.json"))
	var entities=package.get("entities",[])
	if not entities is Array or entities.size()>64: return ["Invalid entity array or budget"]
	var ids={}; var bodies=0; var projectiles={}
	for entity in entities:
		if not entity is Dictionary: errors.append("Entity must be an object"); continue
		var id=entity.get("id","")
		if not id is String or id.is_empty() or ids.has(id): errors.append("Missing or duplicate entity id"); continue
		ids[id]=true
		if not _vector(entity.get("position"),-2000,2000) or not _vector(entity.get("size"),.015,128): errors.append("Invalid entity dimensions")
		if entity.get("shape","") not in ["box","sphere","cylinder"]: errors.append("Unsupported shape")
		if not entity.get("color","") is String or not Color.html_is_valid(entity.get("color","")): errors.append("Invalid entity color")
		if not entity.get("static",true) is bool: errors.append("Invalid body mode")
		var components=entity.get("components",[]); var types={}
		if not components is Array or components.size()>16: errors.append("Invalid component list"); continue
		for c in components:
			if not c is Dictionary: errors.append("Component must be an object"); continue
			var type=c.get("type","")
			if not schema.components.has(type) or types.has(type) or c.get("version",1)!=1: errors.append("Unknown, duplicate or unsupported component "+str(type)); continue
			types[type]=true
			_config(c.get("config",{}),schema.components[type].config,errors,str(type))
			if type=="reservoir" and c.get("config",{}) is Dictionary:
				var cfg=c.config
				if _number(cfg.get("amount",0),0,100) and _number(cfg.get("capacity",10),.1,100) and cfg.get("amount",0)>cfg.get("capacity",10): errors.append("Reservoir exceeds capacity")
		if not entity.get("static",true) or types.has("grabbable"): bodies+=1
		if types.has("returning_projectile"):
			projectiles[id]=true
			if not types.has("grabbable"): errors.append("Returning projectile requires grabbable")
			if _vector(entity.get("size"),.015,128) and entity.size.any(func(v):return v>1): errors.append("Returning projectile exceeds size limit")
			for forbidden in ["grapple","climbable","maker","portal","creature","field"]:
				if types.has(forbidden): errors.append("Returning projectile has incompatible movement component")
			for c in components:
				if not c is Dictionary or not c.get("config",{}) is Dictionary: continue
				if c.get("type")=="grabbable" and _number(c.config.get("mass",1),.05,20) and c.config.get("mass",1)>3: errors.append("Returning projectile exceeds mass limit")
				if c.get("type")=="returning_projectile" and c.config.has("hitEvent") and not _event(c.config.hitEvent,schema): errors.append("Unknown returning projectile hit event")
	if bodies>16: errors.append("Dynamic body budget exceeded")
	var links=package.get("links",[])
	if not links is Array or links.size()>96: errors.append("Invalid links"); return errors
	for link in links:
		if not link is Dictionary: errors.append("Invalid link"); continue
		if link.get("type","") not in schema.links.types or not ids.has(link.get("from","")) or not ids.has(link.get("to","")): errors.append("Unresolved or unsupported link")
		_config(link.get("config",{}),schema.links.config,errors,"link")
		if link.get("type","") in ["hinge","tether"] and (projectiles.has(link.get("from","")) or projectiles.has(link.get("to",""))): errors.append("Returning projectile cannot have a physical link")
	var rules=package.get("rules",[]); var count=0
	if not rules is Array or rules.size()>64: errors.append("Invalid rules"); return errors
	for rule in rules:
		if not rule is Dictionary: errors.append("Invalid rule"); continue
		if not _event(rule.get("event",""),schema) or (not ids.has(rule.get("target","")) and rule.get("target","")!="*"): errors.append("Unknown event or rule target")
		var actions=rule.get("actions",[])
		if not actions is Array or actions.size()>16: errors.append("Invalid action array"); continue
		for action in actions:
			count+=1
			if not action is Dictionary or not schema.actions.has(action.get("op","")): errors.append("Unknown rule operation"); continue
			var op=action.op
			if not ids.has(action.get("target","")): errors.append("Unresolved action target")
			for key in action:
				if key not in ["op","target"] and key not in schema.actions[op]: errors.append("Unsupported action field "+str(key))
			if action.has("value") and not _number(action.value,0,100): errors.append("Invalid action value")
			if action.has("vector") and not _vector(action.vector,.05 if op=="scale" else -25,10 if op=="scale" else 25): errors.append("Invalid action vector")
			if action.has("color") and (not action.color is String or not Color.html_is_valid(action.color)): errors.append("Invalid action color")
			if action.has("signal") and (not action.signal is String or action.signal.length()>64): errors.append("Invalid action signal")
	if count>128: errors.append("Action budget exceeded")
	return errors

static func _config(value,spec,errors:Array,label:String):
	if not value is Dictionary: errors.append("Invalid "+label+" config"); return
	for key in value:
		if not spec.has(key): errors.append("Unsupported "+label+"."+str(key)); continue
		var field=spec[key]; var v=value[key]; var valid=true
		match field.type:
			"number": valid=_number(v,float(field.min),float(field.max))
			"enum": valid=v in field.values
			"vector": valid=_vector(v,-2000,2000)
			"string": valid=v is String and not v.is_empty() and v.length()<=100
			"color": valid=v is String and Color.html_is_valid(v)
		if not valid: errors.append("Invalid "+label+"."+str(key))

static func _number(value,minimum:float,maximum:float)->bool:
	return (value is float or value is int) and is_finite(float(value)) and value>=minimum and value<=maximum

static func _vector(value,minimum:float,maximum:float)->bool:
	return value is Array and value.size()==3 and _number(value[0],minimum,maximum) and _number(value[1],minimum,maximum) and _number(value[2],minimum,maximum)

static func _event(value,schema)->bool:
	if not value is String: return false
	if value in schema.events: return true
	var regex=RegEx.new(); regex.compile("^signal:[a-zA-Z0-9_-]{1,64}$"); return regex.search(value)!=null
