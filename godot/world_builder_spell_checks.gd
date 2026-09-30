extends SceneTree
## Isolated state contract; never opens or changes the player's saved world.
const Builder = preload("res://world_builder_runtime.gd")

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var builder: Node = Builder.new()
	root.add_child(builder)
	builder.data = Builder.fresh_state()
	builder.test_mode = true
	if not builder._valid(builder.data): failures.append("fresh state invalid")
	if builder.data.has("aether") or float(builder.data.mana) != 12.0: failures.append("fresh state is not canonical Mana")
	var legacy: Dictionary = builder.data.duplicate(true)
	legacy.aether = 7.25
	legacy.erase("mana")
	legacy.erase("spell_cooldowns")
	legacy.erase("constructions")
	legacy.erase("ents")
	var migrated: Dictionary = builder._canonical_state(legacy)
	if not builder._valid(migrated) or float(migrated.mana) != 7.25 or migrated.has("aether"): failures.append("legacy Mana migration lost value")
	for invalid in [NAN, INF, -INF, -0.1, 20.1]:
		var malformed := migrated.duplicate(true)
		malformed.mana = invalid
		if builder._valid(malformed): failures.append("invalid Mana accepted: " + str(invalid))
	var normal := Builder.mana_after_regen(5.0, 10.0, 1.0) - 5.0
	var fast := Builder.mana_after_regen(5.0, 10.0, 4.0) - 5.0
	if absf(normal - 0.55) > 0.0001 or absf(fast - 2.2) > 0.0001 or absf(fast / normal - 4.0) > 0.0001: failures.append("Mana regen is not exactly fourfold")
	if builder.spell_catalogue().size() != 24: failures.append("spell catalogue lost an action")
	if builder.spell_availability("raise") != "": failures.append("affordable spell unavailable")
	var before: float = builder.data.mana
	builder.spells.begin("raise", builder)
	if float(builder.data.mana) != before: failures.append("begin reserved Mana before success")
	builder.spells.success("raise", builder)
	if builder.spell_availability("raise").find("recharges") < 0 or builder.spell_cooldown_fraction("raise") < 0.99: failures.append("same world cooldown absent")
	builder._tick_cooldowns(3.0)
	if builder.spell_cooldown_fraction("raise") >= 0.99: failures.append("cooldown failed to tick")
	builder._tick_cooldowns(10.0)
	if builder.spell_availability("raise") != "": failures.append("cooldown failed to finish")
	var path: String = "user://world_builder_spell_verification_%d.json" % Time.get_ticks_usec()
	builder.save_path = path
	builder.test_mode = false
	var legacy_file := FileAccess.open(path, FileAccess.WRITE)
	legacy_file.store_string(JSON.stringify(legacy))
	legacy_file.close()
	builder.data = Builder.fresh_state()
	builder._load()
	if float(builder.data.mana) != 7.25 or builder.data.has("aether"): failures.append("legacy save file migration failed")
	builder.data = migrated
	builder.data.spell_cooldowns = {"raise": 4.0}
	if not builder.save(): failures.append("isolated save failed")
	builder.data = Builder.fresh_state()
	builder._load()
	if float(builder.data.mana) != 7.25 or float(builder.data.spell_cooldowns.get("raise", -1)) != 4.0: failures.append("Mana or cooldown persistence failed")
	var broken: Dictionary = builder.data.duplicate(true)
	broken.mana = "not a finite number"
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(JSON.stringify(broken))
	file.close()
	builder.data = Builder.fresh_state()
	builder.save_blocked = false
	builder._load()
	if not builder.save_blocked or float(builder.data.mana) != 12.0: failures.append("malformed save was not isolated")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	print("WORLD_BUILDER_SPELL_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
