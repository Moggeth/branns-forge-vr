extends SceneTree

const Mining = preload("res://mining_damage.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	for kind in ["stone", "iron", "crystal", "meteor", "ice", "obsidian"]:
		if Mining.profile(kind).is_empty(): failures.append("missing %s profile" % kind)
		if Mining.apply([], Vector3.ZERO, kind, 1000.0).extracted:
			failures.append("single high-energy hit extracted %s" % kind)
	var sites: Array = []
	for bad in [{"strike_region":"shaft"}, {"strike_region":"handle"}, {"incidence":0.15}]:
		var blocked: Dictionary = Mining.apply(sites, Vector3.ZERO, "meteor", 2.0, bad)
		if bool(blocked.accepted) or not blocked.sites.is_empty(): failures.append("invalid contact changed surface")
	if bool(Mining.apply(sites, Vector3.ZERO, "meteor", 0.36).accepted): failures.append("low damage changed surface")
	var first: Dictionary = Mining.apply(sites, Vector3.ZERO, "crystal", 1.0)
	if not first.accepted or first.extracted: failures.append("first chip paid crystal")
	sites = first.sites
	var remote: Dictionary = Mining.apply(sites, Vector3(1.8,0,0), "crystal", 1.0)
	if remote.sites.size() != 2 or remote.extracted: failures.append("distant sites shared damage")
	var near: Dictionary = Mining.apply(sites, Vector3(0.2,0,0), "crystal", 1.0)
	if near.sites.size() != 1 or near.stage < 1 or near.extracted: failures.append("near hit did not expose")
	sites = near.sites
	var extracted := false
	for i in 8:
		var result: Dictionary = Mining.apply(sites, Vector3(0.2,0,0), "crystal", 1.0)
		sites = result.sites
		if result.extracted:
			extracted = true
			break
	if not extracted or not sites.is_empty(): failures.append("exposure never extracted and cleared site")
	var saved: Variant = JSON.parse_string(JSON.stringify(remote.sites))
	if not Mining.valid_sites(saved) or saved.size() != remote.sites.size() or absf(float(saved[0].damage)-float(remote.sites[0].damage)) > 0.001:
		failures.append("localized damage JSON roundtrip")
	var many: Array = []
	for i in 48:
		many = Mining.apply(many, Vector3(float(i)*2.0,0,0), "stone", 1.0).sites
	if many.size() != Mining.MAX_SITES or not Mining.valid_sites(many): failures.append("site bound failed")
	print("MINING_DAMAGE_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
