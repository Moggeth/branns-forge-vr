extends RefCounted
## Metre-space addresses shared by the yard, archive, navigation and art review.

const YARD_BOUNDS := Rect2(-15, -15, 50, 30)
const SPAWN := Vector3(0, 0, 1.2)
const GATE_FOCUS := Vector3(0, 0, -4)
const ARMORY_ENTRY := Vector3(15.4, 0, 4)
const BAY_SIZE := 6.0
const SLOTS_PER_BAY := 6
const BAY_COUNT := 9
const SLOTS_PER_FOLIO := SLOTS_PER_BAY * BAY_COUNT
const STARTER_BENCH := Vector3(2.0, 0, -2.85)
const DESTINATIONS := [
	"pinewood_ruins", "sandstone_quarry", "enchanted_kitchen", "mushroom_glade",
	"crystal_hollow", "sky_garden", "ember_foundry",
]

static func gate_position(index: int) -> Vector3:
	var angle := deg_to_rad((index - 3) * 17.5)
	return Vector3(15.0 * sin(angle), 0, 15.0 * cos(angle) - 1.5)

static func bay_center(bay: int) -> Vector3:
	# Fill the entrance aisle first, then its two flanking aisles. The aisle down
	# the middle remains open even when the catalog occupies all nine bays.
	var aisle := [0, -1, 1]
	var column := floori(float(bay) / 3.0)
	return ARMORY_ENTRY + Vector3((column + 0.5) * BAY_SIZE, 0, int(aisle[bay % 3]) * BAY_SIZE)

static func stand_position(index: int) -> Vector3:
	var slot := posmod(index, SLOTS_PER_FOLIO)
	var bay := floori(float(slot) / SLOTS_PER_BAY)
	var along := (slot % 3 - 1) * 2.0
	var across := -2.04 if slot % SLOTS_PER_BAY < 3 else 2.04
	return bay_center(bay) + Vector3(along, 0, across)

static func stand_yaw(index: int) -> float:
	return 0.0 if posmod(index, SLOTS_PER_BAY) < 3 else PI

static func clear_dressing(point: Vector3) -> bool:
	if point.z >= 3.0 and point.z < 14.6 and absf(point.x) <= 12.6: return true
	if point.x > 2.5 and point.z > 1.0 and point.z < 6.8: return true
	for i in DESTINATIONS.size():
		if point.distance_squared_to(gate_position(i)) < 5.76: return true
	return false
