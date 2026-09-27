extends Node
## A small, service-independent Crystal Hollow adventure with durable local progress.

const SAVE_PATH = "user://crystal_hollow_challenge.json"
const SEALS = ["fracture", "song"]
const WARD_REDUCTION = 0.20

var save_path = SAVE_PATH
var game
var root: Node3D
var center = Vector3.ZERO
var progress = {"version": 1, "fracture": false, "song": false, "claimed": false}
var devices = {}
var label_nodes = {}
var veil: Node3D
var pulse = 0.0

func setup(owner_game, zone_root: Node3D) -> void:
	game = owner_game
	root = zone_root
	if root == null: return
	center = game.scene.zones.crystal_hollow.center
	_load()
	_build()
	_refresh()
	print("HOLLOW_READY fracture=",progress.fracture," song=",progress.song," ward=",progress.claimed)

func _load() -> void:
	if not FileAccess.file_exists(save_path): return
	var bytes = FileAccess.get_file_as_bytes(save_path)
	if bytes.size() > 4096: return
	var value = JSON.parse_string(bytes.get_string_from_utf8())
	if not value is Dictionary or int(value.get("version",0)) != 1: return
	for key in ["fracture", "song", "claimed"]:
		progress[key] = value.get(key,false) == true

func _save() -> bool:
	var temp = save_path + ".tmp"
	var file = FileAccess.open(temp,FileAccess.WRITE)
	if file == null:
		push_warning("HOLLOW_SAVE cannot open temporary file")
		return false
	file.store_string(JSON.stringify(progress))
	file.flush()
	file.close()
	if DirAccess.rename_absolute(temp,save_path) != OK:
		push_warning("HOLLOW_SAVE cannot replace progress file")
		return false
	return true

func _build() -> void:
	# The two plinths flank the central bridge: the near one can be cracked with
	# a mining tool or bomb, while the far one responds to song or repeated blows.
	_make_seal("fracture",Vector3(-2.3,0,2.8),"FRACTURE SEAL\nPICK OR POCKET THUNDER", "e6aa72")
	_make_seal("song",Vector3(2.3,0,-7.0),"SONG SEAL\nHOLLOW'S SONG OR THREE HAMMER BLOWS", "87daed")
	var vault = _device("hollow_vault",Vector3(0,0,-10.5),Vector3(2.5,2.2,1.2))
	devices.vault = vault
	WorldZones.box(vault,Vector3(0,0.12,0),Vector3(2.9,0.25,1.5),"64758a")
	WorldZones.box(vault,Vector3(0,0.85,0),Vector3(1.9,1.3,0.9),"39465d")
	WorldZones.cyl(vault,Vector3(0,1.6,0),0.85,0.28,"aa8bb5","disc",0.35)
	WorldZones.crystal_cluster(vault,Vector3(0,1.9,0),0.8,"98e9ed")
	label_nodes.vault = WorldZones.label(vault,"PRISM VAULT\nTWO SEALS HOLD IT SHUT",Vector3(0,3.1,0),27,"daedf1")
	veil = Node3D.new()
	vault.add_child(veil)
	WorldZones.box(veil,Vector3(0,1.0,0.63),Vector3(2.3,1.65,0.11),"75d8e7",0.65)
	WorldZones.body(veil,Vector3(0,1.0,0.63),Vector3(2.3,1.65,0.14))
	WorldZones.label(root,"THE HOLLOW ANSWERS A CRAFTED HAND",center+Vector3(0,2.8,4.0),25,"b6e2e8")

func _make_seal(key: String, offset: Vector3, words: String, color: String) -> void:
	var node = _device("hollow_seal",offset,Vector3(1.25,1.75,1.25))
	node.set_meta("seal_id",key)
	devices[key] = node
	WorldZones.cyl(node,Vector3(0,0.22,0),0.78,0.45,"505b70","disc")
	WorldZones.cyl(node,Vector3(0,0.85,0),0.48,1.05,"8698a6","taper",0.1)
	WorldZones.crystal_cluster(node,Vector3(0,1.35,0),0.53,color)
	label_nodes[key] = WorldZones.label(node,words,Vector3(0,2.55,0),24,"f2e5cf")

func _device(kind: String, offset: Vector3, collider_size: Vector3) -> Node3D:
	var node = Node3D.new()
	root.add_child(node)
	node.position = center + offset
	node.set_meta("kind",kind)
	game._collider(node,collider_size,Vector3(0,collider_size.y*0.5,0))
	return node

