extends RefCounted
## Deterministic, bounded damage at a physical point on a mineable surface.
## Sites are plain JSON values so they can live inside an existing save record.

const MAX_SITES := 32
const NEARBY_RADIUS := 0.58

static func profile(kind: String) -> Dictionary:
	match kind:
		"stone": return {"hardness": 1.0, "expose": 0.9, "extract": 2.1}
		"iron": return {"hardness": 1.35, "expose": 1.2, "extract": 2.8}
		"crystal": return {"hardness": 0.85, "expose": 1.0, "extract": 2.2}
		"meteor": return {"hardness": 1.3, "expose": 1.15, "extract": 2.7}
		"ice": return {"hardness": 0.65, "expose": 0.6, "extract": 1.6}
		"obsidian": return {"hardness": 1.15, "expose": 0.95, "extract": 2.35}
	return {}

static func valid_sites(sites: Variant) -> bool:
	if not sites is Array or sites.size() > MAX_SITES: return false
	for site in sites:
		if not site is Dictionary: return false
		if not site.get("point") is Array or site.point.size() != 3: return false
		for coordinate in site.point:
			if not (coordinate is float or coordinate is int) or not is_finite(float(coordinate)) or absf(float(coordinate)) > 10000.0: return false
		var material := profile(str(site.get("kind", "")))
		if material.is_empty(): return false
		if not (site.get("damage") is float or site.get("damage") is int): return false
		if not is_finite(float(site.damage)) or float(site.damage) < 0.0 or float(site.damage) >= float(material.extract): return false
		if not (site.get("target") is float or site.get("target") is int): return false
		if not is_finite(float(site.target)) or absf(float(site.target)) > 1024.0 or float(site.target) != float(int(site.target)): return false
		if not (site.get("stage") is float or site.get("stage") is int): return false
		if not is_finite(float(site.stage)) or int(site.stage) not in [0, 1] or float(site.stage) != float(int(site.stage)): return false
		if int(site.stage) != (1 if float(site.damage) >= float(material.expose) else 0): return false
	return true

static func apply(sites: Array, point: Vector3, kind: String, energy: float,
		context: Dictionary = {}, target: int = -1) -> Dictionary:
	var output := {"sites": sites.duplicate(true), "accepted": false, "reason": "", "stage": 0,
		"damage_result": "none", "extracted": false, "quality": 0.0}
	var material := profile(kind)
	if material.is_empty() or not valid_sites(sites) or not point.is_finite() or maxf(absf(point.x),maxf(absf(point.y),absf(point.z))) > 10000.0:
		output.reason = "invalid_damage"
		return output
	var measured_energy: Variant = context.get("energy", energy)
	if not (measured_energy is float or measured_energy is int) or not is_finite(float(measured_energy)) or float(measured_energy) < 0.35:
		output.reason = "weak_strike"
		return output
	var region := str(context.get("strike_region", "pick_point"))
	if region not in ["pick_point", "opposite_point", "working"]:
		output.reason = "wrong_strike_region"
		return output
	var incidence := float(context.get("incidence", 1.0))
	if not is_finite(incidence) or incidence < 0.30:
		output.reason = "glancing_strike"
		return output
	var quality := clampf(incidence, 0.0, 1.0) * (0.72 if region == "working" else 1.0)
	var increment := minf(0.9, maxf(0.0, float(measured_energy) - 0.25) * 0.72 * quality / float(material.hardness))
	if increment < 0.12:
		output.reason = "low_damage"
		return output
	output.quality = snappedf(quality, 0.001)
	var site_index := -1
	var nearest := NEARBY_RADIUS * NEARBY_RADIUS
	for i in output.sites.size():
		var site: Dictionary = output.sites[i]
		if str(site.kind) != kind or int(site.target) != target: continue
		var p: Array = site.point
		var distance := point.distance_squared_to(Vector3(float(p[0]),float(p[1]),float(p[2])))
		if distance < nearest:
			nearest = distance
			site_index = i
	if site_index < 0:
		if output.sites.size() >= MAX_SITES: output.sites.pop_front()
		output.sites.append({"point": [snappedf(point.x,0.001),snappedf(point.y,0.001),snappedf(point.z,0.001)],
			"kind": kind, "target": target, "damage": 0.0, "stage": 0})
		site_index = output.sites.size() - 1
	var current: Dictionary = output.sites[site_index]
	var damage := snappedf(minf(float(material.extract), float(current.damage) + increment), 0.001)
	var stage := 2 if damage >= float(material.extract) else (1 if damage >= float(material.expose) else 0)
	current.damage = damage
	current.stage = stage
	output.sites[site_index] = current
	output.accepted = true
	output.stage = stage
	output.extracted = stage == 2
	output.damage_result = "extracted" if stage == 2 else ("exposed" if stage == 1 else "cracked")
	if stage == 2:
		output.sites.remove_at(site_index)
	return output
