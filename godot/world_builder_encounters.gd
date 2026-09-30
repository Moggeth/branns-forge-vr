extends Node
## Bounded, once-per-site completion rewards for the existing physical patrols.
## Ordinary skeleton loot and quest XP remain in AdventureRuntime.
const MAX_HISTORY := 40
const CELL_METRES := 24.0
const OBJECTIVES := ["contain", "swift", "captain_last"]
const MANA_REWARD := 2.0

var builder: Node

func setup(owner_builder: Node) -> void:
	builder = owner_builder
	if not builder.data.has("encounter_history"): builder.data.encounter_history = []

static func valid_history(value: Variant) -> bool:
	if not value is Array or value.size() > MAX_HISTORY: return false
	var ids := {}
	var cells := {}
	for record in value:
		if not record is Dictionary: return false
		if not record.get("id") is int or int(record.id) < 0: return false
		if not record.get("cell") is String or str(record.cell).length() > 16: return false
		var coordinates: PackedStringArray = str(record.cell).split(":")
		if coordinates.size() != 2 or not coordinates[0].is_valid_int() or not coordinates[1].is_valid_int(): return false
		if absi(int(coordinates[0])) > 7 or absi(int(coordinates[1])) > 7: return false
		if not record.get("objective") is String or str(record.objective) not in OBJECTIVES: return false
		if not record.get("mana") is float and not record.get("mana") is int: return false
		if not record.get("wood") is int: return false
		if not is_finite(float(record.mana)) or float(record.mana) < 0.0 or float(record.mana) > MANA_REWARD: return false
		if int(record.wood) < 0 or int(record.wood) > 1: return false
		if ids.has(record.id) or cells.has(record.cell): return false
		ids[record.id] = true
		cells[record.cell] = true
	return true

static func valid_threat(value: Variant) -> bool:
	if not value is Dictionary: return false
	if not value.has("objective"): return true # Legacy saves cannot earn a new completion reward.
	if str(value.objective) not in OBJECTIVES: return false
	if not value.get("elapsed") is float and not value.get("elapsed") is int: return false
	if not is_finite(float(value.elapsed)) or float(value.elapsed) < 0.0 or float(value.elapsed) > 7200.0: return false
	if not value.get("kills") is Array or value.kills.size() > 3: return false
	var slots := {}
	for slot in value.kills:
		if not slot is int or int(slot) not in [0, 1, 2] or slots.has(slot): return false
		slots[slot] = true
	return value.get("contained") is bool

static func cell_for(local: Vector3) -> String:
	return "%d:%d" % [floori(local.x / CELL_METRES), floori(local.z / CELL_METRES)]

func prepare(threat: Dictionary) -> void:
	var at: Vector3 = builder._unpack(threat.at)
	var cell := cell_for(at)
	threat.objective = OBJECTIVES[absi(hash("%s|%d" % [cell, int(threat.id)])) % OBJECTIVES.size()]
	threat.elapsed = 0.0
	threat.kills = []
	threat.contained = true

func brief(threat: Dictionary) -> String:
	match str(threat.get("objective", "")):
		"contain": return "Contain the patrol: defeat all three within 14 m of its warning mark."
		"swift": return "Swift clear: defeat all three within 45 seconds of their arrival."
		"captain_last": return "Captain last: defeat the middle skeleton after the flankers."
	return "Defeat the patrol."

func tick_threat(threat: Dictionary, delta: float) -> void:
	if not threat.has("objective") or str(threat.get("state", "")) != "active": return
	threat.elapsed = minf(7200.0, float(threat.elapsed) + maxf(0.0, delta))

func unit_down(threat: Dictionary, slot: int, enemy: Node3D) -> void:
	if not threat.has("objective") or slot not in [0, 1, 2] or slot in threat.kills: return
	if not is_instance_valid(enemy):
		threat.contained = false
	else:
		var at: Vector3 = builder._unpack(threat.at)
		var local: Vector3 = enemy.global_position - builder.center
		if Vector2(at.x - local.x, at.z - local.z).length() > 14.0: threat.contained = false
	threat.kills.append(slot)

func complete(threat: Dictionary) -> Dictionary:
	var result := {"awarded": false, "message": "Patrol cleared; ordinary loot and XP remain."}
	if str(threat.get("state", "")) != "active" or not threat.get("alive", []) is Array or not threat.alive.is_empty(): return result
	if not valid_threat(threat) or not threat.has("objective") or threat.kills.size() != 3: return result
	if not builder._point_valid(threat.get("at", [])): return result
	if not builder.data.get("mana") is float and not builder.data.get("mana") is int: return result
	if not is_finite(float(builder.data.mana)) or float(builder.data.mana) < 0.0 or float(builder.data.mana) > 20.0: return result
	if not builder.data.get("wood") is int or int(builder.data.wood) < 0 or int(builder.data.wood) > 200: return result
	var at: Vector3 = builder._unpack(threat.at)
	var cell := cell_for(at)
	var history: Array = builder.data.encounter_history
	if not valid_history(history): return result
	for old in history:
		if int(old.id) == int(threat.id): result.message = "Patrol already rewarded; ordinary loot and XP remain."; return result
		if str(old.cell) == cell: result.message = "Patrol cleared in a familiar area; explore a new sector for progression."; return result
	if history.size() >= MAX_HISTORY: result.message = "All 40 orchard sectors have paid their encounter rewards."; return result
	var achieved := false
	match str(threat.objective):
		"contain": achieved = bool(threat.contained)
		"swift": achieved = float(threat.elapsed) <= 45.0
		"captain_last": achieved = int(threat.kills.back()) == 1
	if not achieved:
		result.message = "Patrol cleared, but the %s objective was missed. Ordinary loot and XP remain." % str(threat.objective).replace("_", " ")
		return result
	var available_mana := maxf(0.0, 20.0 - float(builder.data.mana))
	var mana := minf(MANA_REWARD, available_mana)
	var wood := 1 if int(builder.data.wood) < 200 and (history.is_empty() or str(history.back().objective) != str(threat.objective)) else 0
	if mana <= 0.0 and wood == 0:
		result.message = "Patrol cleared; Mana and lumber stores are full."
		return result
	# Every reward field is decided before mutation. The caller performs one save.
	history.append({"id": int(threat.id), "cell": cell, "objective": str(threat.objective), "mana": mana, "wood": wood})
	builder.data.mana = float(builder.data.mana) + mana
	builder.data.wood = int(builder.data.wood) + wood
	result.awarded = true
	result.message = "Patrol objective complete in a new sector: +%s Mana%s. %d/40 sector rewards." % [str(snappedf(mana, 0.1)), " · +1 lumber" if wood == 1 else "", history.size()]
	return result