func _refresh() -> void:
	if root == null: return
	for key in SEALS:
		var solved = bool(progress[key])
		label_nodes[key].text = ("%s SEAL · AWAKENED" % key.to_upper()) if solved else ("FRACTURE SEAL\nPICK OR POCKET THUNDER" if key == "fracture" else "SONG SEAL\nHOLLOW'S SONG OR THREE HAMMER BLOWS")
		label_nodes[key].modulate = Color("a4eed2") if solved else Color("f2e5cf")
	if veil != null:
		veil.visible = not (progress.fracture and progress.song)
		game._set_collisions(veil,veil.visible)
	label_nodes.vault.text = "PRISM WARD CLAIMED\n20% LESS DAMAGE" if progress.claimed else ("PRISM VAULT · OPEN\nTOUCH THE HEART TO CLAIM ITS WARD" if progress.fracture and progress.song else "PRISM VAULT\nAWAKEN BOTH SEALS")

func tick(delta: float, zone: String) -> void:
	if zone != "crystal_hollow" or root == null: return
	pulse += delta
	for key in SEALS:
		if not progress[key]: label_nodes[key].modulate.a = 0.78 + 0.22*sin(pulse*2.4)
	if progress.fracture and progress.song and not progress.claimed:
		label_nodes.vault.modulate.a = 0.78 + 0.22*sin(pulse*2.0)

func on_travel(zone: String) -> void:
	if zone != "crystal_hollow": return
	if progress.claimed:
		game._notice("The Prism Ward remembers you · incoming damage reduced by 20%.",7)
	elif progress.fracture and progress.song:
		game._notice("Both seals are awake. Touch the Prism Vault beyond the bridge to claim its ward.",8)
	else:
		game._notice("Two seals hold the Prism Vault. Read their plinths for tool clues.",8)

func interact(target: Node, tool: String, hand = null) -> bool:
	if target.get_meta("kind","") == "hollow_vault":
		_claim(hand)
		return true
	if target.get_meta("kind","") != "hollow_seal": return false
	var key = str(target.get_meta("seal_id",""))
	if key not in SEALS: return false
	if progress[key]:
		game._notice("The %s seal is already awake." % key)
		return true
	if key == "fracture":
		if tool in ["quarry_pick","crystal_resonator"]:
			_awaken(key,hand)
		else:
			game._notice("The stone is cracked. Strike with Stonewhisper, or blast it with Pocket Thunder.",5)
	else:
		if tool == "crystal_resonator":
			_awaken(key,hand)
		elif tool in ["apprentice_hammer","starter_hammer"]:
			var blows = int(target.get_meta("blows",0)) + 1
			target.set_meta("blows",blows)
			if blows >= 3: _awaken(key,hand)
			else: game._notice("The crystal echoes your hammer · %d of 3 beats." % blows,3)
		else:
			game._notice("The crystal wants Hollow's Song, or three steady hammer blows.",5)
	return true

func blast(position: Vector3, radius: float, hand = null) -> void:
	if root == null or not root.visible or progress.fracture: return
	if devices.fracture.global_position.distance_to(position) <= radius + 0.65:
		_awaken("fracture",hand)

func _awaken(key: String, hand) -> void:
	if progress[key]: return
	progress[key] = true
	var saved = _save()
	_refresh()
	game._effect(devices[key].global_position+Vector3.UP,Color("9fe9f0"),0.8,0.8)
	game.adventure.haptic(hand,"ready")
	if progress.fracture and progress.song:
		game._notice("Both seals answer. The Prism Vault is open beyond the bridge!" + ("" if saved else " Progress could not be saved."),8)
	else:
		game._notice("The %s seal awakens. One seal remains." % key + ("" if saved else " Progress could not be saved."),6)
	print("HOLLOW_SEAL key=",key," saved=",saved)

func _claim(hand) -> void:
	if progress.claimed:
		game._notice("The Prism Ward is yours · 20% less incoming damage.",5)
		return
	if not progress.fracture or not progress.song:
		game._notice("The vault is sealed. Awaken both plinths along the bridge.",5)
		return
	progress.claimed = true
	var saved = _save()
	_refresh()
	game._effect(devices.vault.global_position+Vector3.UP*1.5,Color("b6f7dc"),1.2,1.1)
	game.adventure.haptic(hand,"ready")
	game._notice("Prism Ward claimed · permanently take 20% less damage." + ("" if saved else " Progress could not be saved."),10)
	print("HOLLOW_REWARD prism_ward saved=",saved)

func reward_claimed() -> bool:
	return bool(progress.claimed)

func context() -> Dictionary:
	return {"id":"prism_vault","zone":"crystal_hollow","phase":"claimed" if progress.claimed else ("open" if progress.fracture and progress.song else ("partial" if progress.fracture or progress.song else "sealed")),"stepsDone":int(progress.fracture)+int(progress.song),"stepsTotal":2,"rewardClaimed":bool(progress.claimed)}

func journal_line() -> String:
	if progress.claimed: return "Crystal Hollow · Prism Ward claimed · 20% less damage."
	if progress.fracture and progress.song: return "Crystal Hollow · Both seals awake. Claim the Prism Ward beyond the bridge."
	return "Crystal Hollow · Prism Vault: %d/2 seals awake. Pick or bomb the fracture; song or hammer the crystal." % [int(progress.fracture)+int(progress.song)]
